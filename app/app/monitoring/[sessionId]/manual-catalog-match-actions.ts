"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

type CatalogProductRow = {
  id: string;
  external_sku: string | null;
  name: string;
};

const MANUAL_MATCH_ROLES = new Set(["admin", "manager", "reviewer"]);

export async function createCorrectedCatalogMatch(formData: FormData): Promise<void> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const productId = String(formData.get("catalog_product_id") ?? "").trim();
  const query = String(formData.get("catalog_query") ?? "").trim();
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(sessionId ? `/app/monitoring/${sessionId}/review` : "/app/monitoring")}`);
  }

  if (!sessionId || !itemId) {
    throw new Error("Не указана сессия или товар.");
  }

  if (!productId && query.length < 3) {
    throw new Error("Выберите товар из подсказок, введите SKU или минимум 3 символа названия из каталога.");
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Не удалось проверить доступ к компании.");
  }

  if (membershipResult.status !== "ok") {
    throw new Error("Нет доступа к компании.");
  }

  if (!MANUAL_MATCH_ROLES.has(membershipResult.membership.role)) {
    throw new Error("Нет прав на ручное сопоставление.");
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(`Не удалось проверить сессию: ${sessionError.message}`);
  }

  if (!session) {
    throw new Error("Сессия не найдена.");
  }

  if (["completed", "cancelled"].includes(String(session.status))) {
    throw new Error("Нельзя менять товары в завершённой или отменённой сессии.");
  }

  const { data: item, error: itemError } = await supabase
    .from("recognized_items")
    .select("id")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    throw new Error(`Не удалось проверить товар: ${itemError.message}`);
  }

  if (!item) {
    throw new Error("Распознанный товар не найден.");
  }

  const product = await findCatalogProduct({ companyId, productId, query, supabase });

  const { error: disableMatchError } = await supabase
    .from("matches")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("recognized_item_id", itemId)
    .eq("is_active", true);

  if (disableMatchError) {
    throw new Error(`Не удалось отключить старые match: ${disableMatchError.message}`);
  }

  const { error: insertMatchError } = await supabase.from("matches").insert({
    company_id: companyId,
    recognized_item_id: itemId,
    catalog_product_id: product.id,
    score: 1,
    decision: "corrected",
    is_active: true,
    created_by: user.id,
  });

  if (insertMatchError) {
    throw new Error(`Не удалось сохранить ручной match: ${insertMatchError.message}`);
  }

  const { error: updateItemError } = await supabase
    .from("recognized_items")
    .update({ status: "matched" })
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("id", itemId);

  if (updateItemError) {
    throw new Error(`Match сохранён, но статус товара не обновился: ${updateItemError.message}`);
  }

  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);
}

async function findCatalogProduct({
  companyId,
  productId,
  query,
  supabase,
}: {
  companyId: string;
  productId: string;
  query: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  if (productId) {
    const { data: product, error: productError } = await supabase
      .from("catalog_products")
      .select("id, external_sku, name")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("id", productId)
      .maybeSingle()
      .returns<CatalogProductRow | null>();

    if (productError) {
      throw new Error(`Не удалось найти выбранный товар: ${productError.message}`);
    }

    if (!product) {
      throw new Error("Выбранный товар не найден в каталоге текущей компании.");
    }

    return product;
  }

  const { data: skuMatches, error: skuError } = await supabase
    .from("catalog_products")
    .select("id, external_sku, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .eq("external_sku", query)
    .limit(2)
    .returns<CatalogProductRow[]>();

  if (skuError) {
    throw new Error(`Не удалось найти товар по SKU: ${skuError.message}`);
  }

  if (skuMatches && skuMatches.length === 1) {
    return skuMatches[0];
  }

  const { data: nameMatches, error: nameError } = await supabase
    .from("catalog_products")
    .select("id, external_sku, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .ilike("name", `%${escapeLike(query)}%`)
    .limit(2)
    .returns<CatalogProductRow[]>();

  if (nameError) {
    throw new Error(`Не удалось найти товар по названию: ${nameError.message}`);
  }

  if (!nameMatches || nameMatches.length === 0) {
    throw new Error("Товар в нашем каталоге не найден. Можно оставить на проверке или отметить “Нет в ассортименте”.");
  }

  if (nameMatches.length > 1) {
    throw new Error("Найдено несколько похожих товаров. Уточните запрос или введите точный SKU.");
  }

  return nameMatches[0];
}

function escapeLike(value: string) {
  return value.replace(/[\%_]/g, (symbol) => `\${symbol}`);
}
