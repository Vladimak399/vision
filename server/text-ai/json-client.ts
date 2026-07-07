import { getAiRuntimeConfig } from "../ai-config";
import { AiHttpError, isAiFallbackCandidate, withAiRetry } from "../ai-retry";

export type TextAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type TextAiJsonRequest = {
  system: string;
  user: string;
};

export type TextAiJsonResult<T> = {
  data: T;
  usage: {
    provider: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
  };
};

type ChatCompletionsResponse = {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

const DEFAULT_GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const FALLBACK_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

export async function runTextAiJson<T>({ system, user }: TextAiJsonRequest): Promise<TextAiJsonResult<T>> {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.text.provider === "disabled") {
    throw new Error("Text AI provider is disabled.");
  }

  const models = [aiConfig.text.model];
  if (aiConfig.text.provider === "gemini" && aiConfig.fallback.provider === "gemini" && aiConfig.fallback.model !== aiConfig.text.model) {
    models.push(aiConfig.fallback.model);
  }

  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    try {
      return await runTextAiJsonWithModel<T>({ provider: aiConfig.text.provider, model, system, user });
    } catch (error) {
      lastError = error;
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null;
      if (index === 0 && FALLBACK_STATUSES.has(status ?? 0) && models.length > 1) continue;
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Text AI request failed.");
}

async function runTextAiJsonWithModel<T>({ provider, model, system, user }: { provider: string; model: string; system: string; user: string }): Promise<TextAiJsonResult<T>> {
  const apiKey = process.env.AI_TEXT_API_KEY || getProviderApiKey(provider);
  const baseUrl = process.env.AI_TEXT_BASE_URL || getProviderBaseUrl(provider);

  if (!apiKey) {
    throw new Error(provider === "gemini" ? "GEMINI_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables." : "Text AI API key is not configured.");
  }

  if (!baseUrl) {
    throw new Error("AI-провайдер отключен или не поддерживается. Проверьте AI_VISION_PROVIDER и AI_TEXT_PROVIDER.");
  }

  try {
    return await runTextModel<T>({
      apiKey,
      baseUrl,
      model: aiConfig.text.model,
      provider: aiConfig.text.provider,
      system,
      user,
    });
  } catch (error) {
    if (
      aiConfig.text.provider === "gemini" &&
      aiConfig.fallback.provider === "gemini" &&
      aiConfig.fallback.model &&
      aiConfig.fallback.model !== aiConfig.text.model &&
      isAiFallbackCandidate(error)
    ) {
      return runTextModel<T>({
        apiKey,
        baseUrl,
        model: aiConfig.fallback.model,
        provider: aiConfig.text.provider,
        system,
        user,
      });
    }

    throw error;
  }
}

async function runTextModel<T>({
  apiKey,
  baseUrl,
  model,
  provider,
  system,
  user,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: string;
  system: string;
  user: string;
}): Promise<TextAiJsonResult<T>> {
  const endpoint = new URL("chat/completions", ensureTrailingSlash(baseUrl));
  const messages: TextAiMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const body = await withAiRetry(async () => {
    const response = await fetch(endpoint.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });

    const responseBody = (await response.json().catch(() => null)) as ChatCompletionsResponse | null;

    if (!response.ok) {
      throw new AiHttpError(responseBody?.error?.message || `Text AI request failed with status ${response.status}.`, response.status);
    }

    return responseBody;
  });
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Text AI response did not contain message content.");

  return {
    data: JSON.parse(content) as T,
    usage: {
      provider,
      model,
      input_tokens: body?.usage?.prompt_tokens ?? 0,
      output_tokens: body?.usage?.completion_tokens ?? 0,
    },
  };
}

function toTextAiHttpError(status: number, message: string | undefined) {
  const safeMessage = status === 429 ? "Превышен лимит Gemini API. Подождите и повторите запрос." : status === 503 ? "Gemini временно перегружен. Повторите позже или переключите модель в Vercel." : message || `Text AI request failed with status ${status}.`;
  const error = new Error(safeMessage) as Error & { status?: number };
  error.status = status;
  return error;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProviderApiKey(provider: string) {
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY;
  }

  if (provider === "deepseek") {
    return process.env.DEEPSEEK_API_KEY;
  }

  if (provider === "gemini") {
    return process.env.GEMINI_API_KEY;
  }

  return null;
}

function getProviderBaseUrl(provider: string) {
  if (provider === "gemini") {
    return DEFAULT_GEMINI_OPENAI_BASE_URL;
  }

  return null;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
