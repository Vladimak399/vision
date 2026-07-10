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
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/";

export async function runTextAiJson<T>({ system, user }: TextAiJsonRequest): Promise<TextAiJsonResult<T>> {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.text.provider === "disabled") {
    throw new Error("Text AI provider is disabled.");
  }

  // Строим цепочку попыток: основной провайдер + fallback.
  // Поддерживаем переход между провайдерами (gemini → openrouter), а не только смену модели.
  const attempts: Array<{ provider: string; model: string }> = [
    { provider: aiConfig.text.provider, model: aiConfig.text.model },
  ];
  if (aiConfig.fallback.provider !== "disabled" && aiConfig.fallback.model) {
    const isDifferentModel = aiConfig.fallback.model !== aiConfig.text.model;
    const isDifferentProvider = aiConfig.fallback.provider !== aiConfig.text.provider;
    if (isDifferentModel || isDifferentProvider) {
      attempts.push({ provider: aiConfig.fallback.provider, model: aiConfig.fallback.model });
    }
  }

  let lastError: unknown;
  for (const [index, attempt] of attempts.entries()) {
    try {
      return await runTextAiJsonWithModel<T>({
        provider: attempt.provider,
        model: attempt.model,
        system,
        user,
      });
    } catch (error) {
      lastError = error;
      // На основной попытке при транзитной ошибке (429/5xx) пробуем fallback.
      if (index === 0 && isAiFallbackCandidate(error) && attempts.length > 1) {
        continue;
      }
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
    throw new Error("AI-провайдер отключен или не поддерживается. Проверьте AI_TEXT_PROVIDER и AI_FALLBACK_PROVIDER.");
  }

  return runTextModel<T>({
    apiKey,
    baseUrl,
    model,
    provider,
    system,
    user,
  });
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
  if (!content) {
    // Пустой ответ — транзитная ошибка, даём fallback-провайдеру шанс.
    throw new AiHttpError("Text AI response did not contain message content.", 502);
  }

  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    // Невалидный JSON — тоже транзитная ошибка, fallback может справиться лучше.
    throw new AiHttpError("Text AI returned invalid JSON.", 502);
  }

  return {
    data: parsed,
    usage: {
      provider,
      model,
      input_tokens: body?.usage?.prompt_tokens ?? 0,
      output_tokens: body?.usage?.completion_tokens ?? 0,
    },
  };
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

  if (provider === "openrouter") {
    return process.env.OPENROUTER_API_KEY;
  }

  return null;
}

function getProviderBaseUrl(provider: string) {
  if (provider === "gemini") {
    return DEFAULT_GEMINI_OPENAI_BASE_URL;
  }

  if (provider === "openrouter") {
    return DEFAULT_OPENROUTER_BASE_URL;
  }

  return null;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}
