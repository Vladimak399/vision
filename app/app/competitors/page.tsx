import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { CreateCompetitorForm } from "./create-competitor-form";

export const dynamic = "force-dynamic";

type Competitor = {
  id: string;
  name: string;
};

export default async function CompetitorsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/competitors");
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("competitors")
    .select("id, name")
    .eq("company_id", membershipResult.membership.companyId)
    .order("created_at", { ascending: false })
    .returns<Competitor[]>();

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header>
        <Link href="/app">← Рабочая область</Link>
        <h1>Конкуренты</h1>
        <p>Компания: {membershipResult.membership.companyName}</p>
      </header>

      <CreateCompetitorForm />

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Список конкурентов</h2>
        {error ? (
          <p style={{ color: "#b91c1c" }}>Не удалось загрузить конкурентов: {error.message}</p>
        ) : data.length === 0 ? (
          <p>Конкуренты пока не добавлены</p>
        ) : (
          <ul style={{ display: "grid", gap: "0.5rem", margin: 0, paddingLeft: "1.25rem" }}>
            {data.map((competitor) => (
              <li key={competitor.id}>{competitor.name}</li>
            ))}
          </ul>
        )}
      </section>
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
