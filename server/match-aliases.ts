import { createSupabaseServerClient } from "../lib/supabase/server";
import { buildCatalogMatchKey } from "./catalog-matching";

export type MatchAliasRecognizedItem = {
  id?: string;
  raw_name: string | null;
  brand?: string | null;
  size_text?: string | null;
  price_tag_text?: string | null;
  product_visible_text?: string | null;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type AliasRow = {
  id: string;
  normalized_key: string;
  catalog_product_id: string;
  confirmations: number;
};

export async function getAliasProductMap({
  companyId,
  items,
  supabase,
}: {
  companyId: string;
  items: MatchAliasRecognizedItem[];
  supabase: SupabaseServerClient;
}) {
  const keys = Array.from(new Set(items.map((item) => buildCatalogMatchKey(item)).filter(Boolean)));
  const map = new Map<string, string>();

  if (keys.length === 0) {
    return map;
  }

  const { data } = await supabase
    .from("aliases")
    .select("id, normalized_key, catalog_product_id, confirmations")
    .eq("company_id", companyId)
    .in("normalized_key", keys)
    .order("confirmations", { ascending: false })
    .returns<AliasRow[]>();

  for (const alias of data ?? []) {
    if (!map.has(alias.normalized_key)) {
      map.set(alias.normalized_key, alias.catalog_product_id);
    }
  }

  return map;
}

export async function saveMatchAlias({
  catalogProductId,
  companyId,
  item,
  supabase,
}: {
  catalogProductId: string;
  companyId: string;
  item: MatchAliasRecognizedItem;
  supabase: SupabaseServerClient;
}) {
  const normalizedKey = buildCatalogMatchKey(item);

  if (!normalizedKey) {
    return;
  }

  const { data: existing } = await supabase
    .from("aliases")
    .select("id, confirmations")
    .eq("company_id", companyId)
    .eq("normalized_key", normalizedKey)
    .eq("catalog_product_id", catalogProductId)
    .maybeSingle()
    .returns<{ id: string; confirmations: number } | null>();

  if (existing) {
    await supabase
      .from("aliases")
      .update({ confirmations: existing.confirmations + 1, last_confirmed_at: new Date().toISOString(), weight: 1 })
      .eq("company_id", companyId)
      .eq("id", existing.id);
    return;
  }

  await supabase.from("aliases").insert({
    company_id: companyId,
    normalized_key: normalizedKey,
    catalog_product_id: catalogProductId,
    weight: 1,
    confirmations: 1,
    last_confirmed_at: new Date().toISOString(),
  });
}

export async function saveMatchAliasForRecognizedItem({
  catalogProductId,
  companyId,
  recognizedItemId,
  supabase,
}: {
  catalogProductId: string;
  companyId: string;
  recognizedItemId: string;
  supabase: SupabaseServerClient;
}) {
  const { data: item } = await supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_tag_text, product_visible_text")
    .eq("company_id", companyId)
    .eq("id", recognizedItemId)
    .maybeSingle()
    .returns<MatchAliasRecognizedItem | null>();

  if (!item) {
    return;
  }

  await saveMatchAlias({ catalogProductId, companyId, item, supabase });
}
