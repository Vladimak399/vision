import { getAiRuntimeConfig } from "../ai-config";
import { recognizeShelfPhotoWithGemini } from "./gemini";
import { recognizeShelfPhotoWithOpenAI } from "./openai";
import type { ShelfRecognitionInput, ShelfRecognitionResult } from "./types";

export function hasShelfRecognitionKey() {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.vision.provider === "openai") {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  if (aiConfig.vision.provider === "gemini") {
    return Boolean(process.env.GEMINI_API_KEY);
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

  return `Vision provider ${aiConfig.vision.provider} отключен или не поддерживается.`;
}

export async function recognizeShelfPhoto(input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.vision.provider === "openai") {
    return recognizeShelfPhotoWithOpenAI(input);
  }

  if (aiConfig.vision.provider === "gemini") {
    return recognizeShelfPhotoWithGemini(input);
  }

  throw new Error(`Vision provider ${aiConfig.vision.provider} отключен или не поддерживается.`);
}
