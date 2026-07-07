"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

type ReviewStatus = "needs_review" | "confirmed" | "rejected" | "unmatched";

const REVIEW_ROLES = new Set(["admin", "manager", "reviewer"]);
const REVIEW_STATUSES = new Set<ReviewStatus>(["needs_review", "confirmed", "rejected", "unmatched"]);
const STATUSES_THAT_CLEAR_ACTIVE_MATCH = new Set<ReviewStatus>(["needs_review", "rejected", "unmatched"]);

export async function updateRecognizedItemStatus(formData: FormData): Promise<void> {
  const auth = await getReviewAuth(formData);
  const itemId = String(formData.get("item_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as ReviewStatus;

  if (!itemId) {
    throw new Error("Не указан товар.");
  }

  if (!REVIEW_STATUSES.has(status)) {
    throw new Error("Некорректный статус проверки.");
  }

  const { supabase, companyId, sessionId } = auth;
  const { error } = await supabase
    .from("recognized_items")
    .update({ status })
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("id", itemId);

  if (error) {
    throw new Error(`Не удалось обновить статус: ${error.message}`);
  }

  if (STATUSES_THAT_CLEAR_ACTIVE_MATCH.has(status)) {
    const { error: matchError } = await supabase
      .from("matches")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("recognized_item_id", itemId)
      .eq("is_active", true);

    if (matchError) {
      throw new Error(`Статус обновлён, но match не отключился: ${matchError.message}`);
    }
  }

  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);
}

export async function updateRecognizedItem(formData: FormData): Promise<void> {
  const auth = await getReviewAuth(formData);
  const itemId = String(formData.get("item_id") ?? "").trim();
  const rawName = String(formData.get("raw_name") ?? "").trim();

  if (!itemId) {
    throw new Error("Не указан товар.");
  }

  if (!rawName) {
    throw new Error("Название товара не может быть пустым.");
  }

  const { supabase, companyId, sessionId } = auth;
  const { error } = await supabase
    .from("recognized_items")
    .update({
      raw_name: rawName,
      brand: normalizeOptionalText(formData.get("brand")),
      size_text: normalizeOptionalText(formData.get("size_text")),
      price_minor: parsePriceToMinor(formData.get("price")),
      old_price_minor: parsePriceToMinor(formData.get("old_price")),
      promo_price_minor: parsePriceToMinor(formData.get("promo_price")),
      price_tag_text: normalizeOptionalText(formData.get("price_tag_text")),
      product_visible_text: normalizeOptionalText(formData.get("product_visible_text")),
      review_reason: normalizeOptionalText(formData.get("review_reason")),
      position_hint: normalizeOptionalText(formData.get("position_hint")),
      status: "needs_review",
    })
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("id", itemId);

  if (error) {
    throw new Error(`Не удалось сохранить правки: ${error.message}`);
  }

  const { error: matchError } = await supabase
    .from("matches")
    .update({ is_active: false })
    .eq("company_id", companyId)
    .eq("recognized_item_id", itemId)
    .eq("is_active", true);

  if (matchError) {
    throw new Error(`Правки сохранены, но старый match не отключился: ${matchError.message}`);
  }

  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);
}

async function getReviewAuth(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}` : "/app/monitoring";
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (!sessionId) {
    throw new Error("Не указана сессия мониторинга.");
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

  if (!REVIEW_ROLES.has(membershipResult.membership.role)) {
    throw new Error("Нет прав на проверку распознанных товаров.");
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
    throw new Error("Сессия не найдена в текущей компании.");
  }

  if (["completed", "cancelled"].includes(String(session.status))) {
    throw new Error("Нельзя править завершённую или отменённую сессию.");
  }

  return { supabase, companyId, sessionId };
}

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function parsePriceToMinor(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim().replace(/\s+/g, "").replace(",", ".");

  if (!text) {
    return null;
  }

  const parsed = Number(text);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}
