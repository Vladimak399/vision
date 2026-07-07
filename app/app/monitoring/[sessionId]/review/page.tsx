import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCatalogMatchCandidates, type CatalogMatchCandidate, type CatalogMatchProduct } from "../../../../../server/catalog-matching";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import { MatchControls } from "../match-controls";
import { updateCatalogMatchDecision } from "../match-actions";
import { RecognizedItemReviewControls } from "../recognized-item-review-controls";

type ReviewDepartmentFilter = "all" | "products" | "chemistry" | "none";
type ReviewCandidateFilter = "all" | "with_candidate" | "without_candidate";
type ReviewStatusFilter = "all" | "todo" | "ready" | "problem";
type ReviewQueueFilter = "all" | "ai_candidate" | "size_risk" | "missing_own_price" | "missing_competitor_price" | "low_ocr_confidence" | "low_link_confidence" | "unmatched";
type BadgeTone = "neutral" | "info" | "warning" | "danger";

type ReviewPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{ department?: string; candidates?: string; status?: string; queue?: string }>;
};

type ReviewMatch = {
  id: string;
  score: number;
  decision: string;
  is_active: boolean;
  catalog_products: { external_sku: string | null; name: string; brand: string | null; size_text: string | null; own_price_minor: number | null; currency: string | null } | null;
};

type ReviewItem = {
  id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string;
  confidence: number;
  link_confidence: number | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  review_reason: string | null;
  position_hint: string | null;
  department: string | null;
  status: string;
  created_at: string;
  monitoring_photos: { storage_path: string } | null;
  matches: ReviewMatch[] | null;
};

type SessionRow = { id: string; status: string; stores: { name: string; address: string | null } | null };

type ReviewCatalogProduct = CatalogMatchProduct & { external_sku: string | null; own_price_minor: number | null; currency: string | null };
type ReviewCatalogSuggestion = Omit<CatalogMatchCandidate, "product"> & { product: ReviewCatalogProduct };
type ReviewBadge = { label: string; tone: BadgeTone };

type QueueStats = {
  aiCandidate: number;
  sizeRisk: number;
  missingOwnPrice: number;
  missingCompetitorPrice: number;
  lowOcrConfidence: number;
  lowLinkConfidence: number;
  unmatched: number;
};

const departmentFilters: Array<{ key: ReviewDepartmentFilter; label: string }> = [
  { key: "all", label: "Все" },
  { key: "products", label: "Продукты" },
  { key: "chemistry", label: "Химия" },
  { key: "none", label: "Без отдела" },
];

const REVIEW_STATUSES = ["recognized", "needs_review", "matched", "confirmed", "unmatched", "rejected"];
const LOW_OCR_CONFIDENCE = 0.75;
const LOW_LINK_CONFIDENCE = 0.75;

const statusFilters: Array<{ key: ReviewStatusFilter; label: string; description: string }> = [
  { key: "todo", label: "К проверке", description: "Распознано и На проверке" },
  { key: "all", label: "Все", description: "Без фильтра по статусу" },
  { key: "ready", label: "Готовые", description: "Сопоставлено, OCR подтверждён или Нет в ассортименте" },
  { key: "problem", label: "Проблемные", description: "Ошибка OCR или строки без кандидатов" },
];

const queueFilters: Array<{ key: ReviewQueueFilter; label: string; description: string }> = [
  { key: "all", label: "Все задачи", description: "Без дополнительного фильтра" },
  { key: "ai_candidate", label: "AI candidates", description: "Подсказки AI, которые надо принять руками" },
  { key: "size_risk", label: "Риск размера", description: "OCR не видит размер, а кандидат размерный" },
  { key: "missing_own_price", label: "Нет нашей цены", description: "У кандидата нет нашей цены" },
  { key: "missing_competitor_price", label: "Нет цены конкурента", description: "OCR не распознал цену конкурента" },
  { key: "low_ocr_confidence", label: "Низкий OCR", description: "Низкая уверенность распознавания" },
  { key: "low_link_confidence", label: "Низкая связь", description: "Низкая уверенность связи ценника" },
  { key: "unmatched", label: "Нет в ассортименте", description: "Только explicit unmatched" },
];

export default async function RecognizedItemsReviewPage({ params, searchParams }: ReviewPageProps) {
  const { sessionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const departmentFilter = parseDepartmentFilter(resolvedSearchParams.department);
  const candidateFilter = parseCandidateFilter(resolvedSearchParams.candidates);
  const statusFilter = parseStatusFilter(resolvedSearchParams.status);
  const queueFilter = parseQueueFilter(resolvedSearchParams.queue);
  const user = await getCurrentUser();

  if (!user) redirect(`/login?next=/app/monitoring/${encodeURIComponent(sessionId)}/review`);

  let membershipResult;
  try { membershipResult = await getPrimaryCompanyMembership(); } catch (error) { return <PageError message={error instanceof Error ? error.message : "Не удалось проверить доступ."} />; }
  if (membershipResult.status !== "ok") return <PageError message="Нет доступа к компании." />;
  if (!["admin", "manager", "reviewer"].includes(membershipResult.membership.role)) return <PageError message="Нет прав на проверку." />;

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase.from("monitoring_sessions").select("id, status, stores(name, address)").eq("company_id", companyId).eq("id", sessionId).maybeSingle().returns<SessionRow | null>();
  if (sessionError) return <PageError message={`Не удалось загрузить сессию: ${sessionError.message}`} />;
  if (!session) return <PageError message="Сессия не найдена." />;

  let itemsQuery = supabase
    .from("recognized_items")
    .select("id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, confidence, link_confidence, price_tag_text, product_visible_text, review_reason, position_hint, department, status, created_at, monitoring_photos(storage_path), matches(id, score, decision, is_active, catalog_products(external_sku, name, brand, size_text, own_price_minor, currency))")
    .eq("company_id", companyId)
    .eq("session_id", sessionId);

  if (departmentFilter === "none") itemsQuery = itemsQuery.is("department", null);
  else if (departmentFilter !== "all") itemsQuery = itemsQuery.eq("department", departmentFilter);

  const { data: items, error: itemsError } = await itemsQuery.order("created_at", { ascending: false }).returns<ReviewItem[]>();
  if (itemsError) return <PageError message={`Не удалось загрузить товары: ${itemsError.message}`} />;

  const { data: catalogProducts, error: catalogProductsError } = await supabase.from("catalog_products").select("id, external_sku, name, brand, size_text, own_price_minor, currency, is_active").eq("company_id", companyId).eq("is_active", true).limit(5000).returns<ReviewCatalogProduct[]>();

  const allItems = items ?? [];
  const suggestionsByItemId = buildSuggestionsByItemId(allItems, catalogProducts ?? []);
  const itemsAfterBasicFilters = filterItemsByStatus(filterItemsByCandidates(allItems, suggestionsByItemId, candidateFilter), suggestionsByItemId, statusFilter);
  const visibleItems = sortItemsForReview(filterItemsByQueue(itemsAfterBasicFilters, suggestionsByItemId, queueFilter), suggestionsByItemId);
  const counts = getStatusCounts(allItems);
  const needsReviewCount = (counts.recognized ?? 0) + (counts.needs_review ?? 0);
  const readyCount = (counts.matched ?? 0) + (counts.confirmed ?? 0) + (counts.unmatched ?? 0);
  const withoutCandidateCount = countItemsWithoutCandidates(allItems, suggestionsByItemId);
  const queueStats = countQueueStats(allItems, suggestionsByItemId);

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href={`/app/monitoring/${sessionId}`}>← Сессия</Link>
        <h1 style={{ margin: 0 }}>Проверка распознанных товаров</h1>
        <p style={{ margin: 0, color: "#4b5563" }}>{session.stores?.name ?? "Магазин"} · {session.stores?.address ?? "адрес не указан"} · статус сессии: {session.status}</p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {departmentFilters.map((filter) => <Link key={filter.key} href={getReviewHref(sessionId, { department: filter.key, candidates: candidateFilter, status: statusFilter, queue: queueFilter })} style={pillStyle(filter.key === departmentFilter)}>{filter.label}</Link>)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {[
            { key: "all", label: "Все candidates" },
            { key: "with_candidate", label: "С кандидатом" },
            { key: "without_candidate", label: "Без кандидата" },
          ].map((filter) => <Link key={filter.key} href={getReviewHref(sessionId, { department: departmentFilter, candidates: filter.key as ReviewCandidateFilter, status: statusFilter, queue: queueFilter })} style={pillStyle(filter.key === candidateFilter)}>{filter.label}</Link>)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {statusFilters.map((filter) => <Link key={filter.key} href={getReviewHref(sessionId, { department: departmentFilter, candidates: candidateFilter, status: filter.key, queue: queueFilter })} title={filter.description} style={pillStyle(filter.key === statusFilter)}>{filter.label}</Link>)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {queueFilters.map((filter) => <Link key={filter.key} href={getReviewHref(sessionId, { department: departmentFilter, candidates: candidateFilter, status: statusFilter, queue: filter.key })} title={filter.description} style={pillStyle(filter.key === queueFilter)}>{filter.label}</Link>)}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {Object.entries(counts).map(([status, count]) => <span key={status} style={countPillStyle}>{getStatusLabel(status)}: {count}</span>)}
        </div>
      </header>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb" }}>
        <strong>Готовность к выгрузке</strong>
        <p style={{ margin: "0.35rem 0 0", color: "#4b5563" }}>Готово: {readyCount}. Требует проверки: {needsReviewCount}. Без кандидатов: {withoutCandidateCount}. Сейчас показано: {visibleItems.length}. Нет в ассортименте считается только по явному статусу “Нет в ассортименте”. Отсутствие match не считается отсутствием товара.</p>
        <p style={{ margin: "0.35rem 0 0", color: "#4b5563" }}>Очереди: AI {queueStats.aiCandidate}, риск размера {queueStats.sizeRisk}, нет нашей цены {queueStats.missingOwnPrice}, нет цены конкурента {queueStats.missingCompetitorPrice}, низкий OCR {queueStats.lowOcrConfidence}, низкая связь {queueStats.lowLinkConfidence}.</p>
        <p style={{ margin: "0.35rem 0 0", color: "#4b5563" }}>Что проверять первым: без кандидата → риск размера → AI candidates → нет нашей цены → низкая уверенность OCR → остальные строки “На проверке”.</p>
        {catalogProductsError ? <p style={{ color: "#b45309", margin: "0.5rem 0 0" }}>Подсказки каталога недоступны: {catalogProductsError.message}</p> : null}
      </section>

      <MatchControls sessionId={sessionId} department={departmentFilter} />

      {visibleItems.length > 0 ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {visibleItems.map((item) => {
            const activeMatch = getActiveMatch(item.matches);
            const suggestions = suggestionsByItemId.get(item.id) ?? [];
            const badges = getReviewBadges(item, suggestions);
            return (
              <article key={item.id} style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", display: "grid", gap: "0.75rem" }}>
                <div style={{ display: "grid", gap: "0.25rem" }}>
                  <h2 style={{ margin: 0 }}>{item.raw_name}</h2>
                  <p style={{ margin: 0, color: "#4b5563" }}>Цена: {formatPrice(item.price_minor, item.currency)} · статус: {getStatusLabel(item.status)} · отдел: {getDepartmentLabel(item.department)} · уверенность: {formatConfidence(item.confidence)} · связь: {formatConfidence(item.link_confidence)}</p>
                  <BadgeList badges={badges} />
                </div>

                <dl style={{ display: "grid", gap: "0.35rem", margin: 0 }}>
                  <Info label="Бренд" value={item.brand} />
                  <Info label="Размер" value={item.size_text} />
                  <Info label="Старая цена" value={formatPrice(item.old_price_minor, item.currency)} />
                  <Info label="Акция" value={formatPrice(item.promo_price_minor, item.currency)} />
                  <Info label="Текст ценника" value={item.price_tag_text} />
                  <Info label="Текст товара" value={item.product_visible_text} />
                  <Info label="Причина проверки" value={item.review_reason} />
                  <Info label="Место" value={item.position_hint} />
                  <Info label="Фото" value={getStorageFilename(item.monitoring_photos?.storage_path ?? "") || "—"} />
                </dl>

                {activeMatch ? <ActiveMatchBlock sessionId={sessionId} item={item} match={activeMatch} suggestions={suggestions} /> : <p style={{ color: "#6b7280", margin: 0 }}>Совпадение с каталогом пока не подобрано.</p>}
                <RecognizedItemReviewControls sessionId={sessionId} item={item} suggestions={suggestions} />
              </article>
            );
          })}
        </div>
      ) : (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}><p style={{ margin: 0 }}>По выбранному фильтру товаров пока нет.</p></section>
      )}
    </main>
  );
}

function ActiveMatchBlock({ item, match, sessionId, suggestions }: { item: ReviewItem; match: ReviewMatch; sessionId: string; suggestions: ReviewCatalogSuggestion[] }) {
  const product = match.catalog_products;
  const sizeRisk = isSizeRisk(item, suggestions);
  const missingOwnPrice = product?.own_price_minor === null;
  return (
    <section style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, display: "grid", gap: "0.5rem", padding: "0.75rem" }}>
      <strong>Кандидат из каталога</strong>
      <p style={{ margin: 0 }}>{product?.name ?? "Товар не найден"}</p>
      <p style={{ color: "#4b5563", margin: 0 }}>SKU: {product?.external_sku ?? "—"} · бренд: {product?.brand ?? "—"} · размер: {product?.size_text ?? "—"} · наша цена: {formatPrice(product?.own_price_minor ?? null, product?.currency ?? "RUB")} · score: {formatConfidence(match.score)} · decision: {match.decision}</p>
      {match.decision === "ai_review" ? <p style={noticeStyle("info")}>Это подсказка AI. Не принято автоматически.</p> : null}
      {sizeRisk ? <p style={noticeStyle("warning")}>OCR не распознал размер. Проверь граммовку перед ручным принятием.</p> : null}
      {missingOwnPrice ? <p style={noticeStyle("warning")}>У кандидата нет нашей цены. Сравнение уйдёт на проверку.</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <form action={updateCatalogMatchDecision}><input type="hidden" name="session_id" value={sessionId} /><input type="hidden" name="match_id" value={match.id} /><input type="hidden" name="decision" value="accepted" /><button type="submit">Принять</button></form>
        <form action={updateCatalogMatchDecision}><input type="hidden" name="session_id" value={sessionId} /><input type="hidden" name="match_id" value={match.id} /><input type="hidden" name="decision" value="rejected" /><button type="submit">Отклонить</button></form>
      </div>
    </section>
  );
}

function BadgeList({ badges }: { badges: ReviewBadge[] }) {
  if (!badges.length) return null;
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{badges.map((badge) => <span key={badge.label} style={badgeStyle(badge.tone)}>{badge.label}</span>)}</div>;
}

function Info({ label, value }: { label: string; value: string | null }) {
  return <div style={{ display: "grid", gap: "0.25rem", gridTemplateColumns: "160px 1fr" }}><dt style={{ color: "#4b5563" }}>{label}</dt><dd style={{ margin: 0 }}>{value || "—"}</dd></div>;
}

function PageError({ message }: { message: string }) {
  return <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}><Link href="/app/monitoring">← Мониторинг</Link><h1>Проверка недоступна</h1><p>{message}</p></main>;
}

function buildSuggestionsByItemId(items: ReviewItem[], products: ReviewCatalogProduct[]) {
  const suggestions = new Map<string, ReviewCatalogSuggestion[]>();
  if (products.length === 0) return suggestions;
  for (const item of items) {
    suggestions.set(item.id, getCatalogMatchCandidates({ rawName: item.raw_name, brand: item.brand, sizeText: item.size_text, priceTagText: item.price_tag_text, productVisibleText: item.product_visible_text }, products, { limit: 10 }) as ReviewCatalogSuggestion[]);
  }
  return suggestions;
}

function getStatusCounts(items: ReviewItem[]) {
  const counts = REVIEW_STATUSES.reduce<Record<string, number>>((accumulator, status) => { accumulator[status] = 0; return accumulator; }, {});
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

function parseDepartmentFilter(value: string | undefined): ReviewDepartmentFilter { return value === "products" || value === "chemistry" || value === "none" ? value : "all"; }
function parseCandidateFilter(value: string | undefined): ReviewCandidateFilter { return value === "with_candidate" || value === "without_candidate" ? value : "all"; }
function parseStatusFilter(value: string | undefined): ReviewStatusFilter { return value === "all" || value === "ready" || value === "problem" ? value : "todo"; }
function parseQueueFilter(value: string | undefined): ReviewQueueFilter { return queueFilters.some((filter) => filter.key === value) ? value as ReviewQueueFilter : "all"; }

function filterItemsByCandidates(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>, filter: ReviewCandidateFilter) {
  if (filter === "all") return items;
  return items.filter((item) => filter === "with_candidate" ? hasCandidate(item, suggestionsByItemId) : !hasCandidate(item, suggestionsByItemId));
}

function filterItemsByStatus(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>, filter: ReviewStatusFilter) {
  if (filter === "all") return items;
  if (filter === "todo") return items.filter((item) => item.status === "recognized" || item.status === "needs_review");
  if (filter === "ready") return items.filter((item) => item.status === "matched" || item.status === "confirmed" || item.status === "unmatched");
  return items.filter((item) => item.status === "rejected" || !hasCandidate(item, suggestionsByItemId));
}

function filterItemsByQueue(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>, filter: ReviewQueueFilter) {
  if (filter === "all") return items;
  return items.filter((item) => {
    const suggestions = suggestionsByItemId.get(item.id) ?? [];
    if (filter === "ai_candidate") return isAiCandidate(item);
    if (filter === "size_risk") return isSizeRisk(item, suggestions);
    if (filter === "missing_own_price") return isMissingOwnPrice(item, suggestions);
    if (filter === "missing_competitor_price") return isMissingCompetitorPrice(item);
    if (filter === "low_ocr_confidence") return isLowOcrConfidence(item);
    if (filter === "low_link_confidence") return isLowLinkConfidence(item);
    return item.status === "unmatched";
  });
}

function sortItemsForReview(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>) {
  return [...items].sort((left, right) => getReviewPriority(left, suggestionsByItemId.get(left.id) ?? []) - getReviewPriority(right, suggestionsByItemId.get(right.id) ?? []) || new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}

function getReviewPriority(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) {
  if ((item.status === "needs_review" || item.status === "recognized") && !hasCandidateFromSuggestions(item, suggestions)) return 0;
  if ((item.status === "needs_review" || item.status === "recognized") && isSizeRisk(item, suggestions)) return 1;
  if (isAiCandidate(item)) return 2;
  if (item.status === "needs_review") return 3;
  if (item.status === "recognized") return 4;
  if (isMissingOwnPrice(item, suggestions)) return 5;
  if (isLowOcrConfidence(item)) return 6;
  if (item.status === "rejected") return 7;
  if (item.status === "matched") return 8;
  if (item.status === "confirmed") return 9;
  if (item.status === "unmatched") return 10;
  return 11;
}

function countItemsWithoutCandidates(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>) { return items.filter((item) => !hasCandidate(item, suggestionsByItemId)).length; }
function hasCandidate(item: ReviewItem, suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>) { return hasCandidateFromSuggestions(item, suggestionsByItemId.get(item.id) ?? []); }
function hasCandidateFromSuggestions(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) { return Boolean(getActiveMatch(item.matches)) || suggestions.length > 0; }

function countQueueStats(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>): QueueStats {
  const stats: QueueStats = { aiCandidate: 0, sizeRisk: 0, missingOwnPrice: 0, missingCompetitorPrice: 0, lowOcrConfidence: 0, lowLinkConfidence: 0, unmatched: 0 };
  for (const item of items) {
    const suggestions = suggestionsByItemId.get(item.id) ?? [];
    if (isAiCandidate(item)) stats.aiCandidate += 1;
    if (isSizeRisk(item, suggestions)) stats.sizeRisk += 1;
    if (isMissingOwnPrice(item, suggestions)) stats.missingOwnPrice += 1;
    if (isMissingCompetitorPrice(item)) stats.missingCompetitorPrice += 1;
    if (isLowOcrConfidence(item)) stats.lowOcrConfidence += 1;
    if (isLowLinkConfidence(item)) stats.lowLinkConfidence += 1;
    if (item.status === "unmatched") stats.unmatched += 1;
  }
  return stats;
}

function getReviewBadges(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]): ReviewBadge[] {
  const badges: ReviewBadge[] = [];
  if (!hasText(item.size_text)) badges.push({ label: "Нет размера OCR", tone: "warning" });
  if (hasSizeCandidate(item, suggestions)) badges.push({ label: "Размерный кандидат", tone: "info" });
  if (isSizeRisk(item, suggestions)) badges.push({ label: "Риск размера", tone: "danger" });
  if (isAiCandidate(item)) badges.push({ label: "AI candidate", tone: "info" });
  if (isMissingOwnPrice(item, suggestions)) badges.push({ label: "Нет нашей цены", tone: "warning" });
  if (isMissingCompetitorPrice(item)) badges.push({ label: "Нет цены конкурента", tone: "warning" });
  if (!hasCandidateFromSuggestions(item, suggestions)) badges.push({ label: "Нет кандидата", tone: "danger" });
  if (isLowOcrConfidence(item)) badges.push({ label: "Низкая уверенность OCR", tone: "warning" });
  if (isLowLinkConfidence(item)) badges.push({ label: "Низкая связь ценника", tone: "warning" });
  if (item.status === "unmatched") badges.push({ label: "Explicit unmatched", tone: "neutral" });
  return badges;
}

function isAiCandidate(item: ReviewItem) { return getActiveMatch(item.matches)?.decision === "ai_review"; }
function isSizeRisk(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) { return !hasText(item.size_text) && hasSizeCandidate(item, suggestions); }
function isMissingOwnPrice(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) { const product = getActiveMatch(item.matches)?.catalog_products ?? suggestions[0]?.product ?? null; return Boolean(product) && product?.own_price_minor === null; }
function isMissingCompetitorPrice(item: ReviewItem) { return item.price_minor === null; }
function isLowOcrConfidence(item: ReviewItem) { return Number.isFinite(item.confidence) && item.confidence < LOW_OCR_CONFIDENCE; }
function isLowLinkConfidence(item: ReviewItem) { return item.link_confidence !== null && Number.isFinite(item.link_confidence) && item.link_confidence < LOW_LINK_CONFIDENCE; }
function hasSizeCandidate(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) { return [getActiveMatch(item.matches)?.catalog_products, ...suggestions.map((suggestion) => suggestion.product)].some((product) => hasText(product?.size_text ?? null)); }
function hasText(value: string | null) { return Boolean(value?.trim()); }

function getReviewHref(sessionId: string, filters: { department: ReviewDepartmentFilter; candidates: ReviewCandidateFilter; status: ReviewStatusFilter; queue: ReviewQueueFilter }) {
  const params = new URLSearchParams();
  if (filters.department !== "all") params.set("department", filters.department);
  if (filters.candidates !== "all") params.set("candidates", filters.candidates);
  if (filters.status !== "todo") params.set("status", filters.status);
  if (filters.queue !== "all") params.set("queue", filters.queue);
  const query = params.toString();
  return `/app/monitoring/${sessionId}/review${query ? `?${query}` : ""}`;
}

function getDepartmentLabel(value: string | null) { if (value === "products") return "Продукты"; if (value === "chemistry") return "Химия"; return "Без отдела"; }
function getStatusLabel(status: string) { if (status === "recognized") return "Распознано"; if (status === "needs_review") return "На проверке"; if (status === "matched") return "Сопоставлено"; if (status === "confirmed") return "OCR подтверждён"; if (status === "unmatched") return "Нет в ассортименте"; if (status === "rejected") return "Ошибка OCR"; return status; }
function getActiveMatch(matches: ReviewMatch[] | null) { return matches?.find((match) => match.is_active) ?? null; }
function formatPrice(priceMinor: number | null, currency: string | null) { return priceMinor === null ? "—" : `${(priceMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`; }
function formatConfidence(value: number | null) { return value === null || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`; }
function getStorageFilename(storagePath: string) { const segments = storagePath.split("/").filter(Boolean); return segments.at(-1) ?? ""; }

const countPillStyle = { border: "1px solid #d1d5db", borderRadius: 999, padding: "0.25rem 0.5rem" } as const;
function pillStyle(active: boolean) { return { ...countPillStyle, color: "inherit", fontWeight: active ? 700 : 400, textDecoration: "none" } as const; }
function badgeStyle(tone: BadgeTone) { const palette: Record<BadgeTone, string> = { neutral: "#f3f4f6", info: "#eff6ff", warning: "#fffbeb", danger: "#fef2f2" }; return { background: palette[tone], border: "1px solid #d1d5db", borderRadius: 999, fontSize: 13, padding: "0.2rem 0.5rem" } as const; }
function noticeStyle(tone: "info" | "warning") { return { ...badgeStyle(tone), borderRadius: 8, margin: 0, padding: "0.45rem 0.6rem" } as const; }
