import { getAiRuntimeConfig } from "../ai-config";
import { isAiFallbackCandidate } from "../ai-retry";
import { recognizeShelfPhotoWithGemini } from "./gemini";
import { recognizeShelfPhotoWithOpenAI } from "./openai";
import { recognizeShelfPhotoWithOpenRouter } from "./openrouter";
import type { ShelfRecognitionInput, ShelfRecognitionResult } from "./types";
import type { AiProvider, AiTaskConfig } from "../ai-config";

export function hasShelfRecognitionKey() {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.vision.provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (aiConfig.vision.provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  if (aiConfig.vision.provider === "openrouter") {
    return Boolean(process.env.OPENROUTER_API_KEY);
  }

  return false;
}

export function getShelfRecognitionMissingKeyMessage() {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.vision.provider === "openai") {
    return "OPENAI_API_KEY is not configured.";
  }

  if (aiConfig.vision.provider === "gemini") {
    return "GEMINI_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables.";
  }

  if (aiConfig.vision.provider === "openrouter") {
    return "OPENROUTER_API_KEY не настроен. Добавьте переменную в .env.local или Vercel.";
  }

  return `Vision provider ${aiConfig.vision.provider} отключен или не поддерживается.`;
}

/**
 * Распознаёт фото полки. С fallback: основной провайдер → fallback-провайдер.
 *
 * При лимите Gemini (429) автоматически переключается на OpenRouter.
 */
export async function recognizeShelfPhoto(input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  const aiConfig = getAiRuntimeConfig();

  // Строим цепочку попыток: основной vision + fallback.
  const attempts: AiTaskConfig[] = [aiConfig.vision];

  // Fallback может использовать тот же провайдер с другой моделью (например OpenRouter free → paid).
  if (
    aiConfig.fallback.provider !== "disabled" &&
    hasProviderKey(aiConfig.fallback.provider) &&
    (aiConfig.fallback.provider !== aiConfig.vision.provider || aiConfig.fallback.model !== aiConfig.vision.model)
  ) {
    attempts.push(aiConfig.fallback, aiConfig.fallback);
  }

  if (
    aiConfig.visionRescue.provider !== "disabled" &&
    hasProviderKey(aiConfig.visionRescue.provider) &&
    !attempts.some((attempt) =>
      attempt.provider === aiConfig.visionRescue.provider && attempt.model === aiConfig.visionRescue.model)
  ) {
    attempts.push(aiConfig.visionRescue);
  }

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    try {
      return await recognizeWithProvider(attempt.provider, attempt.model, input);
    } catch (error) {
      lastError = error;
      // На основной попытке при транзитной ошибке (лимит/перегрузка) пробуем fallback.
      if (isAiFallbackCandidate(error) && index < attempts.length - 1) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Shelf recognition failed.");
}

function hasProviderKey(provider: AiProvider) {
  if (provider === "openrouter") return Boolean(process.env.OPENROUTER_API_KEY);
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

async function recognizeWithProvider(provider: string, model: string, input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  if (provider === "openai") {
    return recognizeShelfPhotoWithOpenAI(input, model);
  }
  if (provider === "gemini") {
    return recognizeShelfPhotoWithGemini(input, model);
  }
  if (provider === "openrouter") {
    return recognizeShelfPhotoWithOpenRouter(input, model);
  }
  throw new Error(`Vision provider ${provider} не поддерживается.`);
}
