export type OcrModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

const OCR_MODEL_PRICING: Record<string, OcrModelPricing> = {
  "gpt-5.4-nano": {
    inputUsdPerMillionTokens: 0.2,
    outputUsdPerMillionTokens: 1.25,
  },
  "gpt-5.4-mini": {
    inputUsdPerMillionTokens: 0.75,
    outputUsdPerMillionTokens: 4.5,
  },
};

const DEFAULT_OCR_MODEL = "gpt-5.4-mini";

export function getDefaultOcrModel() {
  return DEFAULT_OCR_MODEL;
}

export function getOcrModelPricing(model: string) {
  return OCR_MODEL_PRICING[model] ?? null;
}

export function estimateOcrCostMicrousd({
  model,
  inputTokens,
  outputTokens,
}: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}) {
  const pricing = getOcrModelPricing(model);

  if (!pricing) {
    return null;
  }

  const inputUsd = (inputTokens / 1_000_000) * pricing.inputUsdPerMillionTokens;
  const outputUsd = (outputTokens / 1_000_000) * pricing.outputUsdPerMillionTokens;

  return Math.max(0, Math.round((inputUsd + outputUsd) * 1_000_000));
}
