import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../../server/auth";
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
    </main>
  );
}
