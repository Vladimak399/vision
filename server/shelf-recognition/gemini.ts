import { getAiRuntimeConfig } from "../ai-config";
import { AiHttpError, isAiFallbackCandidate, withAiRetry } from "../ai-retry";
import { parseRecognitionPayload } from "./normalize";
import { SHELF_RECOGNITION_PROMPT } from "./prompt";
import type { ShelfRecognitionInput, ShelfRecognitionResult } from "./types";
import { recordAiTelemetry } from "../ai-telemetry";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiGenerateContentResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

export async function recognizeShelfPhotoWithGemini(input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables.");

  const aiConfig = getAiRuntimeConfig();
  if (aiConfig.vision.provider !== "gemini") throw new Error("AI-провайдер отключен или не поддерживается. Проверьте AI_VISION_PROVIDER и AI_TEXT_PROVIDER.");

  const models = [aiConfig.vision.model];
  if (aiConfig.fallback.provider === "gemini" && aiConfig.fallback.model && aiConfig.fallback.model !== aiConfig.vision.model) {
    models.push(aiConfig.fallback.model);
  }

  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    try {
      return await runGeminiVisionRequest({ apiKey, input, model });
    } catch (error) {
      lastError = error;
      if (index === 0 && isAiFallbackCandidate(error) && models.length > 1) continue;
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Не удалось выполнить Gemini OCR запрос.");
}

async function runGeminiVisionRequest({ apiKey, input, model }: { apiKey: string; input: ShelfRecognitionInput; model: string }) {
  const startedAt = Date.now();
  const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const imagePart = getInputImagePart(input);

  const responseBody = await withAiRetry(async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: SHELF_RECOGNITION_PROMPT }, imagePart] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0 },
      }),
    });

    const parsed = (await response.json().catch(() => null)) as GeminiGenerateContentResponse | null;

    if (!response.ok) {
      throw new AiHttpError(
        toGeminiErrorMessage(response.status, parsed?.error?.message),
        response.status,
      );
    }

    return parsed;
  });

  const outputText = extractOutputText(responseBody);
  if (!outputText) throw new Error("Gemini OCR response did not contain output text.");
  const payload = parseRecognitionPayload(outputText, "Gemini");
  const durationMs = Date.now() - startedAt;
  const inputTokens = responseBody?.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = responseBody?.usageMetadata?.candidatesTokenCount ?? 0;

  recordAiTelemetry({
    provider: "gemini",
    model,
    operation: "vision",
    duration_ms: durationMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    fallback_used: false,
    error: null,
    estimated_cost_usd: null,
    timestamp: new Date().toISOString(),
  });

  return {
    ...payload,
    usage: {
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_microusd: null,
      duration_ms: durationMs,
    },
  };
}

function toGeminiErrorMessage(status: number, message: string | undefined) {
  if (status === 429) return "Превышен лимит Gemini API. Подождите и повторите запрос.";
  if (status === 503) return "Gemini временно перегружен. Повторите позже или переключите модель в Vercel.";
  return message || `Gemini OCR request failed with status ${status}.`;
}

function getInputImagePart(input: ShelfRecognitionInput) {
  if ("imageUrl" in input && input.imageUrl) return { file_data: { mime_type: "image/jpeg", file_uri: input.imageUrl } };
  if (!("imageBase64" in input) || !input.imageBase64 || !input.mimeType) throw new Error("Provide either imageUrl or imageBase64 with mimeType.");
  return { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } };
}

function extractOutputText(response: GeminiGenerateContentResponse | null) {
  for (const candidate of response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim()) return part.text;
    }
  }
  return null;
}
