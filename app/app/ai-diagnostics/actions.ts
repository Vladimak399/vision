"use server";

import { getAiRuntimeConfig } from "../../../server/ai-config";
import { toSafeAiErrorMessage } from "../../../server/ai-retry";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { recognizeShelfPhoto } from "../../../server/shelf-recognition";
import type { ShelfRecognitionItem } from "../../../server/shelf-recognition/types";
import { runTextAiJson } from "../../../server/text-ai/json-client";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type TextSmokeResult = ActionResult<{
  response: { ok: boolean; message: string };
  usage: { provider: string; model: string; input_tokens: number; output_tokens: number };
}>;

export type VisionSmokeResult = ActionResult<{
  provider: string;
  model: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  warnings: string[];
  items: ShelfRecognitionItem[];
}>;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function ensureAiDiagnosticsAccess() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Войдите в систему, чтобы открыть AI-диагностику.");
  }

  const membershipResult = await getPrimaryCompanyMembership();

  if (membershipResult.status !== "ok") {
    throw new Error("Нет доступа к компании. Попросите администратора добавить вас в компанию.");
  }

  if (membershipResult.membership.role !== "admin" && membershipResult.membership.role !== "manager") {
    throw new Error("AI-диагностика доступна только ролям admin и manager.");
  }

  return membershipResult.membership;
}

export async function runTextAiSmokeTest(): Promise<TextSmokeResult> {
  try {
    await ensureAiDiagnosticsAccess();

    const result = await runTextAiJson<{ ok: boolean; message: string }>({
      system: "Return only strict JSON. Do not include markdown or extra text.",
      user: 'Return JSON exactly matching this shape: {"ok":true,"message":"text AI is working"}. Do not guess provider or model names.',
    });

    return { ok: true, data: { response: result.data, usage: result.usage } };
  } catch (error) {
    return { ok: false, error: toSafeAiErrorMessage(error, "Не удалось выполнить проверку text AI.") };
  }
}

export async function runVisionAiSmokeTest(formData: FormData): Promise<VisionSmokeResult> {
  try {
    await ensureAiDiagnosticsAccess();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      return { ok: false, error: "Загрузите одно изображение для проверки." };
    }

    if (file.size <= 0) {
      return { ok: false, error: "Файл пустой. Загрузите непустое изображение." };
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: "Файл слишком большой. Максимальный размер изображения — 4 МБ." };
    }

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      return { ok: false, error: "Поддерживаются только изображения JPEG, PNG или WebP." };
    }

    const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const startedAt = Date.now();
    const recognition = await recognizeShelfPhoto({ imageBase64, mimeType: file.type });
    const aiConfig = getAiRuntimeConfig();

    return {
      ok: true,
      data: {
        provider: aiConfig.vision.provider,
        model: recognition.usage.model || aiConfig.vision.model,
        duration_ms: recognition.usage.duration_ms || Date.now() - startedAt,
        input_tokens: recognition.usage.input_tokens,
        output_tokens: recognition.usage.output_tokens,
        warnings: recognition.warnings,
        items: recognition.items.slice(0, 10),
      },
    };
  } catch (error) {
    return { ok: false, error: toSafeAiErrorMessage(error, "Не удалось выполнить проверку vision AI.") };
  }
}
