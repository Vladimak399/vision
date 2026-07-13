import { getAiRuntimeConfig } from "../ai-config";
import { AiHttpError, isAiFallbackCandidate, withAiRetry } from "../ai-retry";
import { parseRecognitionPayload } from "./normalize";
import { SHELF_RECOGNITION_PROMPT } from "./prompt";
import type { ShelfRecognitionInput, ShelfRecognitionResult } from "./types";

// OpenRouter: OpenAI-совместимый chat completions API, поддерживает vision.
// Free Models Router сам выбирает доступную бесплатную модель с поддержкой image input.
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

type OpenRouterChoice = {
  message?: { content?: string | Array<{ text?: string }> };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export async function recognizeShelfPhotoWithOpenRouter(
  input: ShelfRecognitionInput,
  modelOverride?: string,
): Promise<ShelfRecognitionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY не настроен. Добавьте переменную в .env.local или Vercel.");
  }

  const aiConfig = getAiRuntimeConfig();
  const model = modelOverride || (aiConfig.vision.provider === "openrouter"
      ? aiConfig.vision.model || DEFAULT_OPENROUTER_MODEL
      : DEFAULT_OPENROUTER_MODEL);

  const startedAt = Date.now();

  const responseBody = await withAiRetry(async () => {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      signal: AbortSignal.timeout(model === "openrouter/free" || model.endsWith(":free") ? 30_000 : 90_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Опциональные, но рекомендуемые OpenRouter'ом заголовки идентификации приложения.
        "HTTP-Referer": "https://pricevision.local",
        "X-Title": "PriceVision",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: SHELF_RECOGNITION_PROMPT },
              getImageContentPart(input),
            ],
          },
        ],
      }),
    });

    const parsed = (await response.json().catch(() => null)) as OpenRouterResponse | null;

    if (!response.ok) {
      throw new AiHttpError(
        toOpenRouterErrorMessage(response.status, parsed?.error?.message),
        response.status,
      );
    }

    return parsed;
  });

  const outputText = extractOutputText(responseBody);
  if (!outputText) {
    throw new AiHttpError("OpenRouter вернул пустой ответ (нет текста).", 502);
  }

  const payload = parseRecognitionPayload(outputText, "OpenRouter");
  if (payload.normalizeError) {
    throw new AiHttpError(`OpenRouter вернул некорректный JSON: ${payload.normalizeError}`, 502);
  }
  if (payload.items.length === 0 && payload.warnings.length === 0) {
    throw new AiHttpError("OpenRouter не вернул распознанных позиций или предупреждений.", 502);
  }
  if (payload.items.length > 0 && !payload.items.some((item) => item.bbox)) {
    throw new AiHttpError("OpenRouter распознал позиции без bbox ценников.", 502);
  }
  return {
    ...payload,
    usage: {
      model,
      input_tokens: responseBody?.usage?.prompt_tokens ?? 0,
      output_tokens: responseBody?.usage?.completion_tokens ?? 0,
      estimated_cost_microusd: estimateOpenRouterCost(model, responseBody?.usage),
      duration_ms: Date.now() - startedAt,
    },
  };
}

function estimateOpenRouterCost(model: string, usage: OpenRouterResponse["usage"]) {
  if (model === "openrouter/free" || model.endsWith(":free")) return 0;
  if (model === "qwen/qwen3-vl-30b-a3b-instruct") {
    return Math.round((usage?.prompt_tokens ?? 0) * 0.15 + (usage?.completion_tokens ?? 0) * 0.6);
  }
  if (model === "openai/gpt-4.1-mini") {
    return Math.round((usage?.prompt_tokens ?? 0) * 0.4 + (usage?.completion_tokens ?? 0) * 1.6);
  }
  return null;
}

function toOpenRouterErrorMessage(status: number, message: string | undefined) {
  if (status === 401) return "Неверный OpenRouter API-ключ.";
  if (status === 402) return "Недостаточно кредитов на OpenRouter.";
  if (status === 429) return "Превышен rate limit бесплатной модели OpenRouter. Подождите и повторите.";
  if (status === 503) return "OpenRouter временно перегружен. Повторите позже.";
  return message || `OpenRouter request failed with status ${status}.`;
}

function getImageContentPart(input: ShelfRecognitionInput): {
  type: "image_url";
  image_url: { url: string };
} {
  if ("imageUrl" in input && input.imageUrl) {
    return { type: "image_url", image_url: { url: input.imageUrl } };
  }
  if (!("imageBase64" in input) || !input.imageBase64 || !input.mimeType) {
    throw new Error("Provide either imageUrl or imageBase64 with mimeType.");
  }
  return {
    type: "image_url",
    image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` },
  };
}

function extractOutputText(response: OpenRouterResponse | null): string | null {
  for (const choice of response?.choices ?? []) {
    const content = choice.message?.content;
    if (typeof content === "string" && content.trim()) return content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part.text === "string" && part.text.trim()) return part.text;
      }
    }
  }
  return null;
}

// Реэкспорт для консистентности с другими провайдерами.
export { isAiFallbackCandidate };
