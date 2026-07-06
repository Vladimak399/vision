"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getCatalogMatchCandidates, type CatalogMatchProduct } from "../../../../server/catalog-matching";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

export type MatchActionState = {
  error?: string;
  message?: string;
};

type RecognizedItemRow = {
  id: string;
  raw_name: string | null;
  brand: string | null;
  size_text: string | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
};

type MatchRow = {
  id: string;
  recognized_item_id: string;
};

const MATCH_ROLES = new Set(["admin", "manager", "reviewer"]);
const AUTO_MATCH_MIN_SCORE = 0.68;
const CONFIDENT_MATCH_MIN_SCORE = 0.84;

export async function suggestCatalogMatchesForSession(_state: MatchActionState, formData: FormData): Promise<MatchActionState> {
  const auth = await getMatchAuth(formData);

  if (!auth.ok) {
    return { error: auth.error };
  }

  const { companyId, department, sessionId, supabase, userId } = auth;
  let itemsQuery = supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_tag_text, product_visible_text")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["needs_review", "recognized", "unmatched"])
    .limit(100)
    .returns<RecognizedItemRow[]>();

  if (department === "none") {
    itemsQuery = itemsQuery.is("department", null);
  } else if (department) {
    itemsQuery = itemsQuery.eq("department", department);
  }

  const { data: items, error: itemsError } = await itemsQuery;

  if (itemsError) {
    return { error: `Не удалось загрузить распознанные товары: ${itemsError.message}` };
  }

  if (!items || items.length === 0) {
    return { message: "Нет товаров для автоподбора." };
  }

  const itemIds = items.map((item) => item.id);
  const { error: oldMatchesError } = await supabase
    .from("matches")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .in("recognized_item_id", itemIds)
    .eq("decision", "auto")
    .eq("is_active", true);

  if (oldMatchesError) {
    return { error: `Не удалось обновить старые auto-match: ${oldMatchesError.message}` };
  }

  const { data: products, error: productsError } = await supabase
    .from("catalog_products")
    .select("id, name, brand, size_text, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(5000)
    .returns<CatalogMatchProduct[]>();

  if (productsError) {
    return { error: `Не удалось загрузить каталог: ${productsError.message}` };
  }

  if (!products || products.length === 0) {
    return { message: "В каталоге нет активных товаров." };
  }

  let suggested = 0;
  let strong = 0;
  let weak = 0;

  for (const item of items) {
    const candidates = getCatalogMatchCandidates(
      {
        rawName: item.raw_name,
        brand: item.brand,
        sizeText: item.size_text,
        priceTagText: item.price_tag_text,
        productVisibleText: item.product_visible_text,
      },
      products,
      { limit: 1 },
    );
    const best = candidates[0];

    if (!best || best.score < AUTO_MATCH_MIN_SCORE) {
      weak += 1;
      continue;
    }

    const { error: matchError } = await supabase.from("matches").insert({
      company_id: companyId,
      recognized_item_id: item.id,
      catalog_product_id: best.product.id,
      score: best.score,
      decision: "auto",
      is_active: true,
      created_by: userId,
    });

    if (matchError) {
      return { error: `Не удалось сохранить match: ${matchError.message}` };
    }

    suggested += 1;

    if (best.score >= CONFIDENT_MATCH_MIN_SCORE) {
      strong += 1;
      await supabase
        .from("recognized_items")
        .update({ status: "matched" })
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .eq("id", item.id);
    }
  }

  revalidateReview(sessionId);

  return { message: `Подбор завершён: кандидатов ${suggested}, сильных ${strong}, без уверенного совпадения ${weak}.` };
}

export async function updateCatalogMatchDecision(formData: FormData): Promise<void> {
  const auth = await getMatchAuth(formData);

  if (!auth.ok) {
    throw new Error(auth.error);
  }

  const { companyId, sessionId, supabase } = auth;
  const matchId = String(formData.get("match_id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();

  if (!matchId) {
    throw new Error("Не указан match.");
  }

  if (decision !== "accepted" && decision !== "rejected") {
    throw new Error("Некорректное решение по match.");
  }

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id, recognized_item_id")
    .eq("company_id", companyId)
    .eq("id", matchId)
    .eq("is_active", true)
    .maybeSingle()
    .returns<MatchRow | null>();

  if (matchError) {
    throw new Error(`Не удалось загрузить match: ${matchError.message}`);
  }

  if (!match) {
    throw new Error("Активный match не найден.");
  }

  if (decision === "accepted") {
    const { error: updateMatchError } = await supabase
      .from("matches")
      .update({ decision: "accepted", is_active: true })
      .eq("company_id", companyId)
      .eq("id", match.id);

    if (updateMatchError) {
      throw new Error(`Не удалось принять match: ${updateMatchError.message}`);
    }

    const { error: updateItemError } = await supabase
      .from("recognized_items")
      .update({ status: "confirmed" })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", match.recognized_item_id);

    if (updateItemError) {
      throw new Error(`Match принят, но статус товара не обновился: ${updateItemError.message}`);
    }
  } else {
    const { error: rejectMatchError } = await supabase
      .from("matches")
      .update({ decision: "rejected", is_active: false })
      .eq("company_id", companyId)
      .eq("id", match.id);

    if (rejectMatchError) {
      throw new Error(`Не удалось отклонить match: ${rejectMatchError.message}`);
    }

    const { error: updateItemError } = await supabase
      .from("recognized_items")
      .update({ status: "needs_review" })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", match.recognized_item_id);

    if (updateItemError) {
      throw new Error(`Match отклонён, но статус товара не обновился: ${updateItemError.message}`);
    }
  }

  revalidateReview(sessionId);
}

async function getMatchAuth(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const department = parseDepartment(formData.get("department"));
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}/review` : "/app/monitoring";
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (!sessionId) {
    return { ok: false as const, error: "Не указана сессия мониторинга." };
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось проверить доступ к компании." };
  }

  if (membershipResult.status !== "ok") {
    return { ok: false as const, error: "Нет доступа к компании." };
  }

  if (!MATCH_ROLES.has(membershipResult.membership.role)) {
    return { ok: false as const, error: "Нет прав на подбор товаров." };
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
    return { ok: false as const, error: `Не удалось проверить сессию: ${sessionError.message}` };
  }

  if (!session) {
    return { ok: false as const, error: "Сессия не найдена." };
  }

  if (["completed", "cancelled"].includes(String(session.status))) {
    return { ok: false as const, error: "Нельзя менять товары в завершённой или отменённой сессии." };
  }

  return { ok: true as const, companyId, department, sessionId, supabase, userId: user.id };
}

function revalidateReview(sessionId: string) {
  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);
}

function parseDepartment(value: FormDataEntryValue | null) {
  const department = String(value ?? "").trim();

  return department === "products" || department === "chemistry" || department === "none" ? department : null;
}
