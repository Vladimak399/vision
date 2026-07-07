"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getAiRuntimeConfig } from "../../../../server/ai-config";
import { autoMatchRecognizedItems, type AutoMatchRecognizedItem } from "../../../../server/auto-catalog-matching";
import { getCurrentUser } from "../../../../server/auth";
import { getCatalogMatchCandidates, type CatalogMatchProduct } from "../../../../server/catalog-matching";
import { saveMatchAliasForRecognizedItem } from "../../../../server/match-aliases";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

export type MatchActionState = { error?: string; message?: string };

type MatchRow = { id: string; recognized_item_id: string; catalog_product_id: string };
type AiReviewCatalogProduct = CatalogMatchProduct & { external_sku: string | null; own_price_minor: number | null; currency: string | null };
type AiReviewItem = AutoMatchRecognizedItem & { price_minor: number | null };
type AiReviewTask = { item: AiReviewItem; candidates: ReturnType<typeof getCatalogMatchCandidates> };
type AiReviewDecision = { item_id?: string; decision?: string; catalog_product_id?: string | null; confidence?: number; reason?: string | null };
type BulkAcceptMatch = MatchRow & { score: number; decision: string; is_active: boolean; catalog_products: { size_text: string | null } | null };
type BulkAcceptItem = { id: string; size_text: string | null; matches: BulkAcceptMatch[] | null };

const MATCH_ROLES = new Set(["admin", "manager", "reviewer"]);
const AI_REVIEW_LIMIT = 25;

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

export async function aiReviewMatchesForSession(_state: MatchActionState, formData: FormData): Promise<MatchActionState> {
  const auth = await getMatchAuth(formData);
  if (!auth.ok) return { error: auth.error };

  const { companyId, department, sessionId, supabase, userId } = auth;
  const aiConfig = getAiRuntimeConfig();
  if (aiConfig.text.provider !== "gemini") return { error: "AI-review сейчас поддерживает только Gemini text provider." };
  const apiKey = process.env.AI_TEXT_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "GEMINI_API_KEY / AI_TEXT_API_KEY не настроен." };

  let itemsQuery = supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_tag_text, product_visible_text, price_minor")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["needs_review", "recognized"]);

  if (department === "none") itemsQuery = itemsQuery.is("department", null);
  else if (department) itemsQuery = itemsQuery.eq("department", department);

  const { data: items, error: itemsError } = await itemsQuery.limit(80).returns<AiReviewItem[]>();
  if (itemsError) return { error: `Не удалось загрузить товары для AI-review: ${itemsError.message}` };
  if (!items?.length) return { message: "Нет спорных товаров для AI-review." };

  const { data: products, error: productsError } = await supabase
    .from("catalog_products")
    .select("id, external_sku, name, brand, size_text, own_price_minor, currency, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(10000)
    .returns<AiReviewCatalogProduct[]>();

  if (productsError) return { error: `Не удалось загрузить каталог для AI-review: ${productsError.message}` };
  if (!products?.length) return { message: "Каталог пуст, AI-review невозможен." };

  const tasks = buildAiReviewTasks(items, products).slice(0, AI_REVIEW_LIMIT);
  if (!tasks.length) return { message: "Нет товаров с кандидатами для AI-review." };

  const decisions = await runGeminiAiMatchReview({ apiKey, model: aiConfig.text.model, tasks });
  const candidatesByItemId = new Map(tasks.map((task) => [task.item.id, new Set(task.candidates.map((candidate) => candidate.product.id))]));
  let suggested = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const decision of decisions) {
    const itemId = String(decision.item_id ?? "");
    const productId = decision.catalog_product_id ? String(decision.catalog_product_id) : "";
    const confidence = typeof decision.confidence === "number" && Number.isFinite(decision.confidence) ? Math.max(0, Math.min(decision.confidence, 0.89)) : 0.65;
    if (decision.decision !== "match" || !itemId || !productId || !candidatesByItemId.get(itemId)?.has(productId)) { skipped += 1; continue; }

    const { error: disableError } = await supabase.from("matches").update({ is_active: false }).eq("company_id", companyId).eq("recognized_item_id", itemId).eq("is_active", true);
    if (disableError) { errors.push(disableError.message); continue; }

    const { error: insertError } = await supabase.from("matches").insert({
      company_id: companyId,
      recognized_item_id: itemId,
      catalog_product_id: productId,
      score: confidence,
      decision: "ai_review",
      is_active: true,
      created_by: userId,
    });
    if (insertError) { errors.push(insertError.message); continue; }
    suggested += 1;
  }

  revalidateReview(sessionId);
  return { message: `AI-review завершён: предложено ${suggested}, пропущено ${skipped}, обработано ${tasks.length}, ошибок ${errors.length}. Статусы товаров не принимались автоматически.` };
}

export async function acceptHighConfidenceMatchesForSession(_state: MatchActionState, formData: FormData): Promise<MatchActionState> {
  const auth = await getMatchAuth(formData);
  if (!auth.ok) return { error: auth.error };

  const { companyId, department, sessionId, supabase } = auth;
  const threshold = 0.9;
  let query = supabase
    .from("recognized_items")
    .select("id, size_text, matches(id, score, decision, is_active, catalog_product_id, catalog_products(size_text))")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["needs_review", "recognized"]);

  if (department === "none") query = query.is("department", null);
  else if (department) query = query.eq("department", department);

  const { data: items, error: itemsError } = await query.returns<BulkAcceptItem[]>();
  if (itemsError) return { error: `Не удалось загрузить candidates: ${itemsError.message}` };

  let accepted = 0;
  let skippedMissingSize = 0;
  const errors: string[] = [];
  for (const item of items ?? []) {
    const match = item.matches?.find((candidate) => candidate.is_active && candidate.score >= threshold && candidate.decision !== "ai_review");
    if (!match) continue;

    if (shouldSkipBulkAcceptBySize(item.size_text, match.catalog_products?.size_text ?? null)) {
      skippedMissingSize += 1;
      continue;
    }

    const { error: matchError } = await supabase.from("matches").update({ decision: "accepted", is_active: true }).eq("company_id", companyId).eq("id", match.id).eq("is_active", true);
    if (matchError) { errors.push(matchError.message); continue; }

    const { error: itemError } = await supabase.from("recognized_items").update({ status: "matched" }).eq("company_id", companyId).eq("session_id", sessionId).eq("id", item.id);
    if (itemError) { errors.push(itemError.message); continue; }

    await saveMatchAliasForRecognizedItem({ catalogProductId: match.catalog_product_id, companyId, recognizedItemId: item.id, supabase });
    accepted += 1;
  }

  revalidateReview(sessionId);
  return { message: `Принято candidates >= 90%: ${accepted}. Пропущено без размера OCR: ${skippedMissingSize}. AI-review candidates не принимаются этой кнопкой автоматически. Ошибок ${errors.length}.` };
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

    await saveMatchAliasForRecognizedItem({ catalogProductId: match.catalog_product_id, companyId, recognizedItemId: match.recognized_item_id, supabase });
  } else {
    const { error: rejectError } = await supabase.from("matches").update({ decision: "rejected", is_active: false }).eq("company_id", companyId).eq("id", match.id);
    if (rejectError) throw new Error(`Не удалось отклонить match: ${rejectError.message}`);

    const { error: updateItemError } = await supabase.from("recognized_items").update({ status: "needs_review" }).eq("company_id", companyId).eq("session_id", sessionId).eq("id", match.recognized_item_id);
    if (updateItemError) throw new Error(`Статус товара не обновился: ${updateItemError.message}`);
  }

  revalidateReview(sessionId);
}

function buildAiReviewTasks(items: AiReviewItem[], products: AiReviewCatalogProduct[]): AiReviewTask[] {
  return items
    .map((item) => ({
      item,
      candidates: getCatalogMatchCandidates(
        { rawName: item.raw_name, brand: item.brand, sizeText: item.size_text, priceTagText: item.price_tag_text, productVisibleText: item.product_visible_text },
        products,
        { limit: 8 },
      ),
    }))
    .filter((task) => task.candidates.length > 0);
}

async function runGeminiAiMatchReview({ apiKey, model, tasks }: { apiKey: string; model: string; tasks: AiReviewTask[] }): Promise<AiReviewDecision[]> {
  const payload = {
    task: "Choose the safest catalog candidate for each recognized shelf item. Do not guess missing size or variant. If size is missing and several candidate sizes exist, return needs_review.",
    output: "Return JSON only: { decisions: [{ item_id, decision, catalog_product_id, confidence, reason }] }. decision is match or needs_review.",
    items: tasks.map((task) => ({
      item_id: task.item.id,
      recognized: { raw_name: task.item.raw_name, brand: task.item.brand, size_text: task.item.size_text, price_minor: task.item.price_minor, price_tag_text: task.item.price_tag_text, product_visible_text: task.item.product_visible_text },
      candidates: task.candidates.map((candidate) => ({ id: candidate.product.id, name: candidate.product.name, brand: candidate.product.brand, size_text: candidate.product.size_text, score: candidate.score, reasons: candidate.reasons })),
    })),
  };

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }], generationConfig: { response_mime_type: "application/json", temperature: 0 } }),
  });
  const json = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(json?.error?.message || `Gemini AI-review failed with status ${response.status}`);
  const text = json?.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => typeof part.text === "string" && part.text.trim())?.text;
  if (!text) return [];
  const parsed = JSON.parse(stripMarkdownFence(text)) as { decisions?: AiReviewDecision[] } | AiReviewDecision[];
  return Array.isArray(parsed) ? parsed : parsed.decisions ?? [];
}

function stripMarkdownFence(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

async function getMatchAuth(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const department = parseDepartment(formData.get("department"));
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}/review` : "/app/monitoring";
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!sessionId) return { ok: false as const, error: "Не указана сессия мониторинга." };

  let membershipResult;
  try { membershipResult = await getPrimaryCompanyMembership(); } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось проверить доступ к компании." }; }
  if (membershipResult.status !== "ok") return { ok: false as const, error: "Нет доступа к компании." };
  if (!MATCH_ROLES.has(membershipResult.membership.role)) return { ok: false as const, error: "Нет прав на подбор товаров." };

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase.from("monitoring_sessions").select("id, status").eq("company_id", companyId).eq("id", sessionId).maybeSingle();
  if (sessionError) return { ok: false as const, error: `Не удалось проверить сессию: ${sessionError.message}` };
  if (!session) return { ok: false as const, error: "Сессия не найдена." };
  if (["completed", "cancelled"].includes(String(session.status))) return { ok: false as const, error: "Нельзя менять товары в завершённой или отменённой сессии." };
  return { ok: true as const, companyId, department, sessionId, supabase, userId: user.id };
}

function shouldSkipBulkAcceptBySize(recognizedSize: string | null, catalogSize: string | null) {
  return !hasText(recognizedSize) && hasText(catalogSize);
}

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

function revalidateReview(sessionId: string) {
  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);
}

function parseDepartment(value: FormDataEntryValue | null) {
  const department = String(value ?? "").trim();
  return department === "products" || department === "chemistry" || department === "none" ? department : null;
}
