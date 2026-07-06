import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { CreateMonitoringSessionForm } from "./create-monitoring-session-form";

export const dynamic = "force-dynamic";

type Store = {
  id: string;
  name: string;
  address: string | null;
};

export default async function NewMonitoringSessionPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/monitoring/new");
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return <AccessError message={error instanceof Error ? error.message : "Не удалось проверить доступ к компании."} />;
  }

  if (membershipResult.status !== "ok") {
    return <NoAccess />;
  }

  const canCreateSession = ["admin", "manager"].includes(membershipResult.membership.role);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("stores")
    .select("id, name, address")
    .eq("company_id", membershipResult.membership.companyId)
    .order("created_at", { ascending: false })
    .returns<Store[]>();

  const stores = data ?? [];

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header>
        <Link href="/app/monitoring">← Мониторинг</Link>
        <h1>Создать сессию мониторинга</h1>
        <p>Компания: {membershipResult.membership.companyName}</p>
      </header>

      {!canCreateSession ? (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb" }}>
          <h2 style={{ marginTop: 0 }}>Недостаточно прав</h2>
          <p style={{ marginBottom: 0 }}>Создавать сессии мониторинга могут только пользователи с ролью admin или manager.</p>
        </section>
      ) : error ? (
        <section style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: "1rem", background: "#fffbeb" }}>
          <h2 style={{ marginTop: 0 }}>Не удалось загрузить магазины</h2>
          <p style={{ marginBottom: 0 }}>{error.message}</p>
        </section>
      ) : stores.length === 0 ? (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb" }}>
          <h2 style={{ marginTop: 0 }}>Нет магазинов для мониторинга</h2>
          <p>Сначала добавьте магазин, затем создайте сессию мониторинга.</p>
          <Link href="/app/stores">Перейти к магазинам</Link>
        </section>
      ) : (
        <CreateMonitoringSessionForm stores={stores} />
      )}
    </main>
  );
}

function NoAccess() {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app">← Рабочая область</Link>
      <h1>Нет доступа к компании</h1>
      <p>Ваш пользователь авторизован, но пока не добавлен в company_members.</p>
    </main>
  );
}

function AccessError({ message }: { message: string }) {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app">← Рабочая область</Link>
      <h1>Не удалось проверить доступ к компании</h1>
      <p>{message}</p>
    </main>
  );
}
