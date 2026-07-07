export type AiProvider = "openai" | "deepseek" | "gemini" | "disabled";

export type AiTaskConfig = {
  provider: AiProvider;
  model: string;
};

export type AiRuntimeConfig = {
  vision: AiTaskConfig;
  text: AiTaskConfig;
  fallback: AiTaskConfig;
  runBudgetUsd: number;
};

const DEFAULT_VISION_PROVIDER: AiProvider = "openai";
const DEFAULT_VISION_MODEL = "gpt-5.4-mini";
const DEFAULT_TEXT_PROVIDER: AiProvider = "gemini";
const DEFAULT_TEXT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_FALLBACK_PROVIDER: AiProvider = "gemini";
const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_RUN_BUDGET_USD = 1;

export function getAiRuntimeConfig(): AiRuntimeConfig {
  return {
    vision: {
      provider: parseProvider(process.env.AI_VISION_PROVIDER, DEFAULT_VISION_PROVIDER),
      model: process.env.AI_VISION_MODEL || process.env.OPENAI_OCR_MODEL || DEFAULT_VISION_MODEL,
    },
    text: {
      provider: parseProvider(process.env.AI_TEXT_PROVIDER, DEFAULT_TEXT_PROVIDER),
      model: process.env.AI_TEXT_MODEL || DEFAULT_TEXT_MODEL,
    },
    fallback: {
      provider: parseProvider(process.env.AI_FALLBACK_PROVIDER, DEFAULT_FALLBACK_PROVIDER),
      model: process.env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
    },
    runBudgetUsd: parseBudget(process.env.AI_RUN_BUDGET_USD),
  };
}

export function assertAiProviderKey(provider: AiProvider) {
  if (provider === "disabled") {
    throw new Error("AI provider is disabled.");
  }

  if (provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (provider === "deepseek" && !process.env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

  if (provider === "gemini" && !process.env.GEMINI_API_KEY && !process.env.AI_TEXT_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }
}

function parseProvider(value: string | undefined, fallback: AiProvider): AiProvider {
  if (value === "openai" || value === "deepseek" || value === "gemini" || value === "disabled") {
    return value;
  }

  return fallback;
}

function parseBudget(value: string | undefined) {
  if (!value) {
    return DEFAULT_RUN_BUDGET_USD;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RUN_BUDGET_USD;
  }

  return parsed;
}
