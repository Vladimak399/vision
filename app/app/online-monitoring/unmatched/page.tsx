import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, X, Package, Search } from "lucide-react";

import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCatalogMatchCandidates, type CatalogMatchProduct } from "../../../../server/catalog-matching";
import { confirmMatchAction, rejectMatchAction } from "../actions";

export const dynamic = "force-dynamic";

// ── Типы ────────────────────────────────────────────────────────────────

type UnmatchedMatchRaw = {
  id: string;
  source_product_id: string;
  catalog_product_id: string | null;
  confidence: number | null;
  method: string | null;
  status: string;
  reason: string | null;
  source_product: Array<{
    id: string;
    raw_name: string | null;
    brand: string | null;
    size_text: string | null;
    barcode: string | null;
    image_url: string | null;
  }> | null;
};

type UnmatchedMatch = {
  id: string;
  source_product_id: string;
  catalog_product_id: string | null;
  confidence: number | null;
  method: string | null;
  status: string;
  reason: string | null;
  source_product: {
    id: string;
    raw_name: string | null;
    brand: string | null;
    size_text: string | null;
    barcode: string | null;
    image_url: string | null;
  } | null;
};

type UnmatchedWithCandidates = {
  match: UnmatchedMatch;
  productName: string;
  brand: string;
  sizeText: string;
  barcode: string;
  candidates: Array<{ id: string; name: string; brand: string | null; size_text: string | null; score: number; reasons: string[] }>;
};

// ── Вспомогательные функции ─────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 3) / 2);
  return text.slice(0, half) + "..." + text.slice(-half);
}

function formatScore(score: number): string {
  return (score * 100).toFixed(0) + "%";
}

// ── Основная страница ───────────────────────────────────────────────────

export default async function OnlineMonitoringUnmatchedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/online-monitoring/unmatched");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 820, padding: "0 1rem" }}>
        <h1>Ошибка доступа</h1>
        <p>Нет доступа к компании.</p>
        <Link href="/app">← Вернуться в рабочую область</Link>
      </main>
    );
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  // 1. Загружаем несопоставленные товары с JOIN на online_source_products
  const { data: unmatchedRows } = await supabase
    .from("online_product_matches")
    .select(`
      id,
      source_product_id,
      catalog_product_id,
      confidence,
      method,
      status,
      reason,
      source_product:source_product_id (
        id,
        raw_name,
        brand,
        size_text,
        barcode,
        image_url
      )
    `)
    .eq("company_id", companyId)
    .eq("status", "needs_review")
    .order("created_at", { ascending: false });

  const unmatched = ((unmatchedRows ?? []) as UnmatchedMatchRaw[]).map((row) => ({
  ...row,
  source_product: row.source_product?.[0] ?? null,
}));

  // 2. Загружаем каталог для поиска кандидатов
  const { data: catalogProductsRaw } = await supabase
    .from("catalog_products")
    .select("id, name, brand, size_text")
    .eq("company_id", companyId)
    .eq("is_active", true);

  const catalogProducts: CatalogMatchProduct[] = (catalogProductsRaw ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    size_text: p.size_text,
  }));

  // 3. Для каждого несопоставленного товара находим кандидатов
  const itemsWithCandidates: UnmatchedWithCandidates[] = unmatched.map((match) => {
    const prod = match.source_product;
    const rawName = prod?.raw_name ?? "";
    const brand = prod?.brand ?? "";
    const sizeText = prod?.size_text ?? "";

    const candidates = getCatalogMatchCandidates(
      { rawName: rawName || null, brand: brand || null, sizeText: sizeText || null },
      catalogProducts,
      { limit: 5 }
    ).map((c) => ({
      id: c.product.id,
      name: c.product.name,
      brand: c.product.brand,
      size_text: c.product.size_text,
      score: c.score,
      reasons: c.reasons,
    }));

    return {
      match,
      productName: rawName,
      brand,
      sizeText,
      barcode: prod?.barcode ?? "",
      candidates,
    };
  });

  const totalCount = itemsWithCandidates.length;
  const withCandidatesCount = itemsWithCandidates.filter((i) => i.candidates.length > 0).length;

  // ── Баннеры уведомлений ──────────────────────────────────────────────
  const sp = await searchParams;
  const banner =
    sp.confirmed
      ? { type: "success", text: "Сопоставление подтверждено. Товар перемещён в список сопоставленных." }
      : sp.rejected
        ? { type: "info", text: "Сопоставление отклонено." }
        : sp.error === "confirmFailed"
          ? { type: "error", text: "Ошибка при подтверждении сопоставления. Попробуйте снова." }
          : sp.error === "rejectFailed"
            ? { type: "error", text: "Ошибка при отклонении сопоставления. Попробуйте снова." }
            : sp.error === "missingParams"
              ? { type: "error", text: "Отсутствуют параметры. Попробуйте снова." }
              : null;

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      {/* Баннер уведомления */}
      {banner && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: 8,
            fontSize: "0.875rem",
            fontWeight: 500,
            background: banner.type === "success" ? "#dcfce7" : banner.type === "info" ? "#f0f9ff" : "#fee2e2",
            color: banner.type === "success" ? "#166534" : banner.type === "info" ? "#0369a1" : "#991b1b",
            border: `1px solid ${banner.type === "success" ? "#bbf7d0" : banner.type === "info" ? "#bae6fd" : "#fecaca"}`,
          }}
        >
          {banner.text}
        </div>
      )}

      {/* Шапка */}
      <div>
        <Link href="/app" style={{ textDecoration: "none", color: "#0ea5e9" }}>
          ← Вернуться в рабочую область
        </Link>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Несопоставленные товары</h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>
          Товары из онлайн-мониторинга, которые не удалось автоматически сопоставить с каталогом.
          {totalCount > 0 && (
            <span> {withCandidatesCount} из {totalCount} имеют кандидатов.</span>
          )}
        </p>
      </div>

      {/* Навигация */}
      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/app/online-monitoring" style={{ color: "#64748b" }}>
          Источники
        </Link>
        <Link href="/app/online-monitoring/runs" style={{ color: "#64748b" }}>
          Запуски
        </Link>
        <Link href="/app/online-monitoring/unmatched" style={{ color: "#0ea5e9", fontWeight: 500 }}>
          Несопоставленные ({totalCount})
        </Link>
        <Link href="/app/online-monitoring/alerts" style={{ color: "#64748b" }}>
          Алерты
        </Link>
      </nav>

      {/* Список товаров */}
      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Товары для проверки</h2>

        {totalCount === 0 ? (
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            Все товары успешно сопоставлены или очередь пуста.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "1.5rem" }}>
            {itemsWithCandidates.map((item) => (
              <div
                key={item.match.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "1rem",
                  background: "#fafafa",
                }}
              >
                {/* Заголовок товара */}
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap", marginBottom: item.candidates.length > 0 ? "0.75rem" : 0 }}>
                  <Package size={20} style={{ color: "#64748b", marginTop: 4, flexShrink: 0 }} />

                  <div style={{ flexGrow: 1, minWidth: 280 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {item.productName || "—"}
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                      {item.brand && <span>Бренд: {item.brand}</span>}
                      {item.brand && item.sizeText && <span> • </span>}
                      {item.sizeText && <span>Размер: {item.sizeText}</span>}
                      {item.barcode && <span> • ШК: {item.barcode}</span>}
                    </div>
                    {item.match.reason && (
                      <div style={{ fontSize: "0.8125rem", color: "#94a3b8", marginTop: 4 }}>
                        Причина: {item.match.reason}
                      </div>
                    )}
                  </div>

                  {/* Кнопки действий (без кандидатов — только Reject) */}
                  {item.candidates.length === 0 && (
                    <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                      <form action={rejectMatchAction}>
                        <input type="hidden" name="matchId" value={item.match.id} />
                        <button
                          type="submit"
                          title="Отклонить"
                          style={{
                            padding: "0.375rem 0.75rem",
                            background: "#fee2e2",
                            color: "#991b1b",
                            border: "none",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: "0.8125rem",
                            display: "flex",
                            gap: "0.25rem",
                            alignItems: "center",
                          }}
                        >
                          <X size={14} /> Отклонить
                        </button>
                      </form>
                    </div>
                  )}
                </div>

                {/* Кандидаты из каталога */}
                {item.candidates.length > 0 && (
                  <>
                    <div
                      style={{
                        marginTop: "0.5rem",
                        padding: "0.5rem 0.75rem",
                        background: "#f0f9ff",
                        borderRadius: 6,
                        border: "1px solid #bae6fd",
                        display: "flex",
                        gap: "0.35rem",
                        alignItems: "center",
                        fontSize: "0.8125rem",
                        color: "#0369a1",
                      }}
                    >
                      <Search size={14} />
                      Найдено кандидатов: {item.candidates.length}
                    </div>

                    <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.75rem" }}>
                      {item.candidates.map((candidate) => (
                        <form
                          key={candidate.id}
                          action={confirmMatchAction}
                          style={{
                            display: "flex",
                            gap: "0.75rem",
                            alignItems: "center",
                            padding: "0.5rem 0.75rem",
                            background: "white",
                            borderRadius: 6,
                            border: "1px solid #e2e8f0",
                          }}
                        >
                          <input type="hidden" name="matchId" value={item.match.id} />
                          <input type="hidden" name="catalogProductId" value={candidate.id} />

                          <div style={{ flexGrow: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>
                              {truncate(candidate.name, 80)}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: 2 }}>
                              {candidate.brand && <span>{candidate.brand}</span>}
                              {candidate.brand && candidate.size_text && <span> • </span>}
                              {candidate.size_text && <span>{candidate.size_text}</span>}
                              <span style={{ marginLeft: "0.5rem", fontWeight: 500, color: candidate.score > 0.5 ? "#16a34a" : "#ca8a04" }}>
                                {formatScore(candidate.score)}
                              </span>
                            </div>
                            {candidate.reasons.length > 0 && (
                              <div style={{ fontSize: "0.6875rem", color: "#94a3b8", marginTop: 2 }}>
                                {candidate.reasons.join(", ")}
                              </div>
                            )}
                          </div>

                          <button
                            type="submit"
                            title="Выбрать этот товар"
                            style={{
                              padding: "0.375rem 0.75rem",
                              background: "#dcfce7",
                              color: "#166534",
                              border: "none",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: "0.8125rem",
                              display: "flex",
                              gap: "0.25rem",
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Check size={14} /> Выбрать
                          </button>
                        </form>
                      ))}
                    </div>

                    {/* Reject button for items with candidates */}
                    <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                      <form action={rejectMatchAction}>
                        <input type="hidden" name="matchId" value={item.match.id} />
                        <button
                          type="submit"
                          title="Отклонить все кандидаты"
                          style={{
                            padding: "0.25rem 0.5rem",
                            background: "transparent",
                            color: "#94a3b8",
                            border: "1px solid #e2e8f0",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: "0.75rem",
                            display: "flex",
                            gap: "0.25rem",
                            alignItems: "center",
                          }}
                        >
                          <X size={12} /> Ни один не подходит
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Инструкция */}
      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", background: "#f8fafc" }}>
        <h2 style={{ marginTop: 0 }}>Как работает проверка</h2>
        <ul style={{ paddingLeft: "1.5rem", color: "#4b5563" }}>
          <li>Для каждого несопоставленного товара система ищет кандидатов в каталоге</li>
          <li>Кандидаты отсортированы по уверенности совпадения (score)</li>
          <li>Нажмите «Выбрать» рядом с подходящим товаром, чтобы подтвердить сопоставление</li>
          <li>Если ни один кандидат не подходит — нажмите «Ни один не подходит»</li>
          <li>После подтверждения цены будут использоваться в экспорте</li>
        </ul>
      </section>
    </main>
  );
}
