export class AiHttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AiHttpError";
    this.status = status;
  }
}

export type AiRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryableAiError(error: unknown) {
  return error instanceof AiHttpError && RETRYABLE_STATUSES.has(error.status);
}

export function isAiFallbackCandidate(error: unknown) {
  return error instanceof AiHttpError && (error.status === 429 || error.status === 503);
}

export async function withAiRetry<T>(operation: () => Promise<T>, options: AiRetryOptions = {}) {
  const maxAttempts = options.maxAttempts ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 350;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryableAiError(error)) {
        throw error;
      }

      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export function toSafeAiErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const status = error instanceof AiHttpError ? error.status : null;

  if (message.includes("GEMINI_API_KEY")) {
    return "GEMINI_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables.";
  }

  if (message.includes("OPENAI_API_KEY")) {
    return "OPENAI_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables.";
  }

  if (message.includes("DEEPSEEK_API_KEY")) {
    return "DEEPSEEK_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables.";
  }

  if (status === 429 || message.includes("429")) {
    return "Превышен лимит Gemini API. Подождите и повторите запрос.";
  }

  if (status === 503 || message.includes("503") || message.toLowerCase().includes("high demand")) {
    return "Gemini временно перегружен. Повторите позже или переключите модель в Vercel.";
  }

  if (message.includes("disabled") || message.includes("unsupported")) {
    return "AI-провайдер отключен или не поддерживается. Проверьте AI_VISION_PROVIDER и AI_TEXT_PROVIDER.";
  }

  return message && !containsSecretLikeText(message) ? `${fallback} ${message}` : fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function containsSecretLikeText(value: string) {
  return /sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{8,}|key=[^\s&]+/i.test(value);
}
