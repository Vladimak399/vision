import { getServerEnv } from "../lib/env";

export type AiProvider = "openai" | "deepseek" | "disabled";

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
const DEFAULT_TEXT_PROVIDER: AiProvider = "deepseek";
const DEFAULT_TEXT_MODEL = "deepseek-chat";
const DEFAULT_FALLBACK_PROVIDER: AiProvider = "openai";
const DEFAULT_FALLBACK_MODEL = "gpt-5.4-nano";
const DEFAULT_RUN_BUDGET_USD = 1;

export function getAiRuntimeConfig(): AiRuntimeConfig {
  const env = getServerEnv();

  return {
    vision: {
      provider: parseProvider(env.AI_VISION_PROVIDER, DEFAULT_VISION_PROVIDER),
      model: env.AI_VISION_MODEL || env.OPENAI_OCR_MODEL || DEFAULT_VISION_MODEL,
    },
    text: {
      provider: parseProvider(env.AI_TEXT_PROVIDER, DEFAULT_TEXT_PROVIDER),
      model: env.AI_TEXT_MODEL || DEFAULT_TEXT_MODEL,
    },
    fallback: {
      provider: parseProvider(env.AI_FALLBACK_PROVIDER, DEFAULT_FALLBACK_PROVIDER),
      model: env.AI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
    },
    runBudgetUsd: parseBudget(env.AI_RUN_BUDGET_USD),
  };
}

export function assertAiProviderKey(provider: AiProvider) {
  const env = getServerEnv();

  if (provider === "disabled") {
    throw new Error("AI provider is disabled.");
  }

  if (provider === "openai" && !env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  if (provider === "deepseek" && !env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }
}

function parseProvider(value: string | undefined, fallback: AiProvider): AiProvider {
  if (value === "openai" || value === "deepseek" || value === "disabled") {
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
