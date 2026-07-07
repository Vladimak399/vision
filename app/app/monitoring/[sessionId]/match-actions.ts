"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { autoMatchRecognizedItems, type AutoMatchRecognizedItem } from "../../../../server/auto-catalog-matching";
import { getCurrentUser } from "../../../../server/auth";
import { saveMatchAliasForRecognizedItem } from "../../../../server/match-aliases";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

export type MatchActionState = { error?: string; message?: string };

type MatchRow = { id: string; recognized_item_id: string; catalog_product_id: string };

const MATCH_ROLES = new Set(["admin", "manager", "reviewer"]);

export async function suggestCatalogMatchesForSession(_state: MatchActionState, formData: FormData): Promise<MatchActionState> {
  const auth = await getMatchAuth(formData);
  if (!auth.ok) return { error: auth.error };

  const { companyId, department, sessionId, supabase, userId } = auth;
  let itemsQuery = supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_tag_text, product_visible_text")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["needs_review", "recognized"]);

  if (department === "none") itemsQuery = itemsQuery.is("department", null);
  else if (department) itemsQuery = itemsQuery.eq("department", department);

  const { data: items, error: itemsError } = await itemsQuery.limit(250).returns<AutoMatchRecognizedItem[]>();
  if (itemsError) return { error: `Не удалось загрузить товары: ${itemsError.message}` };
  if (!items?.length) return { message: "Нет товаров для автоподбора." };

  const stats = await autoMatchRecognizedItems({ companyId, createdBy: userId, items, sessionId, supabase });

  revalidateReview(sessionId);
  return {
    message: `Подбор завершён: сопоставлено автоматически ${stats.autoMatched}, предложено кандидатов ${stats.suggested}, без кандидата ${stats.noCandidate}. Ошибок ${stats.errors.length}.`,
  };
}


export async function acceptHighConfidenceCandidatesForSession(_state: MatchActionState, formData: FormData): Promise<MatchActionState> {
  const auth = await getMatchAuth(formData);
  if (!auth.ok) return { error: auth.error };

  const { companyId, department, sessionId, supabase } = auth;
  let query = supabase
    .from("recognized_items")
    .select("id, matches(id, score, is_active, catalog_product_id)")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["needs_review", "recognized"]);

  if (department === "none") query = query.is("department", null);
  else if (department) query = query.eq("department", department);

  const { data: items, error } = await query.limit(500).returns<Array<{ id: string; matches: Array<{ id: string; score: number; is_active: boolean; catalog_product_id: string }> | null }>>();
  if (error) return { error: `Не удалось загрузить кандидаты: ${error.message}` };

  let accepted = 0;
  for (const item of items ?? []) {
    const activeMatch = item.matches?.find((match) => match.is_active && match.score >= 0.9);
    if (!activeMatch) continue;

    const { error: matchError } = await supabase
      .from("matches")
      .update({ decision: "accepted", is_active: true })
      .eq("company_id", companyId)
      .eq("id", activeMatch.id)
      .eq("is_active", true);
    if (matchError) return { error: `Не удалось принять candidate: ${matchError.message}` };

    const { error: itemError } = await supabase
      .from("recognized_items")
      .update({ status: "matched" })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", item.id);
    if (itemError) return { error: `Не удалось обновить статус: ${itemError.message}` };

    await saveMatchAliasForRecognizedItem({ catalogProductId: activeMatch.catalog_product_id, companyId, recognizedItemId: item.id, supabase });
    accepted += 1;
  }

  revalidateReview(sessionId);
  return { message: `Принято уверенных candidates: ${accepted}. Низкие и спорные строки оставлены на проверку.` };
}

export async function updateCatalogMatchDecision(formData: FormData): Promise<void> {
  const auth = await getMatchAuth(formData);
  if (!auth.ok) throw new Error(auth.error);

  const { companyId, sessionId, supabase } = auth;
  const matchId = String(formData.get("match_id") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  if (!matchId) throw new Error("Не указан match.");
  if (decision !== "accepted" && decision !== "rejected") throw new Error("Некорректное решение по match.");

  const { data: match, error: matchError } = await supabase
    .from("matches")
    .select("id, recognized_item_id, catalog_product_id")
    .eq("company_id", companyId)
    .eq("id", matchId)
    .eq("is_active", true)
    .maybeSingle()
    .returns<MatchRow | null>();
  if (matchError) throw new Error(`Не удалось загрузить match: ${matchError.message}`);
  if (!match) throw new Error("Активный match не найден.");

  if (decision === "accepted") {
    const { error: disableError } = await supabase
      .from("matches")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("recognized_item_id", match.recognized_item_id)
      .eq("is_active", true)
      .neq("id", match.id);
    if (disableError) throw new Error(`Не удалось отключить другие match: ${disableError.message}`);

    const { error: updateMatchError } = await supabase
      .from("matches")
      .update({ decision: "accepted", is_active: true })
      .eq("company_id", companyId)
      .eq("id", match.id);
    if (updateMatchError) throw new Error(`Не удалось принять match: ${updateMatchError.message}`);

    const { error: updateItemError } = await supabase
      .from("recognized_items")
      .update({ status: "matched" })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", match.recognized_item_id);
    if (updateItemError) throw new Error(`Статус товара не обновился: ${updateItemError.message}`);

    await saveMatchAliasForRecognizedItem({
      catalogProductId: match.catalog_product_id,
      companyId,
      recognizedItemId: match.recognized_item_id,
      supabase,
    });
  } else {
    const { error: rejectError } = await supabase
      .from("matches")
      .update({ decision: "rejected", is_active: false })
      .eq("company_id", companyId)
      .eq("id", match.id);
    if (rejectError) throw new Error(`Не удалось отклонить match: ${rejectError.message}`);

    const { error: updateItemError } = await supabase
      .from("recognized_items")
      .update({ status: "needs_review" })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", match.recognized_item_id);
    if (updateItemError) throw new Error(`Статус товара не обновился: ${updateItemError.message}`);
  }

  revalidateReview(sessionId);
}

async function getMatchAuth(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const department = parseDepartment(formData.get("department"));
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}/review` : "/app/monitoring";
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!sessionId) return { ok: false as const, error: "Не указана сессия мониторинга." };

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось проверить доступ к компании." };
  }

  if (membershipResult.status !== "ok") return { ok: false as const, error: "Нет доступа к компании." };
  if (!MATCH_ROLES.has(membershipResult.membership.role)) return { ok: false as const, error: "Нет прав на подбор товаров." };

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return { ok: false as const, error: `Не удалось проверить сессию: ${sessionError.message}` };
  if (!session) return { ok: false as const, error: "Сессия не найдена." };
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
