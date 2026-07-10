import type {
  LooseRecognitionItem,
  LooseRecognitionPayload,
  ShelfRecognitionItem,
  ShelfRecognitionPayload,
} from "./types";

/**
 * Общая нормализация распознанных элементов для всех провайдеров
 * (Gemini, OpenAI, OpenRouter). Чтобы не дублировать логику парсинга.
 */

export function parseRecognitionPayload(
  value: string,
  providerLabel: string,
): ShelfRecognitionPayload {
  let parsed = null;
  try {
    parsed = JSON.parse(stripMarkdownFence(value)) as
      | ShelfRecognitionPayload
      | LooseRecognitionPayload
      | LooseRecognitionItem[];
  } catch (error) {
    const msg = error instanceof Error ? error.message : "неизвестная ошибка парсинга";
    return { items: [], warnings: [], raw: value, normalizeError: msg };
  }

  if (!parsed || typeof parsed !== "object") {
    return { items: [], warnings: [], raw: parsed, normalizeError: "Пустой ответ от AI" };
  }
  // Если AI вернул массив items напрямую (без обёртки {items: [...]})
  if (Array.isArray(parsed)) {
    return {
      items: parsed
        .map(normalizeItem)
        .filter(
          (item) =>
            (item.raw_name && typeof item.raw_name === "string") ||
            item.price_tag_text ||
            item.product_visible_text ||
            item.price_minor !== null,
        ),
      warnings: [],
    };
  }

  const looseItems = getLooseItems(parsed);
  const looseWarnings = getLooseWarnings(parsed);

  if (!Array.isArray(looseItems)) {
    return {
      items: [],
      warnings: [
        ...looseWarnings,
        `${providerLabel} returned JSON without an item array. Treating response as empty OCR result.`,
      ],
    };
  }

  return {
    items: looseItems
      .map(normalizeItem)
      .filter(
        (item) =>
          (item.raw_name && typeof item.raw_name === "string") ||
          item.price_tag_text ||
          item.product_visible_text ||
          item.price_minor !== null,
      ),
    warnings: looseWarnings,
  };
}

export function normalizeItem(item: LooseRecognitionItem): ShelfRecognitionItem {
  return {
    raw_name:
      nullableString(item.raw_name) ??
      nullableString(item.name) ??
      nullableString(item.product_name) ??
      nullableString(item.product) ??
      nullableString(item.title) ??
      nullableString(item.price_tag_text) ??
      nullableString(item.product_visible_text),
    brand: nullableString(item.brand),
    size_text: nullableString(item.size_text),
    price_minor:
      nullableNumber(item.price_minor) ??
      parseRubPriceToMinor(item.price) ??
      parseRubPriceToMinor(item.price_text) ??
      parseRubPriceToMinor(item.current_price_minor) ??
      parseRubPriceToMinor(item.current_price),
    old_price_minor:
      nullableNumber(item.old_price_minor) ??
      parseRubPriceToMinor(item.old_price) ??
      parseRubPriceToMinor(item.old_price_text),
    promo_price_minor:
      nullableNumber(item.promo_price_minor) ??
      parseRubPriceToMinor(item.promo_price) ??
      parseRubPriceToMinor(item.promo_price_text),
    currency: "RUB",
    price_tag_text: nullableString(item.price_tag_text),
    product_visible_text:
      nullableString(item.product_visible_text) ??
      nullableString(item.packaging_text) ??
      nullableString(item.visible_text),
    confidence: clampConfidence(item.confidence),
    link_confidence: clampConfidence(item.link_confidence),
    needs_review: Boolean(item.needs_review),
    review_reason: nullableString(item.review_reason),
    position_hint: nullableString(item.position_hint) ?? nullableString(item.location),
  };
}

function getLooseItems(parsed: ShelfRecognitionPayload | LooseRecognitionPayload | LooseRecognitionItem[]) {
  if (Array.isArray(parsed)) return parsed as LooseRecognitionItem[];
  if (Array.isArray(parsed.items)) return parsed.items as LooseRecognitionItem[];
  if (Array.isArray((parsed as LooseRecognitionPayload).products)) return (parsed as LooseRecognitionPayload).products!;
  if (Array.isArray((parsed as LooseRecognitionPayload).results)) return (parsed as LooseRecognitionPayload).results!;
  const data = (parsed as LooseRecognitionPayload).data;
  if (Array.isArray(data)) return data as LooseRecognitionItem[];
  if (data && typeof data === "object") {
    if (Array.isArray(data.items)) return data.items as LooseRecognitionItem[];
    if (Array.isArray(data.products)) return data.products as LooseRecognitionItem[];
  }
  return null;
}

function getLooseWarnings(parsed: ShelfRecognitionPayload | LooseRecognitionPayload | LooseRecognitionItem[]) {
  if (Array.isArray(parsed)) return [];
  const loose = parsed as LooseRecognitionPayload;
  const rawWarnings =
    loose.warnings ?? (loose.data && !Array.isArray(loose.data) ? loose.data.warnings : null) ?? loose.warning;
  if (Array.isArray(rawWarnings)) {
    return rawWarnings.filter((w): w is string => typeof w === "string" && Boolean(w.trim()));
  }
  if (typeof rawWarnings === "string" && rawWarnings.trim()) return [rawWarnings.trim()];
  return [];
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function clampConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function parseRubPriceToMinor(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value > 9999 ? value : value * 100);
  }
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/,/g, ".")
    .match(/\d+(?:\.\d{1,2})?/u)?.[0];
  if (!normalized) return null;
  const price = Number(normalized);
  return Number.isFinite(price) ? Math.round(price * 100) : null;
}
