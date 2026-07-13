import { getServerEnv } from "../../lib/env";
import { getAiRuntimeConfig } from "../ai-config";
import { estimateOcrCostMicrousd } from "../ocr-cost";
import { SHELF_RECOGNITION_PROMPT } from "./prompt";
import type { ShelfRecognitionInput, ShelfRecognitionPayload, ShelfRecognitionResult } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";



const shelfRecognitionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "warnings"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "raw_name",
          "brand",
          "size_text",
          "price_minor",
          "old_price_minor",
          "promo_price_minor",
          "currency",
          "price_tag_text",
          "product_visible_text",
          "confidence",
          "link_confidence",
          "needs_review",
          "review_reason",
          "position_hint",
        ],
        properties: {
          raw_name: { type: ["string", "null"], description: "Best readable product name from price tag and/or package text." },
          brand: { type: ["string", "null"] },
          size_text: { type: ["string", "null"], description: "Visible weight, volume, count, or pack size." },
          price_minor: { type: ["integer", "null"], description: "Current price in minor RUB units." },
          old_price_minor: { type: ["integer", "null"], description: "Old crossed-out price in minor RUB units, if visible." },
          promo_price_minor: { type: ["integer", "null"], description: "Promotional price in minor RUB units, if separate from current price." },
          currency: { type: "string", enum: ["RUB"] },
          price_tag_text: { type: ["string", "null"], description: "Raw visible text from the shelf price tag." },
          product_visible_text: { type: ["string", "null"], description: "Raw visible text on product packaging near the price tag." },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          link_confidence: { type: "number", minimum: 0, maximum: 1 },
          needs_review: { type: "boolean" },
          review_reason: { type: ["string", "null"] },
          position_hint: { type: ["string", "null"], description: "Short human-readable location in the photo, for example: top left, center right, bottom shelf." },
        },
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

type OpenAIResponsesUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

type OpenAIResponsesPayload = {
  output_text?: string;
  usage?: OpenAIResponsesUsage;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

export async function recognizeShelfPhotoWithOpenAI(input: ShelfRecognitionInput, modelOverride?: string): Promise<ShelfRecognitionResult> {
  const env = getServerEnv();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const aiConfig = getAiRuntimeConfig();

  const model = modelOverride || aiConfig.vision.model;
  const startedAt = Date.now();
  const imageUrl = getInputImageUrl(input);

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: SHELF_RECOGNITION_PROMPT },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "shelf_recognition_response",
          schema: shelfRecognitionSchema,
          strict: true,
        },
      },
    }),
  });

  const responseBody = (await response.json().catch(() => null)) as OpenAIResponsesPayload | { error?: { message?: string } } | null;

  if (!response.ok) {
    const message = responseBody && "error" in responseBody ? responseBody.error?.message : null;
    throw new Error(message || `OpenAI OCR request failed with status ${response.status}.`);
  }

  const outputText = extractOutputText(responseBody as OpenAIResponsesPayload | null);

  if (!outputText) {
    throw new Error("OpenAI OCR response did not contain output text.");
  }

  const payload = parseShelfRecognitionPayload(outputText);
  const inputTokens = (responseBody as OpenAIResponsesPayload | null)?.usage?.input_tokens ?? 0;
  const outputTokens = (responseBody as OpenAIResponsesPayload | null)?.usage?.output_tokens ?? 0;

  return {
    ...payload,
    usage: {
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_microusd: estimateOcrCostMicrousd({ model, inputTokens, outputTokens }),
      duration_ms: Date.now() - startedAt,
    },
  };
}

function getInputImageUrl(input: ShelfRecognitionInput) {
  if ("imageUrl" in input && input.imageUrl) {
    return input.imageUrl;
  }

  if (!("imageBase64" in input) || !input.imageBase64 || !input.mimeType) {
    throw new Error("Provide either imageUrl or imageBase64 with mimeType.");
  }

  return `data:${input.mimeType};base64,${input.imageBase64}`;
}

function extractOutputText(response: OpenAIResponsesPayload | null) {
  if (!response) {
    return null;
  }

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  for (const output of response.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return null;
}

function parseShelfRecognitionPayload(value: string): ShelfRecognitionPayload {
  const parsed = JSON.parse(value) as ShelfRecognitionPayload;

  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.warnings)) {
    throw new Error("OpenAI OCR response did not match shelf recognition payload shape.");
  }

  return parsed;
}
