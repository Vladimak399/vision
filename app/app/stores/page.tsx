import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { CreateStoreForm } from "./create-store-form";

export const dynamic = "force-dynamic";

type Store = {
  id: string;
  name: string;
  address: string | null;
};

export default async function StoresPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/stores");
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
    .from("stores")
    .select("id, name, address")
    .eq("company_id", membershipResult.membership.companyId)
    .order("created_at", { ascending: false })
    .returns<Store[]>();

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header>
        <Link href="/app">← Рабочая область</Link>
        <h1>Магазины</h1>
        <p>Компания: {membershipResult.membership.companyName}</p>
      </header>

      <CreateStoreForm />

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Список магазинов</h2>
        {error ? (
          <p style={{ color: "#b91c1c" }}>Не удалось загрузить магазины: {error.message}</p>
        ) : data.length === 0 ? (
          <p>Магазины пока не добавлены</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={cellStyle}>Название</th>
                  <th style={cellStyle}>Адрес</th>
                </tr>
              </thead>
              <tbody>
                {data.map((store) => (
                  <tr key={store.id}>
                    <td style={cellStyle}>{store.name}</td>
                    <td style={cellStyle}>{store.address ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const cellStyle = { borderBottom: "1px solid #e5e7eb", padding: "0.5rem", textAlign: "left" as const };

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
