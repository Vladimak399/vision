import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";
import { MatchControls } from "../match-controls";
import { updateCatalogMatchDecision } from "../match-actions";
import { RecognizedItemReviewControls } from "../recognized-item-review-controls";

type ReviewDepartmentFilter = "all" | "products" | "chemistry" | "none";

type ReviewPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
  searchParams?: Promise<{
    department?: string;
  }>;
};

type ReviewMatch = {
  id: string;
  score: number;
  decision: string;
  is_active: boolean;
  catalog_products: {
    external_sku: string;
    name: string;
    brand: string | null;
    size_text: string | null;
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
  monitoring_photos: {
    storage_path: string;
  } | null;
  matches: ReviewMatch[] | null;
};

type SessionRow = {
  id: string;
  status: string;
  stores: {
    name: string;
    address: string | null;
  } | null;
};

const departmentFilters: Array<{ key: ReviewDepartmentFilter; label: string }> = [
  { key: "all", label: "Все" },
  { key: "products", label: "Продукты" },
  { key: "chemistry", label: "Химия" },
  { key: "none", label: "Без отдела" },
];

export default async function RecognizedItemsReviewPage({ params, searchParams }: ReviewPageProps) {
  const { sessionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const departmentFilter = parseDepartmentFilter(resolvedSearchParams.department);
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
      "id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, confidence, link_confidence, price_tag_text, product_visible_text, review_reason, position_hint, department, status, created_at, monitoring_photos(storage_path), matches(id, score, decision, is_active, catalog_products(external_sku, name, brand, size_text))",
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

  const counts = getStatusCounts(items ?? []);

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href={`/app/monitoring/${sessionId}`}>← Сессия</Link>
        <h1 style={{ margin: 0 }}>Проверка распознанных товаров</h1>
        <p style={{ margin: 0, color: "#4b5563" }}>
          {session.stores?.name ?? "Магазин"} · {session.stores?.address ?? "адрес не указан"} · статус сессии: {session.status}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {departmentFilters.map((filter) => (
            <Link
              key={filter.key}
              href={getDepartmentHref(sessionId, filter.key)}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 999,
                padding: "0.25rem 0.5rem",
                fontWeight: filter.key === departmentFilter ? 700 : 400,
              }}
            >
              {filter.label}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
          {Object.entries(counts).map(([status, count]) => (
            <span key={status} style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "0.25rem 0.5rem" }}>
              {status}: {count}
            </span>
          ))}
        </div>
      </header>

      <MatchControls sessionId={sessionId} department={departmentFilter} />

      {items && items.length > 0 ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {items.map((item) => {
            const activeMatch = getActiveMatch(item.matches);

            return (
              <article key={item.id} style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", display: "grid", gap: "0.75rem" }}>
                <div style={{ display: "grid", gap: "0.25rem" }}>
                  <h2 style={{ margin: 0 }}>{item.raw_name}</h2>
                  <p style={{ margin: 0, color: "#4b5563" }}>
                    Цена: {formatPrice(item.price_minor, item.currency)} · статус: {item.status} · отдел: {getDepartmentLabel(item.department)} · уверенность: {formatConfidence(item.confidence)} · связь: {formatConfidence(item.link_confidence)}
                  </p>
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

                {activeMatch ? <ActiveMatchBlock sessionId={sessionId} match={activeMatch} /> : <p style={{ color: "#6b7280", margin: 0 }}>Совпадение с каталогом пока не подобрано.</p>}

                <RecognizedItemReviewControls sessionId={sessionId} item={item} />
              </article>
            );
          })}
        </div>
      ) : (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
          <p style={{ margin: 0 }}>По выбранному фильтру товаров пока нет.</p>
        </section>
      )}
    </main>
  );
}

function ActiveMatchBlock({ match, sessionId }: { match: ReviewMatch; sessionId: string }) {
  const product = match.catalog_products;

  return (
    <section style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, display: "grid", gap: "0.5rem", padding: "0.75rem" }}>
      <strong>Кандидат из каталога</strong>
      <p style={{ margin: 0 }}>{product?.name ?? "Товар не найден"}</p>
      <p style={{ color: "#4b5563", margin: 0 }}>
        Артикул: {product?.external_sku ?? "—"} · бренд: {product?.brand ?? "—"} · размер: {product?.size_text ?? "—"} · score: {formatConfidence(match.score)} · decision: {match.decision}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
        <form action={updateCatalogMatchDecision}>
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="match_id" value={match.id} />
          <input type="hidden" name="decision" value="accepted" />
          <button type="submit">Принять</button>
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

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div style={{ display: "grid", gap: "0.25rem", gridTemplateColumns: "160px 1fr" }}>
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

function getStatusCounts(items: ReviewItem[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

function parseDepartmentFilter(value: string | undefined): ReviewDepartmentFilter {
  return value === "products" || value === "chemistry" || value === "none" ? value : "all";
}

function getDepartmentHref(sessionId: string, department: ReviewDepartmentFilter) {
  const baseHref = `/app/monitoring/${sessionId}/review`;
  return department === "all" ? baseHref : `${baseHref}?department=${department}`;
}

function getDepartmentLabel(value: string | null) {
  if (value === "products") {
    return "Продукты";
  }

  if (value === "chemistry") {
    return "Химия";
  }

  return "Без отдела";
}

function getActiveMatch(matches: ReviewMatch[] | null) {
  return matches?.find((match) => match.is_active) ?? null;
}

function formatPrice(priceMinor: number | null, currency: string | null) {
  if (priceMinor === null) {
    return "—";
  }

  return `${(priceMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`;
}

function formatConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `${Math.round(value * 100)}%`;
}

function getStorageFilename(storagePath: string) {
  const segments = storagePath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
