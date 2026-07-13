import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import {
  getCatalogMatchCandidates,
  type CatalogMatchCandidate,
  type CatalogMatchProduct,
} from "../../../../../server/catalog-matching";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import { updateCatalogMatchDecision } from "../match-actions";
import { RecognizedItemReviewControls } from "../recognized-item-review-controls";

type DepartmentFilter = "all" | "products" | "chemistry" | "none";
type TaskFilter = "todo" | "without_candidate" | "size_risk" | "missing_own_price" | "ready" | "all";
type BadgeTone = "neutral" | "info" | "warning" | "danger";

type ReviewPageProps = {
  params: Promise<{ sessionId: string }>;
  searchParams?: Promise<{
    department?: string;
    task?: string;
  }>;
};

type ReviewMatch = {
  id: string;
  score: number;
  decision: string;
  is_active: boolean;
  catalog_products: {
    external_sku: string | null;
    name: string;
    brand: string | null;
    size_text: string | null;
    own_price_minor: number | null;
    currency: string | null;
  } | null;
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
  evidence: Array<{ storage_path: string }> | null;
  matches: ReviewMatch[] | null;
};

type EvidencePreview = { cropUrl: string | null; sourceUrl: string | null };

type SessionRow = {
  id: string;
  status: string;
  stores: { name: string; address: string | null } | null;
};

type ReviewCatalogProduct = CatalogMatchProduct & {
  external_sku: string | null;
  own_price_minor: number | null;
  currency: string | null;
};

type ReviewCatalogSuggestion = Omit<CatalogMatchCandidate, "product"> & {
  product: ReviewCatalogProduct;
};

type ReviewBadge = { label: string; tone: BadgeTone };

const LOW_OCR_CONFIDENCE = 0.75;

const departmentFilters: Array<{ key: DepartmentFilter; label: string }> = [
  { key: "all", label: "Все отделы" },
  { key: "products", label: "Продукты" },
  { key: "chemistry", label: "Химия" },
  { key: "none", label: "Без отдела" },
];

const taskFilters: Array<{ key: TaskFilter; label: string }> = [
  { key: "todo", label: "К проверке" },
  { key: "without_candidate", label: "Без кандидата" },
  { key: "size_risk", label: "Риск размера" },
  { key: "missing_own_price", label: "Нет нашей цены" },
  { key: "ready", label: "Готовые" },
  { key: "all", label: "Все" },
];

export default async function RecognizedItemsReviewPage({ params, searchParams }: ReviewPageProps) {
  const { sessionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const departmentFilter = parseDepartmentFilter(resolvedSearchParams.department);
  const taskFilter = parseTaskFilter(resolvedSearchParams.task);
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/app/monitoring/${encodeURIComponent(sessionId)}/review`);
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return <PageError message={error instanceof Error ? error.message : "Не удалось проверить доступ."} />;
  }

  if (membershipResult.status !== "ok") {
    return <PageError message="Нет доступа к компании." />;
  }

  if (!["admin", "manager", "reviewer"].includes(membershipResult.membership.role)) {
    return <PageError message="Нет прав на проверку." />;
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, stores(name, address)")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<SessionRow | null>();

  if (sessionError) {
    return <PageError message={`Не удалось загрузить сессию: ${sessionError.message}`} />;
  }

  if (!session) {
    return <PageError message="Сессия не найдена." />;
  }

  let itemsQuery = supabase
    .from("recognized_items")
    .select(
      "id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, confidence, link_confidence, price_tag_text, product_visible_text, review_reason, position_hint, department, status, created_at, monitoring_photos(storage_path), evidence(storage_path), matches(id, score, decision, is_active, catalog_products(external_sku, name, brand, size_text, own_price_minor, currency))",
    )
    .eq("company_id", companyId)
    .eq("session_id", sessionId);

  if (departmentFilter === "none") {
    itemsQuery = itemsQuery.is("department", null);
  } else if (departmentFilter !== "all") {
    itemsQuery = itemsQuery.eq("department", departmentFilter);
  }

  const { data: items, error: itemsError } = await itemsQuery.order("created_at", { ascending: false }).returns<ReviewItem[]>();

  if (itemsError) {
    return <PageError message={`Не удалось загрузить товары: ${itemsError.message}`} />;
  }

  const { data: catalogProducts, error: catalogProductsError } = await supabase
    .from("catalog_products")
    .select("id, external_sku, name, brand, size_text, own_price_minor, currency, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(5000)
    .returns<ReviewCatalogProduct[]>();

  const allItems = items ?? [];
  const evidencePreviews = await buildEvidencePreviews(supabase, allItems);
  const suggestionsByItemId = buildSuggestionsByItemId(allItems, catalogProducts ?? []);
  const visibleItems = sortItemsForReview(
    allItems.filter((item) => filterItemByTask(item, suggestionsByItemId.get(item.id) ?? [], taskFilter)),
  );
  const counters = buildTaskCounters(allItems, suggestionsByItemId);

  return (
    <main className="page">
      <header className="grid">
        <p className="eyebrow">
          <Link href={`/app/monitoring/${sessionId}`}>Сессия</Link> / Проверка товаров
        </p>
        <div className="hero">
          <div>
            <h1>Проверка товаров</h1>
            <p className="lead">
              {session.stores?.name ?? "Магазин"} · {session.stores?.address ?? "адрес не указан"}. Проверьте спорные строки и выгрузите Excel.
            </p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            <Link className="btn btn-secondary" href={`/app/monitoring/${sessionId}/export.xlsx`}>
              Выгрузить Excel
            </Link>
            <Link className="btn btn-secondary" href={`/app/monitoring/${sessionId}/export.json`}>
              Выгрузить JSON
            </Link>
          </div>
        </div>
      </header>

      <section className="card soft grid">
        <div>
          <strong>Что проверять первым</strong>
          <p style={{ color: "#4b5563", margin: "0.35rem 0 0" }}>
            Сначала строки без кандидата, затем риск размера и товары без нашей цены. Технические OCR-поля спрятаны в “Подробнее”.
          </p>
          {catalogProductsError ? (
            <p style={{ color: "#b45309", margin: "0.5rem 0 0" }}>
              Подсказки каталога недоступны: {catalogProductsError.message}
            </p>
          ) : null}
        </div>
        <div className="stats">
          <Counter label="К проверке" value={counters.todo} tone="badge-warn" />
          <Counter label="Без кандидата" value={counters.withoutCandidate} tone="badge-warn" />
          <Counter label="Риск размера" value={counters.sizeRisk} tone="badge-warn" />
          <Counter label="Готово" value={counters.ready} tone="badge-ok" />
        </div>
      </section>

      <section className="card grid">
        <div>
          <h2 style={{ margin: 0 }}>Фильтры</h2>
          <p style={{ color: "#4b5563", marginBottom: 0 }}>Оставлены только рабочие фильтры. Остальное убрано из основного интерфейса.</p>
        </div>
        <div className="pill-row">
          {taskFilters.map((filter) => (
            <Link
              key={filter.key}
              href={getReviewHref(sessionId, { department: departmentFilter, task: filter.key })}
              style={pillStyle(filter.key === taskFilter)}
            >
              {filter.label}
            </Link>
          ))}
        </div>
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Отдел</summary>
          <div className="pill-row" style={{ marginTop: "0.75rem" }}>
            {departmentFilters.map((filter) => (
              <Link
                key={filter.key}
                href={getReviewHref(sessionId, { department: filter.key, task: taskFilter })}
                style={pillStyle(filter.key === departmentFilter)}
              >
                {filter.label}
              </Link>
            ))}
          </div>
        </details>
      </section>

      {visibleItems.length > 0 ? (
        <div className="grid">
          {visibleItems.map((item) => {
            const activeMatch = getActiveMatch(item.matches);
            const suggestions = suggestionsByItemId.get(item.id) ?? [];
            const bestSuggestion = suggestions[0];
            const badges = getReviewBadges(item, suggestions);

            return (
              <article key={item.id} className="card review-card">
                <div style={{ display: "grid", gap: "0.75rem" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "space-between" }}>
                    <div>
                      <h2 style={{ margin: 0 }}>{item.raw_name}</h2>
                      <p style={{ color: "#4b5563", margin: "0.35rem 0 0" }}>
                        Цена: {formatPrice(item.price_minor, item.currency)} · {getDepartmentLabel(item.department)} · {getStatusLabel(item.status)}
                      </p>
                    </div>
                    <BadgeList badges={badges} />
                  </div>

                  <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                    <RecognizedBlock item={item} />
                    <EvidenceBlock preview={evidencePreviews.get(item.id)} />
                    <CatalogBlock
                      activeMatch={activeMatch}
                      bestSuggestion={bestSuggestion}
                      item={item}
                      sessionId={sessionId}
                      suggestions={suggestions}
                    />
                  </div>

                  <RecognizedItemReviewControls sessionId={sessionId} item={item} suggestions={suggestions} />

                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 700 }}>Подробнее</summary>
                    <dl style={{ display: "grid", gap: "0.35rem", margin: "0.75rem 0 0" }}>
                      <Info label="Уверенность OCR" value={formatConfidence(item.confidence)} />
                      <Info label="Связь ценника" value={formatConfidence(item.link_confidence)} />
                      <Info label="Старая цена" value={formatPrice(item.old_price_minor, item.currency)} />
                      <Info label="Акция" value={formatPrice(item.promo_price_minor, item.currency)} />
                      <Info label="Текст ценника" value={item.price_tag_text} />
                      <Info label="Текст товара" value={item.product_visible_text} />
                      <Info label="Причина проверки" value={item.review_reason} />
                      <Info label="Место" value={item.position_hint} />
                      <Info label="Фото" value={getStorageFilename(item.monitoring_photos?.storage_path ?? "") || "—"} />
                    </dl>
                  </details>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="empty">
          <h2>По выбранному фильтру товаров нет</h2>
          <p className="muted">Смените фильтр или вернитесь в сессию и проверьте статус распознавания фото.</p>
        </section>
      )}
    </main>
  );
}

function EvidenceBlock({ preview }: { preview?: EvidencePreview }) {
  if (!preview?.cropUrl) {
    return (
      <section style={panelStyle}>
        <strong>Фото-доказательство</strong>
        <p style={{ color: "#6b7280", margin: 0 }}>Crop недоступен. Строка требует ручной проверки.</p>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <strong>Ценник</strong>
      {/* Signed storage URL is dynamic, so a native image is appropriate here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt="Crop ценника"
        src={preview.cropUrl}
        style={{ borderRadius: 8, maxHeight: 180, objectFit: "contain", width: "100%" }}
      />
      {preview.sourceUrl ? <a href={preview.sourceUrl} rel="noreferrer" target="_blank">Открыть исходное фото</a> : null}
    </section>
  );
}

async function buildEvidencePreviews(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  items: ReviewItem[],
) {
  const paths = Array.from(new Set(items.flatMap((item) => [
    item.monitoring_photos?.storage_path,
    item.evidence?.[0]?.storage_path,
  ]).filter((path): path is string => Boolean(path))));

  const urlsByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from("monitoring-photos").createSignedUrls(paths, 60 * 60);
    for (const [index, signed] of (data ?? []).entries()) {
      if (signed.signedUrl) urlsByPath.set(paths[index], signed.signedUrl);
    }
  }

  return new Map(items.map((item) => {
    const sourcePath = item.monitoring_photos?.storage_path ?? null;
    const cropPath = item.evidence?.[0]?.storage_path ?? null;
    return [item.id, {
      cropUrl: cropPath ? urlsByPath.get(cropPath) ?? null : null,
      sourceUrl: sourcePath ? urlsByPath.get(sourcePath) ?? null : null,
    } satisfies EvidencePreview];
  }));
}

function RecognizedBlock({ item }: { item: ReviewItem }) {
  return (
    <section style={panelStyle}>
      <strong>Распознано на фото</strong>
      <dl style={{ display: "grid", gap: "0.35rem", margin: 0 }}>
        <Info label="Название" value={item.raw_name} />
        <Info label="Бренд" value={item.brand} />
        <Info label="Размер" value={item.size_text} />
        <Info label="Цена" value={formatPrice(item.price_minor, item.currency)} />
      </dl>
    </section>
  );
}

function CatalogBlock({
  activeMatch,
  bestSuggestion,
  item,
  sessionId,
  suggestions,
}: {
  activeMatch: ReviewMatch | null;
  bestSuggestion?: ReviewCatalogSuggestion;
  item: ReviewItem;
  sessionId: string;
  suggestions: ReviewCatalogSuggestion[];
}) {
  if (activeMatch) {
    return <ActiveMatchBlock item={item} match={activeMatch} sessionId={sessionId} suggestions={suggestions} />;
  }

  if (!bestSuggestion) {
    return (
      <section style={panelStyle}>
        <strong>Кандидат из каталога</strong>
        <p style={{ color: "#6b7280", margin: 0 }}>Кандидат не найден. Используйте “Связать с каталогом” или отметьте “Нет в ассортименте”.</p>
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <strong>Лучший кандидат</strong>
      <p style={{ margin: 0 }}>{bestSuggestion.product.name}</p>
      <p style={{ color: "#4b5563", margin: 0 }}>
        Бренд: {bestSuggestion.product.brand ?? "—"} · размер: {bestSuggestion.product.size_text ?? "—"} · наша цена: {formatPrice(bestSuggestion.product.own_price_minor, bestSuggestion.product.currency)}
      </p>
      <p style={{ color: "#4b5563", margin: 0 }}>Совпадение: {formatConfidence(bestSuggestion.score)}</p>
    </section>
  );
}

function ActiveMatchBlock({
  item,
  match,
  sessionId,
  suggestions,
}: {
  item: ReviewItem;
  match: ReviewMatch;
  sessionId: string;
  suggestions: ReviewCatalogSuggestion[];
}) {
  const product = match.catalog_products;
  const sizeRisk = isSizeRisk(item, suggestions);
  const missingOwnPrice = product?.own_price_minor === null;

  return (
    <section style={panelStyle}>
      <strong>Кандидат из каталога</strong>
      <p style={{ margin: 0 }}>{product?.name ?? "Товар не найден"}</p>
      <p style={{ color: "#4b5563", margin: 0 }}>
        SKU: {product?.external_sku ?? "—"} · бренд: {product?.brand ?? "—"} · размер: {product?.size_text ?? "—"} · наша цена: {formatPrice(product?.own_price_minor ?? null, product?.currency ?? "RUB")}
      </p>
      {match.decision === "ai_review" ? <p style={noticeStyle("info")}>Это подсказка. Проверьте вручную перед принятием.</p> : null}
      {sizeRisk ? <p style={noticeStyle("warning")}>OCR не распознал размер. Проверьте граммовку.</p> : null}
      {missingOwnPrice ? <p style={noticeStyle("warning")}>У кандидата нет нашей цены.</p> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <form action={updateCatalogMatchDecision}>
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="match_id" value={match.id} />
          <input type="hidden" name="decision" value="accepted" />
          <button type="submit">Принять совпадение</button>
        </form>
        <form action={updateCatalogMatchDecision}>
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="match_id" value={match.id} />
          <input type="hidden" name="decision" value="rejected" />
          <button type="submit">Отклонить</button>
        </form>
      </div>
    </section>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="stat">
      <span className={`badge ${tone}`}>{label}</span>
      <p><b>{value}</b></p>
    </div>
  );
}

function BadgeList({ badges }: { badges: ReviewBadge[] }) {
  if (!badges.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
      {badges.map((badge) => <span key={badge.label} style={badgeStyle(badge.tone)}>{badge.label}</span>)}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: "grid", gap: "0.25rem", gridTemplateColumns: "130px 1fr" }}>
      <dt style={{ color: "#4b5563" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value || "—"}</dd>
    </div>
  );
}

function PageError({ message }: { message: string }) {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app/monitoring">← Мониторинг</Link>
      <h1>Проверка недоступна</h1>
      <p>{message}</p>
    </main>
  );
}

function buildSuggestionsByItemId(items: ReviewItem[], products: ReviewCatalogProduct[]) {
  const suggestions = new Map<string, ReviewCatalogSuggestion[]>();
  if (products.length === 0) return suggestions;

  for (const item of items) {
    suggestions.set(
      item.id,
      getCatalogMatchCandidates(
        {
          rawName: item.raw_name,
          brand: item.brand,
          sizeText: item.size_text,
          priceTagText: item.price_tag_text,
          productVisibleText: item.product_visible_text,
        },
        products,
        { limit: 5 },
      ) as ReviewCatalogSuggestion[],
    );
  }

  return suggestions;
}

function buildTaskCounters(items: ReviewItem[], suggestionsByItemId: Map<string, ReviewCatalogSuggestion[]>) {
  return {
    all: items.length,
    missingOwnPrice: items.filter((item) => isMissingOwnPrice(item, suggestionsByItemId.get(item.id) ?? [])).length,
    ready: items.filter(isReadyItem).length,
    sizeRisk: items.filter((item) => isSizeRisk(item, suggestionsByItemId.get(item.id) ?? [])).length,
    todo: items.filter(isTodoItem).length,
    withoutCandidate: items.filter((item) => isWithoutCandidate(item, suggestionsByItemId.get(item.id) ?? [])).length,
  };
}

function filterItemByTask(item: ReviewItem, suggestions: ReviewCatalogSuggestion[], filter: TaskFilter) {
  if (filter === "all") return true;
  if (filter === "todo") return isTodoItem(item);
  if (filter === "without_candidate") return isWithoutCandidate(item, suggestions);
  if (filter === "size_risk") return isSizeRisk(item, suggestions);
  if (filter === "missing_own_price") return isMissingOwnPrice(item, suggestions);
  return isReadyItem(item);
}

function sortItemsForReview(items: ReviewItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();
    return rightTime - leftTime;
  });
}

function isTodoItem(item: ReviewItem) {
  return item.status === "recognized" || item.status === "needs_review";
}

function isReadyItem(item: ReviewItem) {
  return item.status === "matched" || item.status === "confirmed" || item.status === "unmatched";
}

function isWithoutCandidate(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) {
  return isTodoItem(item) && !getActiveMatch(item.matches) && suggestions.length === 0;
}

function isSizeRisk(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) {
  return !hasText(item.size_text) && suggestions.some((suggestion) => hasText(suggestion.product.size_text));
}

function isMissingOwnPrice(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]) {
  const activeProduct = getActiveMatch(item.matches)?.catalog_products;
  if (activeProduct) return activeProduct.own_price_minor === null;
  return suggestions.some((suggestion) => suggestion.product.own_price_minor === null);
}

function getReviewBadges(item: ReviewItem, suggestions: ReviewCatalogSuggestion[]): ReviewBadge[] {
  const badges: ReviewBadge[] = [];
  if (isWithoutCandidate(item, suggestions)) badges.push({ label: "Без кандидата", tone: "danger" });
  if (isSizeRisk(item, suggestions)) badges.push({ label: "Риск размера", tone: "danger" });
  if (isMissingOwnPrice(item, suggestions)) badges.push({ label: "Нет нашей цены", tone: "warning" });
  if (!hasText(item.size_text)) badges.push({ label: "Нет размера OCR", tone: "warning" });
  if (item.confidence < LOW_OCR_CONFIDENCE) badges.push({ label: "Проверь OCR", tone: "warning" });
  if (getActiveMatch(item.matches)?.decision === "ai_review") badges.push({ label: "Кандидат требует проверки", tone: "info" });
  if (item.status === "unmatched") badges.push({ label: "Нет в ассортименте", tone: "neutral" });
  return badges;
}

function getActiveMatch(matches: ReviewMatch[] | null) {
  return matches?.find((match) => match.is_active) ?? null;
}

function parseDepartmentFilter(value: string | undefined): DepartmentFilter {
  return value === "products" || value === "chemistry" || value === "none" ? value : "all";
}

function parseTaskFilter(value: string | undefined): TaskFilter {
  return value === "all" || value === "without_candidate" || value === "size_risk" || value === "missing_own_price" || value === "ready" ? value : "todo";
}

function getReviewHref(sessionId: string, params: { department: DepartmentFilter; task: TaskFilter }) {
  const searchParams = new URLSearchParams();
  if (params.department !== "all") searchParams.set("department", params.department);
  if (params.task !== "todo") searchParams.set("task", params.task);
  const query = searchParams.toString();
  return `/app/monitoring/${sessionId}/review${query ? `?${query}` : ""}`;
}

function getDepartmentLabel(department: string | null) {
  if (department === "products") return "Продукты";
  if (department === "chemistry") return "Химия";
  return "Без отдела";
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    confirmed: "OCR подтверждён",
    matched: "Сопоставлено",
    needs_review: "На проверке",
    recognized: "На проверке",
    rejected: "Ошибка OCR",
    unmatched: "Нет в ассортименте",
  };
  return labels[status] ?? status;
}

function formatPrice(priceMinor: number | null, currency: string | null) {
  if (priceMinor === null) return "—";
  return `${(priceMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`;
}

function formatConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function hasText(value: string | null) {
  return Boolean(value?.trim());
}

function getStorageFilename(storagePath: string) {
  const segments = storagePath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}

function badgeStyle(tone: BadgeTone) {
  const colors: Record<BadgeTone, { background: string; border: string; color: string }> = {
    danger: { background: "#fef2f2", border: "#fecaca", color: "#991b1b" },
    info: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
    neutral: { background: "#f9fafb", border: "#e5e7eb", color: "#374151" },
    warning: { background: "#fffbeb", border: "#fde68a", color: "#92400e" },
  };
  return {
    background: colors[tone].background,
    border: `1px solid ${colors[tone].border}`,
    borderRadius: 999,
    color: colors[tone].color,
    padding: "0.25rem 0.5rem",
  };
}

function noticeStyle(tone: "info" | "warning") {
  return {
    background: tone === "info" ? "#eff6ff" : "#fffbeb",
    border: `1px solid ${tone === "info" ? "#bfdbfe" : "#fbbf24"}`,
    borderRadius: 8,
    color: tone === "info" ? "#1d4ed8" : "#92400e",
    margin: 0,
    padding: "0.4rem 0.5rem",
  };
}

function pillStyle(active: boolean) {
  return {
    background: active ? "#dbeafe" : "#fff",
    border: `1px solid ${active ? "#93c5fd" : "#d1d5db"}`,
    borderRadius: 999,
    color: active ? "#1d4ed8" : "#111827",
    fontWeight: active ? 700 : 600,
    padding: "0.45rem 0.75rem",
    textDecoration: "none",
  };
}

const panelStyle = {
  background: "#f9fafb",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  display: "grid",
  gap: "0.5rem",
  padding: "0.75rem",
} as const;
