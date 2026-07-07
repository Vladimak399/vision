import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../server/auth";
import { getCatalogProducts, getRecentCatalogImports, type CatalogProduct } from "../../../server/catalog";
import { CATALOG_WRITE_ROLES, hasCompanyRole } from "../../../server/company-access";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";

type CatalogPageSearchParams = {
  q?: string | string[];
  price?: string | string[];
  page?: string | string[];
};

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function buildCatalogHref(params: { q: string; price: string; page: number }): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.price) query.set("price", params.price);
  if (params.page > 1) query.set("page", String(params.page));
  const qs = query.toString();
  return `/app/catalog${qs ? `?${qs}` : ""}`;
}

function formatPrice(value: bigint | null, currency: string): string {
  if (value === null) {
    return "—";
  }
  return `${(Number(value) / 100).toFixed(2)} ${currency || "RUB"}`;
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogPageSearchParams> }) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/catalog");
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return (
      <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb" }}>
          <h2 style={{ marginTop: 0 }}>Нет доступа к компании</h2>
          <p style={{ marginBottom: 0 }}>
            Ваш пользователь авторизован, но пока не добавлен в company_members. Попросите администратора компании
            выдать доступ и назначить роль: admin, manager или reviewer.
          </p>
          <Link href="/app" style={{ display: "inline-block", marginTop: "1rem" }}>
            Вернуться в рабочую область
          </Link>
        </section>
      </main>
    );
  }

  const resolvedSearchParams = await searchParams;
  const q = getParam(resolvedSearchParams.q).trim();
  const priceParam = getParam(resolvedSearchParams.price);
  const price = priceParam === "missing" || priceParam === "present" ? priceParam : "";
  const page = Math.max(Number.parseInt(getParam(resolvedSearchParams.page) || "1", 10) || 1, 1);
  const canManageCatalog = hasCompanyRole(membershipResult.membership, CATALOG_WRITE_ROLES);
  let products: CatalogProduct[] = [];
  let totalCount: number | null = null;
  let error: string | null = null;
  let importsError: string | null = null;
  let recentImports: Awaited<ReturnType<typeof getRecentCatalogImports>> = [];
  const pageSize = 50;

  try {
    const catalogResult = await getCatalogProducts(membershipResult.membership.companyId, { q, price: price || undefined, page, pageSize });
    products = catalogResult.products;
    totalCount = catalogResult.totalCount;
  } catch (e) {
    error = e instanceof Error ? e.message : "Не удалось загрузить товары";
  }

  try {
    recentImports = await getRecentCatalogImports(membershipResult.membership.companyId, 5);
  } catch (e) {
    importsError = e instanceof Error ? e.message : "Не удалось загрузить историю импортов";
  }

  const totalPages = totalCount === null ? null : Math.max(Math.ceil(totalCount / pageSize), 1);
  const hasNextPage = totalPages === null ? products.length === pageSize : page < totalPages;
  const countLabel = totalCount === null ? `${products.length} на странице` : `${totalCount} найдено`;

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <div><Link href="/app" style={{ textDecoration: "none", color: "#0ea5e9" }}>← Вернуться в рабочую область</Link></div>

      <div>
        <p style={{ margin: 0, textTransform: "uppercase", fontSize: "0.875rem", color: "#64748b" }}>PriceVision</p>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Каталог товаров</h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>Компания: {membershipResult.membership.companyName}</p>
        {canManageCatalog ? <Link href="/app/catalog/import" style={{ display: "inline-block", marginTop: "0.75rem", color: "#0ea5e9" }}>Импорт каталога</Link> : null}
      </div>

      {canManageCatalog ? (
        <details style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1rem", background: "#f8fafc" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>+ Добавить товар</summary>
          <form action={createProductAction} style={{ display: "grid", gap: "1rem", gridTemplateColumns: "1fr 1fr", marginTop: "1rem" }}>
            <label style={{ gridColumn: "1 / -1", display: "grid", gap: "0.375rem", fontWeight: 500 }}>SKU (обязательно)<input type="text" name="external_sku" required style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 6 }} placeholder="Внешний артикул" /></label>
            <label style={{ gridColumn: "1 / -1", display: "grid", gap: "0.375rem", fontWeight: 500 }}>Название (обязательно)<input type="text" name="name" required style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 6 }} placeholder="Название товара" /></label>
            <label style={{ display: "grid", gap: "0.375rem", fontWeight: 500 }}>Бренд<input type="text" name="brand" style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 6 }} placeholder="Бренд" /></label>
            <label style={{ display: "grid", gap: "0.375rem", fontWeight: 500 }}>Размер<input type="text" name="size_text" style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 6 }} placeholder="Размер" /></label>
            <label style={{ display: "grid", gap: "0.375rem", fontWeight: 500 }}>Цена (копейки)<input type="number" name="own_price_minor" style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 6 }} placeholder="0" /></label>
            <label style={{ display: "grid", gap: "0.375rem", fontWeight: 500 }}>Валюта<select name="currency" defaultValue="RUB" style={{ padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 6 }}><option value="RUB">RUB</option><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
            <button type="submit" style={{ gridColumn: "1 / -1", padding: "0.75rem 1.5rem", background: "#0ea5e9", color: "white", border: "none", borderRadius: 6, fontWeight: 500 }}>Добавить товар</button>
          </form>
        </details>
      ) : null}

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1rem", background: "#f8fafc" }}>
        <form action="/app/catalog" style={{ display: "grid", gap: "0.75rem" }}>
          <label style={{ display: "grid", gap: "0.375rem", fontWeight: 600 }}>Поиск по SKU, названию, бренду или размеру<input name="q" defaultValue={q} placeholder="Например, nescafe" style={{ padding: "0.625rem", border: "1px solid #cbd5e1", borderRadius: 6 }} /></label>
          {price ? <input type="hidden" name="price" value={price} /> : null}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <button type="submit" style={{ padding: "0.625rem 1rem", background: "#0ea5e9", color: "white", border: "none", borderRadius: 6 }}>Найти</button>
            <Link href={buildCatalogHref({ q: "", price, page: 1 })}>Сбросить поиск</Link>
          </div>
        </form>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
          <Link href={buildCatalogHref({ q, price: "", page: 1 })}>Все</Link>
          <Link href={buildCatalogHref({ q, price: "missing", page: 1 })}>Без цены</Link>
          <Link href={buildCatalogHref({ q, price: "present", page: 1 })}>С ценой</Link>
        </div>
      </section>

      {error ? <section aria-live="polite" style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: "1rem", background: "#fffbeb" }}><h2 style={{ marginTop: 0, color: "#92400e" }}>Ошибка</h2><p style={{ margin: 0, color: "#b45309" }}>{error}</p></section> : null}

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Товары ({countLabel})</h2>
        {products.length === 0 ? <p style={{ color: "#64748b", marginBottom: 0 }}>Товаров по текущим условиям нет.</p> : (
          <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}><thead><tr style={{ borderBottom: "2px solid #e2e8f0" }}><th style={{ padding: "0.75rem", textAlign: "left" }}>SKU</th><th style={{ padding: "0.75rem", textAlign: "left" }}>Название</th><th style={{ padding: "0.75rem", textAlign: "left" }}>Бренд</th><th style={{ padding: "0.75rem", textAlign: "left" }}>Размер</th><th style={{ padding: "0.75rem", textAlign: "left" }}>Цена</th><th style={{ padding: "0.75rem", textAlign: "left" }}>Создано</th></tr></thead><tbody>{products.map((product) => <tr key={product.id} style={{ borderBottom: "1px solid #e2e8f0" }}><td style={{ padding: "0.75rem" }}><code style={{ background: "#f1f5f9", padding: "0.25rem 0.5rem", borderRadius: 4 }}>{product.externalSku}</code></td><td style={{ padding: "0.75rem" }}>{product.name}</td><td style={{ padding: "0.75rem" }}>{product.brand ?? "—"}</td><td style={{ padding: "0.75rem" }}>{product.sizeText ?? "—"}</td><td style={{ padding: "0.75rem" }}>{formatPrice(product.ownPriceMinor, product.currency)}</td><td style={{ padding: "0.75rem", color: "#64748b", fontSize: "0.75rem" }}>{new Date(product.createdAt).toLocaleDateString("ru-RU")}</td></tr>)}</tbody></table></div>
        )}
        <nav style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
          <Link aria-disabled={page <= 1} href={page <= 1 ? buildCatalogHref({ q, price, page }) : buildCatalogHref({ q, price, page: page - 1 })} style={{ color: page <= 1 ? "#94a3b8" : "#0ea5e9", pointerEvents: page <= 1 ? "none" : "auto" }}>← Назад</Link>
          <span>Страница {page}{totalPages ? ` из ${totalPages}` : ""}</span>
          <Link aria-disabled={!hasNextPage} href={!hasNextPage ? buildCatalogHref({ q, price, page }) : buildCatalogHref({ q, price, page: page + 1 })} style={{ color: hasNextPage ? "#0ea5e9" : "#94a3b8", pointerEvents: hasNextPage ? "auto" : "none" }}>Вперёд →</Link>
        </nav>
      </section>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", background: "#f8fafc" }}>
        <h2 style={{ marginTop: 0 }}>Последние импорты</h2>
        {importsError ? <p style={{ color: "#b45309" }}>{importsError}</p> : recentImports.length === 0 ? <p style={{ color: "#64748b", marginBottom: 0 }}>Импортов пока нет.</p> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}><thead><tr><th style={{ padding: "0.5rem", textAlign: "left" }}>Файл</th><th style={{ padding: "0.5rem", textAlign: "left" }}>Статус</th><th style={{ padding: "0.5rem", textAlign: "left" }}>Строк</th><th style={{ padding: "0.5rem", textAlign: "left" }}>Ошибок</th><th style={{ padding: "0.5rem", textAlign: "left" }}>Создан</th></tr></thead><tbody>{recentImports.map((item) => <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0" }}><td style={{ padding: "0.5rem" }}>{item.filename}</td><td style={{ padding: "0.5rem" }}>{item.status}</td><td style={{ padding: "0.5rem" }}>{item.rowCount ?? "—"}</td><td style={{ padding: "0.5rem" }}>{item.errorCount ?? "—"}</td><td style={{ padding: "0.5rem" }}>{new Date(item.createdAt).toLocaleString("ru-RU")}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
