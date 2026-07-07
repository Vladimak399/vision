import { getAiRuntimeConfig } from "../ai-config";
import type { ShelfRecognitionInput, ShelfRecognitionPayload, ShelfRecognitionResult } from "./types";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const FALLBACK_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 3;

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
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

type GeminiHttpError = Error & { status?: number };

export async function recognizeShelfPhotoWithGemini(input: ShelfRecognitionInput): Promise<ShelfRecognitionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не настроен. Добавьте переменную в Vercel Environment Variables.");

  const aiConfig = getAiRuntimeConfig();
  if (aiConfig.vision.provider !== "gemini") throw new Error("AI-провайдер отключен или не поддерживается. Проверьте AI_VISION_PROVIDER и AI_TEXT_PROVIDER.");

  const models = [aiConfig.vision.model];
  if (aiConfig.fallback.provider === "gemini" && aiConfig.fallback.model && aiConfig.fallback.model !== aiConfig.vision.model) {
    models.push(aiConfig.fallback.model);
  }

  let lastError: unknown;
  for (const [index, model] of models.entries()) {
    try {
      return await runGeminiVisionRequest({ apiKey, input, model });
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      if (index === 0 && FALLBACK_STATUSES.has(status ?? 0) && models.length > 1) continue;
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Не удалось выполнить Gemini OCR запрос.");
}

async function runGeminiVisionRequest({ apiKey, input, model }: { apiKey: string; input: ShelfRecognitionInput; model: string }) {
  const startedAt = Date.now();
  const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const imagePart = getInputImagePart(input);
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: SHELF_RECOGNITION_PROMPT }, imagePart] }],
    generationConfig: { response_mime_type: "application/json", temperature: 0 },
  });

  let responseBody: GeminiGenerateContentResponse | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    responseBody = (await response.json().catch(() => null)) as GeminiGenerateContentResponse | null;
    if (response.ok) break;
    const error = toGeminiHttpError(response.status, responseBody?.error?.message);
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) throw error;
    await sleep(250 * 2 ** (attempt - 1));
  }

  const outputText = extractOutputText(responseBody);
  if (!outputText) throw new Error("Gemini OCR response did not contain output text.");
  const payload = parseShelfRecognitionPayload(outputText);
  return {
    ...payload,
    usage: {
      model,
      input_tokens: responseBody?.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: responseBody?.usageMetadata?.candidatesTokenCount ?? 0,
      estimated_cost_microusd: null,
      duration_ms: Date.now() - startedAt,
    },
  };
}

function toGeminiHttpError(status: number, message: string | undefined): GeminiHttpError {
  const safeMessage = status === 429 ? "Превышен лимит Gemini API. Подождите и повторите запрос." : status === 503 ? "Gemini временно перегружен. Повторите позже или переключите модель в Vercel." : message || `Gemini OCR request failed with status ${status}.`;
  const error = new Error(safeMessage) as GeminiHttpError;
  error.status = status;
  return error;
}

function getErrorStatus(error: unknown) { return typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : null; }
function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function getInputImagePart(input: ShelfRecognitionInput) {
  if ("imageUrl" in input && input.imageUrl) return { file_data: { mime_type: "image/jpeg", file_uri: input.imageUrl } };
  if (!("imageBase64" in input) || !input.imageBase64 || !input.mimeType) throw new Error("Provide either imageUrl or imageBase64 with mimeType.");
  return { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } };
}
function extractOutputText(response: GeminiGenerateContentResponse | null) { for (const candidate of response?.candidates ?? []) for (const part of candidate.content?.parts ?? []) if (typeof part.text === "string" && part.text.trim()) return part.text; return null; }
function parseShelfRecognitionPayload(value: string): ShelfRecognitionPayload { const parsed = JSON.parse(stripMarkdownFence(value)) as ShelfRecognitionPayload; if (!Array.isArray(parsed.items) || !Array.isArray(parsed.warnings)) throw new Error("Gemini OCR response did not match shelf recognition payload shape."); return { items: parsed.items.map((item) => ({ raw_name: nullableString(item.raw_name), brand: nullableString(item.brand), size_text: nullableString(item.size_text), price_minor: nullableNumber(item.price_minor), old_price_minor: nullableNumber(item.old_price_minor), promo_price_minor: nullableNumber(item.promo_price_minor), currency: "RUB", price_tag_text: nullableString(item.price_tag_text), product_visible_text: nullableString(item.product_visible_text), confidence: clampConfidence(item.confidence), link_confidence: clampConfidence(item.link_confidence), needs_review: Boolean(item.needs_review), review_reason: nullableString(item.review_reason), position_hint: nullableString(item.position_hint) })), warnings: parsed.warnings.filter((warning): warning is string => typeof warning === "string") }; }
function stripMarkdownFence(value: string) { return value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(); }
function nullableString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function nullableNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null; }
function clampConfidence(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
