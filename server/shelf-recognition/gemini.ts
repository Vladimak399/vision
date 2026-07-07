import { getAiRuntimeConfig } from "../ai-config";
import type { ShelfRecognitionInput, ShelfRecognitionPayload, ShelfRecognitionResult } from "./types";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const SHELF_RECOGNITION_PROMPT = `
You analyze retail shelf photos for competitor price monitoring.

Extract visible product-price candidates from the whole shelf image.

Rules:
1. Price must come from a visible shelf price tag only. Never guess a price from packaging.
2. Product name may use shelf price tag text and visible package text nearby.
3. Link a price tag to a product only when their visual relationship is plausible.
4. If several products or price tags are close together and the link is unclear, set needs_review=true.
5. Never invent missing product names, prices, sizes, promotions, or brands.
6. Do not match items to any internal catalog.
7. Return prices in minor RUB units. Example: 399.99 RUB -> 39999.
8. If the photo is too blurry or unreadable, return an empty items array and explain in warnings.
9. Analyze the full photo: top shelves, bottom shelves, edges, and partially visible products.

Return only valid JSON with this shape:
{
  "items": [
    {
      "raw_name": string | null,
      "brand": string | null,
      "size_text": string | null,
      "price_minor": integer | null,
      "old_price_minor": integer | null,
      "promo_price_minor": integer | null,
      "currency": "RUB",
      "price_tag_text": string | null,
      "product_visible_text": string | null,
      "confidence": number,
      "link_confidence": number,
      "needs_review": boolean,
      "review_reason": string | null,
      "position_hint": string | null
    }
  ],
  "warnings": string[]
}
`.trim();

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    message?: string;
  };
};

export async function recognizeShelfPhotoWithGemini(input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const aiConfig = getAiRuntimeConfig();

  if (aiConfig.vision.provider !== "gemini") {
    throw new Error(`Vision provider ${aiConfig.vision.provider} is not Gemini.`);
  }

  const model = aiConfig.vision.model;
  const startedAt = Date.now();
  const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const imagePart = getInputImagePart(input);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: SHELF_RECOGNITION_PROMPT }, imagePart],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0,
      },
    }),
  });

  const body = (await response.json().catch(() => null)) as GeminiGenerateContentResponse | null;

  if (!response.ok) {
    throw new Error(body?.error?.message || `Gemini OCR request failed with status ${response.status}.`);
  }

  const outputText = extractOutputText(body);

  if (!outputText) {
    throw new Error("Gemini OCR response did not contain output text.");
  }

  const payload = parseShelfRecognitionPayload(outputText);
  const inputTokens = body?.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = body?.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    ...payload,
    usage: {
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_microusd: null,
      duration_ms: Date.now() - startedAt,
    },
  };
}

function getInputImagePart(input: ShelfRecognitionInput) {
  if ("imageUrl" in input && input.imageUrl) {
    return {
      file_data: {
        mime_type: "image/jpeg",
        file_uri: input.imageUrl,
      },
    };
  }

  if (!("imageBase64" in input) || !input.imageBase64 || !input.mimeType) {
    throw new Error("Provide either imageUrl or imageBase64 with mimeType.");
  }

  return {
    inline_data: {
      mime_type: input.mimeType,
      data: input.imageBase64,
    },
  };
}

function extractOutputText(response: GeminiGenerateContentResponse | null) {
  for (const candidate of response?.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return null;
}

function parseShelfRecognitionPayload(value: string): ShelfRecognitionPayload {
  const parsed = JSON.parse(stripMarkdownFence(value)) as ShelfRecognitionPayload;

  if (!Array.isArray(parsed.items) || !Array.isArray(parsed.warnings)) {
    throw new Error("Gemini OCR response did not match shelf recognition payload shape.");
  }

  return {
    items: parsed.items.map((item) => ({
      raw_name: nullableString(item.raw_name),
      brand: nullableString(item.brand),
      size_text: nullableString(item.size_text),
      price_minor: nullableNumber(item.price_minor),
      old_price_minor: nullableNumber(item.old_price_minor),
      promo_price_minor: nullableNumber(item.promo_price_minor),
      currency: "RUB",
      price_tag_text: nullableString(item.price_tag_text),
      product_visible_text: nullableString(item.product_visible_text),
      confidence: clampConfidence(item.confidence),
      link_confidence: clampConfidence(item.link_confidence),
      needs_review: Boolean(item.needs_review),
      review_reason: nullableString(item.review_reason),
      position_hint: nullableString(item.position_hint),
    })),
    warnings: parsed.warnings.filter((warning): warning is string => typeof warning === "string"),
  };
}

function stripMarkdownFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
