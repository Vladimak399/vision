import { getAiRuntimeConfig } from "../ai-config";

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

export async function runTextAiJson<T>({ system, user }: TextAiJsonRequest): Promise<TextAiJsonResult<T>> {
  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.text.provider === "disabled") {
    throw new Error("Text AI provider is disabled.");
  }

  const apiKey = process.env.AI_TEXT_API_KEY || getProviderApiKey(aiConfig.text.provider);
  const baseUrl = process.env.AI_TEXT_BASE_URL || getProviderBaseUrl(aiConfig.text.provider);

  if (!apiKey) {
    throw new Error("Text AI API key is not configured.");
  }

  if (!baseUrl) {
    throw new Error("AI_TEXT_BASE_URL is not configured.");
  }

  const endpoint = new URL("chat/completions", ensureTrailingSlash(baseUrl));
  const messages: TextAiMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiConfig.text.model,
      messages,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  const body = (await response.json().catch(() => null)) as ChatCompletionsResponse | null;

  if (!response.ok) {
    throw new Error(body?.error?.message || `Text AI request failed with status ${response.status}.`);
  }

  const content = body?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Text AI response did not contain message content.");
  }

  return {
    data: JSON.parse(content) as T,
    usage: {
      provider: aiConfig.text.provider,
      model: aiConfig.text.model,
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
