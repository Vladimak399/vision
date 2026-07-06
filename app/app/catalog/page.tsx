import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../server/auth";
import { getCatalogProducts, type CatalogProduct } from "../../../server/catalog";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { createProductAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
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

  let products: CatalogProduct[] = [];
  let error: string | null = null;

  try {
    products = await getCatalogProducts();
  } catch (e) {
    error = e instanceof Error ? e.message : "Не удалось загрузить товары";
  }

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <div>
        <Link href="/app" style={{ textDecoration: "none", color: "#0ea5e9" }}>
          ← Вернуться в рабочую область
        </Link>
      </div>

      <div>
        <p style={{ margin: 0, textTransform: "uppercase", fontSize: "0.875rem", color: "#64748b" }}>
          PriceVision
        </p>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Каталог товаров</h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>Компания: {membershipResult.membership.companyName}</p>
      </div>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", background: "#f8fafc" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Добавить новый товар</h2>
        <form
          action={createProductAction}
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 500 }}>
              SKU (обязательно)
            </label>
            <input
              type="text"
              name="external_sku"
              required
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
              placeholder="Внешний артикул"
            />
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 500 }}>
              Название (обязательно)
            </label>
            <input
              type="text"
              name="name"
              required
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
              placeholder="Название товара"
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 500 }}>Бренд</label>
            <input
              type="text"
              name="brand"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
              placeholder="Бренд"
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 500 }}>Размер</label>
            <input
              type="text"
              name="size_text"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
              placeholder="Размер"
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 500 }}>
              Цена (копейки)
            </label>
            <input
              type="number"
              name="own_price_minor"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
              placeholder="0"
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.375rem", fontWeight: 500 }}>Валюта</label>
            <select
              name="currency"
              defaultValue="RUB"
              style={{
                width: "100%",
                padding: "0.5rem",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                fontSize: "1rem",
                boxSizing: "border-box",
              }}
            >
              <option value="RUB">RUB</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>

          <button
            type="submit"
            style={{
              gridColumn: "1 / -1",
              padding: "0.75rem 1.5rem",
              background: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: "1rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Добавить товар
          </button>
        </form>
      </section>

      {error ? (
        <section
          aria-live="polite"
          style={{
            border: "1px solid #f59e0b",
            borderRadius: 12,
            padding: "1rem",
            background: "#fffbeb",
          }}
        >
          <h2 style={{ marginTop: 0, color: "#92400e" }}>Ошибка</h2>
          <p style={{ margin: 0, color: "#b45309" }}>{error}</p>
        </section>
      ) : null}

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Товары ({products.length})</h2>
        {products.length === 0 ? (
          <p style={{ color: "#64748b", marginBottom: 0 }}>Товаров в каталоге нет. Добавьте первый товар выше.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.875rem",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>SKU</th>
                  <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Название</th>
                  <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Бренд</th>
                  <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Размер</th>
                  <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Цена</th>
                  <th style={{ padding: "0.75rem", textAlign: "left", fontWeight: 600 }}>Создано</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const price = product.ownPriceMinor
                    ? `${(Number(product.ownPriceMinor) / 100).toFixed(2)} ${product.currency}`
                    : "—";
                  const created = new Date(product.createdAt).toLocaleDateString("ru-RU", {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  });

                  return (
                    <tr key={product.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "0.75rem" }}>
                        <code style={{ background: "#f1f5f9", padding: "0.25rem 0.5rem", borderRadius: 4 }}>
                          {product.externalSku}
                        </code>
                      </td>
                      <td style={{ padding: "0.75rem" }}>{product.name}</td>
                      <td style={{ padding: "0.75rem" }}>{product.brand ?? "—"}</td>
                      <td style={{ padding: "0.75rem" }}>{product.sizeText ?? "—"}</td>
                      <td style={{ padding: "0.75rem" }}>{price}</td>
                      <td style={{ padding: "0.75rem", color: "#64748b", fontSize: "0.75rem" }}>{created}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
