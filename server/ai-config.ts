export type AiProvider = "openai" | "deepseek" | "gemini" | "openrouter" | "disabled";
export type AiConfig = AiRuntimeConfig; // Alias for backward compatibility

export type AiTaskConfig = {
  provider: AiProvider;
  model: string;
};

export type AiRuntimeConfig = {
  vision: AiTaskConfig;
  visionRescue: AiTaskConfig;
  text: AiTaskConfig;
  fallback: AiTaskConfig;
  runBudgetUsd: number;
};

const DEFAULT_TEXT_PROVIDER: AiProvider = "gemini";
const DEFAULT_TEXT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_FALLBACK_PROVIDER: AiProvider = "gemini";
const DEFAULT_RUN_BUDGET_USD = 1;

export function getAiRuntimeConfig(): AiRuntimeConfig {
  const visionProvider = parseProvider(process.env.AI_VISION_PROVIDER, getDefaultVisionProvider());
  const fallbackProvider = parseProvider(process.env.AI_FALLBACK_PROVIDER, getDefaultFallbackProvider(visionProvider));
  const rescueProvider = parseProvider(process.env.AI_VISION_RESCUE_PROVIDER, process.env.OPENROUTER_API_KEY ? "openrouter" : "disabled");

  return {
    vision: {
      provider: visionProvider,
      model: process.env.AI_VISION_MODEL || process.env.OPENAI_OCR_MODEL || getDefaultVisionModel(visionProvider),
    },
    visionRescue: {
      provider: rescueProvider,
      model: process.env.AI_VISION_RESCUE_MODEL || "openai/gpt-4.1-mini",
    },
    text: {
      provider: parseProvider(process.env.AI_TEXT_PROVIDER, DEFAULT_TEXT_PROVIDER),
      model: process.env.AI_TEXT_MODEL || DEFAULT_TEXT_MODEL,
    },
    fallback: {
      provider: fallbackProvider,
      model: process.env.AI_FALLBACK_MODEL || getDefaultFallbackModel(visionProvider, fallbackProvider),
    },
    runBudgetUsd: parseBudget(process.env.AI_RUN_BUDGET_USD),
  };
}

function getDefaultVisionProvider(): AiProvider {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "gemini";
}

function getDefaultFallbackProvider(primary: AiProvider): AiProvider {
  if (primary === "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
  if (primary !== "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
  if (primary !== "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (primary !== "openai" && process.env.OPENAI_API_KEY) return "openai";
  return DEFAULT_FALLBACK_PROVIDER;
}

function getDefaultVisionModel(provider: AiProvider) {
  if (provider === "openrouter") return "openrouter/free";
  if (provider === "openai") return "gpt-4.1-mini";
  return "gemini-2.5-flash-lite";
}

function getDefaultFallbackModel(primary: AiProvider, fallback: AiProvider) {
  if (primary === "openrouter" && fallback === "openrouter") return "qwen/qwen3-vl-30b-a3b-instruct";
  return getDefaultVisionModel(fallback);
}

export function getAiConfig(): AiRuntimeConfig {
  return getAiRuntimeConfig();
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

  if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }
}

function parseProvider(value: string | undefined, fallback: AiProvider): AiProvider {
  if (value === "openai" || value === "deepseek" || value === "gemini" || value === "openrouter" || value === "disabled") {
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
