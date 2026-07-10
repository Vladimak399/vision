import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { PriceCaptureForm } from "./price-capture-form";

export const dynamic = "force-dynamic";

type StoreRow = {
  id: string;
  name: string;
  address: string | null;
  is_own: boolean;
};

export default async function PriceCapturePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/app/price-capture`);
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <h1>Ошибка доступа</h1>
        <p>{error instanceof Error ? error.message : "Не удалось проверить доступ."}</p>
      </main>
    );
  }

  if (membershipResult.status !== "ok") {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <Link href="/app">← Назад</Link>
        <h1>Нет доступа к компании</h1>
      </main>
    );
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name, address, is_own")
    .eq("company_id", companyId)
    .eq("is_own", false)
    .order("name", { ascending: true })
    .returns<StoreRow[]>();

  const competitorStores = stores ?? [];

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">
            <Link href="/app">← Рабочая область</Link>
          </p>
          <h1>Загрузка фото конкурента</h1>
          <p className="lead">
            Выберите неделю и магазин конкурента, сфотографируйте полки — приложение
            распознает товары и цены, сопоставит с каталогом и сохранит результаты.
          </p>
        </div>
      </header>

      {competitorStores.length === 0 ? (
        <section className="card soft">
          <h2>Нет магазинов-конкурентов</h2>
          <p style={{ color: "#4b5563" }}>
            Сначала загрузите шаблон мониторинга на странице{" "}
            <Link href="/app/template-import">импорта шаблона</Link> — тогда
            конкуренты появятся в этом списке.
          </p>
        </section>
      ) : (
        <PriceCaptureForm stores={competitorStores.map((s) => ({ id: s.id, name: s.name, address: s.address }))} />
      )}
    </main>
  );
}
