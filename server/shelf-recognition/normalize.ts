import type {
  LooseRecognitionItem,
  LooseRecognitionPayload,
  ShelfRecognitionItem,
  ShelfRecognitionBbox,
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
    bbox: normalizeBbox(item.bbox),
  };
}

function normalizeBbox(value: unknown): ShelfRecognitionBbox | null {
  if (Array.isArray(value) && value.length === 4) {
    const [yMin, xMin, yMax, xMax] = value.map(finiteNumber);
    if ([yMin, xMin, yMax, xMax].some((part) => part === null)) return null;
    return normalizeBbox({
      x: xMin!,
      y: yMin!,
      width: xMax! - xMin!,
      height: yMax! - yMin!,
    });
  }
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;
  let x = finiteNumber(raw.x ?? raw.left ?? raw.xmin ?? raw.x_min);
  let y = finiteNumber(raw.y ?? raw.top ?? raw.ymin ?? raw.y_min);
  let width = finiteNumber(raw.width ?? raw.w);
  let height = finiteNumber(raw.height ?? raw.h);
  const xMax = finiteNumber(raw.xmax ?? raw.x_max ?? raw.right);
  const yMax = finiteNumber(raw.ymax ?? raw.y_max ?? raw.bottom);

  if (width === null && x !== null && xMax !== null) width = xMax - x;
  if (height === null && y !== null && yMax !== null) height = yMax - y;

  if (x === null || y === null || width === null || height === null) return null;
  const maxCoordinate = Math.max(x, y, width, height, x + width, y + height);
  if (maxCoordinate > 2 && maxCoordinate <= 1000) {
    x /= 1000;
    y /= 1000;
    width /= 1000;
    height /= 1000;
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001) return null;

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

function finiteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
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
