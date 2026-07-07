import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../../server/auth";
import { getRecentCatalogImports } from "../../../../server/catalog";
import { CATALOG_WRITE_ROLES, hasCompanyRole, roleList } from "../../../../server/company-access";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { CatalogImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function CatalogImportPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/catalog/import");
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    redirect("/app/catalog");
  }

  const canManageCatalog = hasCompanyRole(membershipResult.membership, CATALOG_WRITE_ROLES);
  let recentImports: Awaited<ReturnType<typeof getRecentCatalogImports>> = [];
  let importsError: string | null = null;

  try {
    recentImports = await getRecentCatalogImports(membershipResult.membership.companyId, 5);
  } catch (error) {
    importsError = error instanceof Error ? error.message : "Не удалось загрузить историю импортов";
  }

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <div>
        <Link href="/app/catalog" style={{ textDecoration: "none", color: "#0ea5e9" }}>
          ← Вернуться в каталог
        </Link>
      </div>

      <header>
        <p style={{ margin: 0, textTransform: "uppercase", fontSize: "0.875rem", color: "#64748b" }}>PriceVision</p>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Импорт каталога</h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>
          Загрузите CSV или XLSX файл, чтобы создать или обновить товары компании {membershipResult.membership.companyName}.
        </p>
        <p style={{ color: "#64748b", marginTop: "0.5rem" }}>
          CSV можно загружать с разделителем &quot;,&quot; или &quot;;&quot;. Для файлов из Excel надежнее
          использовать XLSX.
        </p>
      </header>

      {!canManageCatalog ? (
        <section style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: "1rem", background: "#fffbeb" }}>
          <h2 style={{ marginTop: 0, color: "#92400e" }}>Недостаточно прав</h2>
          <p style={{ marginBottom: 0, color: "#b45309" }}>
            Импортировать каталог могут только {roleList(CATALOG_WRITE_ROLES)}. Обратитесь к администратору компании.
          </p>
        </section>
      ) : (
        <>
          <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
            <h2 style={{ marginTop: 0 }}>Поддерживаемые колонки</h2>
            <ul style={{ marginBottom: 0, paddingLeft: "1.25rem" }}>
              <li><strong>external_sku</strong> или <strong>sku</strong> — обязательный внешний артикул.</li>
              <li><strong>name</strong> — обязательное название товара.</li>
              <li><strong>brand</strong> — бренд товара.</li>
              <li><strong>size_text</strong> или <strong>size</strong> — размер или фасовка.</li>
              <li><strong>price</strong> или <strong>price_rub</strong> — цена в рублях, которая будет сохранена в копейках.</li>
            </ul>
          </section>

          <CatalogImportForm />

          <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem", background: "#f8fafc" }}>
            <h2 style={{ marginTop: 0 }}>Последние импорты</h2>
            {importsError ? (
              <p style={{ color: "#b45309", marginBottom: 0 }}>{importsError}</p>
            ) : recentImports.length === 0 ? (
              <p style={{ color: "#64748b", marginBottom: 0 }}>Импортов пока нет.</p>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Файл</th>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Статус</th>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Строк</th>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Ошибок</th>
                      <th style={{ padding: "0.5rem", textAlign: "left" }}>Создан</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentImports.map((item) => (
                      <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "0.5rem" }}>{item.filename}</td>
                        <td style={{ padding: "0.5rem" }}>{item.status}</td>
                        <td style={{ padding: "0.5rem" }}>{item.rowCount ?? "—"}</td>
                        <td style={{ padding: "0.5rem" }}>{item.errorCount ?? "—"}</td>
                        <td style={{ padding: "0.5rem" }}>{new Date(item.createdAt).toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
