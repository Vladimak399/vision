/**
 * Online Product Matching Module — TASK-21.6
 *
 * Сопоставление онлайн-товаров с каталогом:
 * 1. По штрихкоду (barcode/external_sku) — приоритетный, точный
 * 2. По fuzzy-поиску через getCatalogMatchCandidates()
 * 3. LLM batch для финального выбора
 *
 * Сохраняет результат в online_product_matches.
 */

import { getCatalogMatchCandidates, type CatalogMatchCandidate, type CatalogMatchProduct } from "../catalog-matching";
import { batchMatchCatalogItems, type BatchMatchInput, type BatchMatchItemResult, type BatchMatchResult } from "../text-ai/catalog-match-batch";
import { createSupabaseServiceRoleClient } from "../../lib/supabase/service-role";

/**
 * Статус сопоставления
 */
export type MatchStatus = "auto" | "needs_review" | "confirmed" | "rejected";

/**
 * Метод сопоставления
 */
export type MatchMethod = "barcode" | "fuzzy" | "llm" | "manual";

/**
 * Результат matching'а для одного онлайн-продукта
 */
export type OnlineMatchResult = {
  sourceProductId: string;
  catalogProductId: string | null;
  confidence: number;
  method: MatchMethod;
  status: MatchStatus;
  reason: string;
};

/**
 * Методы matching'а в порядке приоритета
 */
const MATCH_METHOD_PRIORITY: MatchMethod[] = ["barcode", "fuzzy", "llm"];

/**
 * Barcode match с каталогом.
 * Возвращает catalog_product_id если найден точный match по barcode.
 */
async function findBarcodeMatch(
  barcode: string | null,
  companyId: string
): Promise<{ catalogProductId: string | null; confidence: number } | null> {
  if (!barcode) {
    return null;
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data: product, error } = await supabase
    .from("catalog_products")
    .select("id")
    .eq("company_id", companyId)
    .eq("external_sku", barcode)
    .eq("is_active", true)
    .single();

  if (error || !product) {
    return null;
  }

  return {
    catalogProductId: product.id,
    confidence: 1.0, // Точное совпадение по barcode
  };
}

/**
 * Get catalog products for matching (active only).
 * Используется как источник кандидатов для fuzzy и LLM matching.
 */
async function getCatalogProducts(companyId: string): Promise<CatalogMatchProduct[]> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: products, error } = await supabase
    .from("catalog_products")
    .select("id, name, brand, size_text")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (error || !products) {
    return [];
  }

  return products.map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    size_text: p.size_text,
  }));
}

/**
 * Проверка существующего confirmed/auto match для онлайн-продукта.
 * Возвращает существующий match, если он уже проверен.
 */
async function getExistingMatch(
  sourceProductId: string
): Promise<{ catalogProductId: string; confidence: number; method: MatchMethod; status: MatchStatus } | null> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: match, error } = await supabase
    .from("online_product_matches")
    .select("catalog_product_id, confidence, method, status")
    .eq("source_product_id", sourceProductId)
    .in("status", ["auto", "confirmed"])
    .order("matched_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !match) {
    return null;
  }

  return {
    catalogProductId: match.catalog_product_id,
    confidence: match.confidence,
    method: match.method,
    status: match.status,
  };
}

/**
 * Сохранить результат matching'а в БД.
 */
async function saveMatch(
  companyId: string,
  sourceProductId: string,
  catalogProductId: string | null,
  confidence: number,
  method: MatchMethod,
  status: MatchStatus,
  reason: string
): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();

  await supabase.from("online_product_matches").upsert({
    company_id: companyId,
    source_product_id: sourceProductId,
    catalog_product_id: catalogProductId,
    confidence,
    method,
    status,
    reason,
    matched_at: new Date().toISOString(),
  });
}

/**
 * Сопоставление одного онлайн-продукта с каталогом.
 *
 * Алгоритм:
 * 1. Если уже есть confirmed/auto match — возвращаем его (экономия LLM)
 * 2. По barcode — если найден, сохраняем как auto с высокой confidence
 * 3. Fuzzy поиск + LLM batch
 */
export async function matchOnlineProduct(
  companyId: string,
  sourceProductId: string,
  rawName: string | null,
  barcode: string | null,
  brand: string | null,
  sizeText: string | null
): Promise<OnlineMatchResult> {
  // 1. Проверяем существующий match
  const existingMatch = await getExistingMatch(sourceProductId);
  if (existingMatch) {
    return {
      sourceProductId,
      catalogProductId: existingMatch.catalogProductId,
      confidence: existingMatch.confidence,
      method: existingMatch.method,
      status: existingMatch.status,
      reason: "Existing match (cached)",
    };
  }

  // 2. Barcode match (приоритетный)
  const barcodeMatch = await findBarcodeMatch(barcode, companyId);
  if (barcodeMatch?.catalogProductId) {
    const status: MatchStatus = "auto";
    await saveMatch(
      companyId,
      sourceProductId,
      barcodeMatch.catalogProductId,
      barcodeMatch.confidence,
      "barcode",
      status,
      "Barcode match"
    );

    return {
      sourceProductId,
      catalogProductId: barcodeMatch.catalogProductId,
      confidence: barcodeMatch.confidence,
      method: "barcode",
      status,
      reason: "Barcode match",
    };
  }

  // 3. Fuzzy + LLM matching
  const catalogProducts = await getCatalogProducts(companyId);
  const candidates = getCatalogMatchCandidates(
    {
      rawName,
      brand,
      sizeText,
    },
    catalogProducts,
    { limit: 10 }
  );

  if (candidates.length === 0) {
    const result: OnlineMatchResult = {
      sourceProductId,
      catalogProductId: null,
      confidence: 0,
      method: "fuzzy",
      status: "needs_review",
      reason: "No candidates found in catalog",
    };
    await saveMatch(companyId, sourceProductId, null, 0, "fuzzy", "needs_review", "No candidates found");
    return result;
  }

  // 4. LLM batch для выбора из кандидатов
  const batchInput: BatchMatchInput = {
    localId: sourceProductId,
    rawName,
    brand,
    sizeText,
    candidates,
  };

  const batchResult = await batchMatchCatalogItems([batchInput]);
  const llmResult = batchResult.results[0];

  const status: MatchStatus = llmResult.catalogProductId ? "auto" : "needs_review";
  const method: MatchMethod = llmResult.catalogProductId ? "llm" : "llm";

  await saveMatch(
    companyId,
    sourceProductId,
    llmResult.catalogProductId,
    llmResult.confidence,
    method,
    status,
    llmResult.reason || "LLM match"
  );

  return {
    sourceProductId,
    catalogProductId: llmResult.catalogProductId,
    confidence: llmResult.confidence,
    method,
    status,
    reason: llmResult.reason,
  };
}

/**
 * Batch matching для множества онлайн-продуктов.
 * Оптимизирован: использует один LLM запрос для всех товаров.
 */
export async function matchOnlineProductsBatch(
  companyId: string,
  products: Array<{
    sourceProductId: string;
    rawName: string | null;
    barcode: string | null;
    brand: string | null;
    sizeText: string | null;
  }>
): Promise<OnlineMatchResult[]> {
  if (products.length === 0) {
    return [];
  }

  const catalogProducts = await getCatalogProducts(companyId);
  const results: OnlineMatchResult[] = [];

  // Сначала обрабатываем barcode matches (самый быстрый)
  const pendingForLlm: Array<{
    sourceProductId: string;
    rawName: string | null;
    barcode: string | null;
    brand: string | null;
    sizeText: string | null;
  }> = [];

  for (const product of products) {
    // Проверяем существующий match
    const existingMatch = await getExistingMatch(product.sourceProductId);
    if (existingMatch) {
      results.push({
        sourceProductId: product.sourceProductId,
        catalogProductId: existingMatch.catalogProductId,
        confidence: existingMatch.confidence,
        method: existingMatch.method,
        status: existingMatch.status,
        reason: "Existing match (cached)",
      });
      continue;
    }

    // Barcode match
    const barcodeMatch = await findBarcodeMatch(product.barcode, companyId);
    if (barcodeMatch?.catalogProductId) {
      await saveMatch(
        companyId,
        product.sourceProductId,
        barcodeMatch.catalogProductId,
        barcodeMatch.confidence,
        "barcode",
        "auto",
        "Barcode match"
      );
      results.push({
        sourceProductId: product.sourceProductId,
        catalogProductId: barcodeMatch.catalogProductId,
        confidence: barcodeMatch.confidence,
        method: "barcode",
        status: "auto",
        reason: "Barcode match",
      });
      continue;
    }

    pendingForLlm.push(product);
  }

  // LLM batch для остальных
  if (pendingForLlm.length > 0) {
    const batchInputs: BatchMatchInput[] = pendingForLlm.map((p) => ({
      localId: p.sourceProductId,
      rawName: p.rawName,
      brand: p.brand,
      sizeText: p.sizeText,
      candidates: getCatalogMatchCandidates(
        { rawName: p.rawName, brand: p.brand, sizeText: p.sizeText },
        catalogProducts,
        { limit: 10 }
      ),
    }));

    const batchResult = await batchMatchCatalogItems(batchInputs);

    for (const llmResult of batchResult.results) {
      const sourceProduct = pendingForLlm.find((p) => p.sourceProductId === llmResult.localId);
      if (!sourceProduct) continue;

      const status: MatchStatus = llmResult.catalogProductId ? "auto" : "needs_review";

      await saveMatch(
        companyId,
        sourceProduct.sourceProductId,
        llmResult.catalogProductId,
        llmResult.confidence,
        "llm",
        status,
        llmResult.reason || "LLM match"
      );

      results.push({
        sourceProductId: sourceProduct.sourceProductId,
        catalogProductId: llmResult.catalogProductId,
        confidence: llmResult.confidence,
        method: "llm",
        status,
        reason: llmResult.reason,
      });
    }
  }

  return results;
}