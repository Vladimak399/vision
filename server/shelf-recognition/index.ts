import { getAiRuntimeConfig } from "../ai-config";
import { isAiFallbackCandidate } from "../ai-retry";
import { recognizeShelfPhotoWithGemini } from "./gemini";
import { recognizeShelfPhotoWithOpenAI } from "./openai";
import { recognizeShelfPhotoWithOpenRouter } from "./openrouter";
import type { ShelfRecognitionInput, ShelfRecognitionResult } from "./types";

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
  const attempts: Array<{ provider: string }> = [{ provider: aiConfig.vision.provider }];

  // Добавляем fallback, если он другой провайдер и для него есть ключ.
  if (aiConfig.fallback.provider !== "disabled" && aiConfig.fallback.provider !== aiConfig.vision.provider) {
    const hasKey =
      (aiConfig.fallback.provider === "openrouter" && process.env.OPENROUTER_API_KEY) ||
      (aiConfig.fallback.provider === "gemini" && process.env.GEMINI_API_KEY) ||
      (aiConfig.fallback.provider === "openai" && process.env.OPENAI_API_KEY);
    if (hasKey) {
      attempts.push({ provider: aiConfig.fallback.provider });
    }
  }

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    try {
      return await recognizeWithProvider(attempt.provider, input);
    } catch (error) {
      lastError = error;
      // На основной попытке при транзитной ошибке (лимит/перегрузка) пробуем fallback.
      if (index === 0 && isAiFallbackCandidate(error) && attempts.length > 1) {
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Shelf recognition failed.");
}

async function recognizeWithProvider(provider: string, input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  if (provider === "openai") {
    return recognizeShelfPhotoWithOpenAI(input);
  }
  if (provider === "gemini") {
    return recognizeShelfPhotoWithGemini(input);
  }
  if (provider === "openrouter") {
    return recognizeShelfPhotoWithOpenRouter(input);
  }
  throw new Error(`Vision provider ${provider} не поддерживается.`);
}
