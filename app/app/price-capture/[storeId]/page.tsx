import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { ItemsTable } from "./items-table";
import { ExportForm } from "./export-form";

export const dynamic = "force-dynamic";

type Store = {
  id: string;
  name: string;
  address: string | null;
  is_own: boolean;
};

type ShelfItem = {
  id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  confidence: number;
  catalog_product_id: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  matched_at: string | null;
  photo_storage_path: string | null;
  photo_filename: string | null;
  captured_date: string;
};

type StoreItemsPageProps = {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{
    week?: string;
    matched?: string;
    unmatched?: string;
    total?: string;
    match_error?: string;
  }>;
};

export default async function StoreItemsPage({
  params,
  searchParams
}: StoreItemsPageProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/price-capture");
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <Link href="/app">← Назад</Link>
        <h1>Нет доступа к компании</h1>
      </main>
    );
  }

  const { storeId } = await params;
  const resolvedSearchParams = await searchParams;
  const weekParam = resolvedSearchParams.week;
  const week: 1 | 2 = weekParam === "2" ? 2 : 1;

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  // Получаем данные магазина
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name, address, is_own")
    .eq("company_id", companyId)
    .eq("id", storeId)
    .maybeSingle();

  if (storeError || !store) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <Link href="/app/price-capture">← Назад</Link>
        <h1>Магазин не найден</h1>
      </main>
    );
  }

  if (store.is_own) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <Link href="/app/price-capture">← Назад</Link>
        <h1>Ошибка</h1>
        <p>Выберите магазин конкурента, а не вашу точку.</p>
      </main>
    );
  }

  // Получаем товары с полки
  const { data: items, error: itemsError } = await supabase
    .from("competitor_shelf_items")
    .select(
      "id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, price_tag_text, product_visible_text, confidence, catalog_product_id, match_confidence, match_reason, matched_at, photo_storage_path, captured_date, photo_filename",
    )
    .eq("company_id", companyId)
    .eq("store_id", storeId)
    .eq("week", week)
    .order("captured_date", { ascending: false });

  if (itemsError) {
    console.error("Error loading shelf items:", itemsError);
  }

  const shelfItems: ShelfItem[] = items ?? [];
  const matchedCount = shelfItems.filter((i) => i.catalog_product_id !== null).length;
  const unmatchedCount = shelfItems.length - matchedCount;

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <div>
        <Link href="/app/price-capture" style={{ textDecoration: "none", color: "#0ea5e9" }}>
          ← Назад к выбору магазина
        </Link>
      </div>

      <header style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{store.name}</h1>
        {store.address && <span className="muted" style={{ margin: 0 }}>{store.address}</span>}
      </header>

      {resolvedSearchParams.match_error && (
        <div style={{
          marginTop: "1rem",
          padding: "1rem",
          background: "#fef2f2",
          border: "1px solid #f87171",
          borderRadius: 6,
          color: "#991b1b",
        }}>
          Ошибка сопоставления: {resolvedSearchParams.match_error}
        </div>
      )}

      {resolvedSearchParams.matched && !resolvedSearchParams.match_error && (
        <div style={{
          marginTop: "1rem",
          padding: "1rem",
          background: "#dcfce7",
          border: "1px solid #86efac",
          borderRadius: 6,
          color: "#166534",
        }}>
          Сопоставлено {resolvedSearchParams.matched} из {resolvedSearchParams.total} товаров. {resolvedSearchParams.unmatched} не сопоставлено.
        </div>
      )}

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted" style={{ margin: 0 }}>
          Неделя <strong>{week}</strong>
        </span>
        <span className="muted" style={{ margin: 0 }}>
          {shelfItems.length} товаров, {matchedCount} сопоставлено, {unmatchedCount} не сопоставлено
        </span>
      </div>

      {unmatchedCount > 0 && (
        <form action={`/app/price-capture/${storeId}/match`} method="post">
          <input type="hidden" name="week" value={String(week)} />
          <input type="hidden" name="storeId" value={storeId} />
          <button
            type="submit"
            style={{
              padding: "0.75rem 1.5rem",
              background: "#0ea5e9",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Сопоставить с каталогом
          </button>
        </form>
      )}

      <ExportForm week={week} />

      <ItemsTable items={shelfItems} week={week} storeId={storeId} />
    </main>
  );
}