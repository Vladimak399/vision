import type { CatalogMatchCandidate } from "../catalog-matching";
import { runTextAiJson } from "./json-client";

/**
 * Батчевый matching: сопоставляет МНОГО распознанных товаров за один LLM-запрос.
 * Это в N раз дешевле и быстрее, чем отдельный запрос на каждый товар.
 *
 * Используется после распознавания фото полки: получаем ~20 товаров,
 * алгоритм для каждого отбирает кандидатов, затем один LLM-запрос сопоставляет все.
 */

export type BatchMatchInput = {
  /** Внутренний id распознанного товара (для связи с ответом LLM) */
  localId: string;
  rawName: string | null;
  brand?: string | null;
  sizeText?: string | null;
  candidates: CatalogMatchCandidate[];
};

export type BatchMatchItemResult = {
  localId: string;
  /** id товара каталога или null (нет совпадения / не уверен) */
  catalogProductId: string | null;
  confidence: number;
  reason: string;
};

export type BatchMatchResult = {
  results: BatchMatchItemResult[];
};

type LlmBatchPayload = {
  matches?: Array<{
    local_id?: string;
    catalog_product_id?: string | null;
    confidence?: number;
    reason?: string;
  }>;
};

const SYSTEM_PROMPT = `
You help with retail competitor price monitoring in Russia.
You will receive MULTIPLE recognized shelf items at once. For EACH item, decide which catalog candidate (if any) is the same product. Return matches for ALL items.

BUSINESS RULE (critical): flavor/aroma/taste does NOT matter for matching.
- "Milka with hazelnut Watermelon" and "Milka with hazelnut Peach" are the SAME product.
- Ignore flavor/aroma words entirely (арбуз, персик, клубника, малина, вишня, лимон, лаванда, etc).
- Match by: brand + product type + size/weight + key physical variant.
- "Шоколад Милка ДВОЙНАЯ НАЧИНКА ВИШНЯ" matches "Milka Двойная начинка Миндаль и Клубника" — flavor is irrelevant.

Rules per item:
- Match when brand + product type + size/weight are compatible.
- Different size/weight (90g vs 100g) = NOT same product.
- Different brand = NOT same product.
- Ignore: flavor, aroma, taste, pack quantity (1/10, 1/20), casing, transliteration (Milka=Милка), typos.
- If an item has NO matching candidate → catalog_product_id: null, confidence: 0.
- If recognized text is too generic (only brand, no product type) → null, confidence: 0.
- Never invent catalog products. Only choose from provided candidates.
- Brand may be empty in catalog — extract it from the product NAME text.

Return JSON: {"matches": [{"local_id": "...", "catalog_product_id": "uuid or null", "confidence": 0.0-1.0, "reason": "кратко по-русски"}, ...]}
Every input item MUST appear in the output matches array.
`.trim();

/**
 * Сопоставляет массив распознанных товаров с каталогом одним LLM-запросом.
 *
 * @param items распознанные товары + их кандидаты (уже отобранные алгоритмом)
 * @returns результат для каждого товара по localId
 */
export async function batchMatchCatalogItems(items: BatchMatchInput[]): Promise<BatchMatchResult> {
  if (items.length === 0) {
    return { results: [] };
  }

  // Если все товары без кандидатов — LLM не нужен.
  if (items.every((it) => it.candidates.length === 0)) {
    return {
      results: items.map((it) => ({
        localId: it.localId,
        catalogProductId: null,
        confidence: 0,
        reason: "Нет кандидатов в каталоге",
      })),
    };
  }

  const payload = {
    hint: "For each item, choose one catalog_product_id from its candidates, or null.",
    items: items.map((it) => ({
      local_id: it.localId,
      recognized: {
        name: it.rawName,
        brand: it.brand ?? null,
        size: it.sizeText ?? null,
      },
      candidates: it.candidates.slice(0, 10).map((c) => ({
        catalog_product_id: c.product.id,
        name: c.product.name,
        brand: c.product.brand,
        size_text: c.product.size_text,
      })),
    })),
  };

  const result = await runTextAiJson<LlmBatchPayload>({
    system: SYSTEM_PROMPT,
    user: JSON.stringify(payload),
  });

  return normalizeBatchResult(result.data, items);
}

function normalizeBatchResult(payload: LlmBatchPayload, inputs: BatchMatchInput[]): BatchMatchResult {
  const matches = Array.isArray(payload.matches) ? payload.matches : [];

  // Map по local_id для быстрого поиска.
  const byLocalId = new Map<string, BatchMatchItemResult>();
  for (const m of matches) {
    const localId = typeof m.local_id === "string" ? m.local_id : null;
    if (!localId) continue;
    const input = inputs.find((it) => it.localId === localId);
    if (!input) continue;

    const allowedIds = new Set(input.candidates.map((c) => c.product.id));
    const candidateId =
      typeof m.catalog_product_id === "string" && m.catalog_product_id !== "null"
        ? m.catalog_product_id
        : null;

    // Если LLM выбрал id не из кандидатов — игнорируем.
    const safeId = candidateId && allowedIds.has(candidateId) ? candidateId : null;

    const confidence = typeof m.confidence === "number" ? Math.max(0, Math.min(1, m.confidence)) : 0;

    byLocalId.set(localId, {
      localId,
      catalogProductId: safeId,
      confidence,
      reason: typeof m.reason === "string" ? m.reason : "",
    });
  }

  // Гарантируем что каждый входной товар есть в результате.
  const results: BatchMatchItemResult[] = inputs.map((it) => {
    return (
      byLocalId.get(it.localId) ?? {
        localId: it.localId,
        catalogProductId: null,
        confidence: 0,
        reason: "LLM не вернул результат для этого товара",
      }
    );
  });

  return { results };
}
