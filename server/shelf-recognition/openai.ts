import { getServerEnv } from "../../lib/env";
import { getAiRuntimeConfig } from "../ai-config";
import { estimateOcrCostMicrousd } from "../ocr-cost";
import type { ShelfRecognitionInput, ShelfRecognitionPayload, ShelfRecognitionResult } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const SHELF_RECOGNITION_PROMPT = `
You analyze retail shelf photos for competitor price monitoring.

Your task is exhaustive shelf price extraction, not a short summary.
Scan every shelf row top-to-bottom and left-to-right, including image edges and partially visible price tags.
Do not stop after 3-5 products: one readable shelf price tag should usually produce one item row.
If a product/price is only partially readable, return it with needs_review=true instead of omitting it.

Important rules:
1. Price must come from a visible shelf price tag only. Never guess a price from packaging.
2. Product name may use shelf price tag text and visible package text nearby.
3. Package text is only supporting evidence for brand, product name, flavor/type, and size.
4. Link a price tag to a product only when their visual relationship is plausible.
5. If several products or price tags are close together and the link is unclear, set needs_review=true.
6. Never invent missing product names, prices, sizes, promotions, or brands.
7. Do not match items to any internal catalog.
8. Return prices in minor RUB units. Example: 399.99 RUB -> 39999.
9. If the photo is too blurry or the text is unreadable, return an empty items array and explain in warnings.
10. Always fill position_hint with a short location such as "top shelf left", "middle shelf center", or "bottom shelf right".
11. Do not merge different flavors, sizes, aromas, or variants into one item.
12. Before responding, verify that you inspected top/middle/bottom shelves and included every readable price tag.

Confidence fields:
- confidence: how confident you are in extracted text and price.
- link_confidence: how confident you are that the price tag belongs to the visible product nearby.

Return only JSON matching the schema.
`.trim();

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

export async function recognizeShelfPhotoWithOpenAI(input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  const env = getServerEnv();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.vision.provider !== "openai") {
    throw new Error(`Vision provider ${aiConfig.vision.provider} is not supported for shelf photo OCR yet.`);
  }

  const model = aiConfig.vision.model;
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
