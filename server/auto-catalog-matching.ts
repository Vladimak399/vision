import { createSupabaseServerClient } from "../lib/supabase/server";
import { buildCatalogMatchKey, getCatalogMatchCandidates, type CatalogMatchProduct, type RecognizedMatchInput } from "./catalog-matching";
import { getAliasProductMap } from "./match-aliases";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type AutoMatchRecognizedItem = {
  id: string;
  raw_name: string | null;
  brand: string | null;
  size_text: string | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
};

type AutoMatchCatalogProduct = CatalogMatchProduct & {
  external_sku: string | null;
  own_price_minor: number | null;
  currency: string | null;
};

export type AutoMatchStats = {
  items: number;
  autoMatched: number;
  suggested: number;
  noCandidate: number;
  errors: string[];
};

const AUTO_MATCH_SCORE = 0.9;
const AUTO_MATCH_MARGIN = 0.08;
const SUGGESTION_SCORE = 0.66;
const FAMILY_SUGGESTION_SCORE = 0.52;

export async function autoMatchRecognizedItems({ companyId, createdBy, items, sessionId, supabase }: {
  companyId: string;
  createdBy?: string | null;
  items: AutoMatchRecognizedItem[];
  sessionId: string;
  supabase: SupabaseServerClient;
}): Promise<AutoMatchStats> {
  const stats: AutoMatchStats = { items: items.length, autoMatched: 0, suggested: 0, noCandidate: 0, errors: [] };

  if (items.length === 0) return stats;

  const { data: products, error: productsError } = await supabase
    .from("catalog_products")
    .select("id, external_sku, name, brand, size_text, own_price_minor, currency, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(10000)
    .returns<AutoMatchCatalogProduct[]>();

  if (productsError) {
    stats.errors.push(`Не удалось загрузить каталог для auto-match: ${productsError.message}`);
    return stats;
  }

  if (!products?.length) {
    stats.noCandidate = items.length;
    return stats;
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const aliasMap = await getAliasProductMap({ companyId, items, supabase });

  for (const item of items) {
    const input = toRecognizedMatchInput(item);
    const aliasProductId = aliasMap.get(buildCatalogMatchKey(input));
    const aliasProduct = aliasProductId ? productsById.get(aliasProductId) : null;
    const candidates = aliasProduct
      ? [{ product: aliasProduct, score: 0.99, reasons: ["learned_alias"] }]
      : getCatalogMatchCandidates(input, products, { limit: 5 });
    const best = candidates[0];
    const second = candidates[1];

    if (!best || !isSuggestionCandidate(best)) {
      stats.noCandidate += 1;
      continue;
    }

    const isAmbiguousFamily = best.reasons.includes("missing_size_review") || best.reasons.includes("multiple_catalog_sizes_review");
    const isConfident = !isAmbiguousFamily && best.score >= AUTO_MATCH_SCORE && (!second || best.score - second.score >= AUTO_MATCH_MARGIN);

    const { error: disableError } = await supabase
      .from("matches")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("recognized_item_id", item.id)
      .eq("is_active", true);

    if (disableError) {
      stats.errors.push(`Не удалось отключить старый match для ${item.id}: ${disableError.message}`);
      continue;
    }

    const { error: insertError } = await supabase.from("matches").insert({
      company_id: companyId,
      recognized_item_id: item.id,
      catalog_product_id: best.product.id,
      score: best.score,
      decision: "auto",
      is_active: true,
      created_by: createdBy ?? null,
    });

    if (insertError) {
      stats.errors.push(`Не удалось создать match для ${item.id}: ${insertError.message}`);
      continue;
    }

    if (isConfident) {
      const { error: updateError } = await supabase
        .from("recognized_items")
        .update({ status: "matched" })
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .eq("id", item.id);
      if (updateError) {
        stats.errors.push(`Match создан, но статус не обновился для ${item.id}: ${updateError.message}`);
        continue;
      }
      stats.autoMatched += 1;
    } else {
      stats.suggested += 1;
    }
  }

  return stats;
}

function isSuggestionCandidate(candidate: { score: number; reasons: string[] }) {
  if (candidate.score >= SUGGESTION_SCORE) return true;
  return candidate.score >= FAMILY_SUGGESTION_SCORE && candidate.reasons.includes("product_family");
}

function toRecognizedMatchInput(item: AutoMatchRecognizedItem): RecognizedMatchInput {
  return {
    rawName: item.raw_name,
    brand: item.brand,
    sizeText: item.size_text,
    priceTagText: item.price_tag_text,
    productVisibleText: item.product_visible_text,
  };
}
