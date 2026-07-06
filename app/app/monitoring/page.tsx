import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export const dynamic = "force-dynamic";

type MonitoringSessionRow = {
  id: string;
  status: string;
  created_at: string;
  stores: {
    name: string;
  } | null;
};

type MonitoringPhotoRow = {
  session_id: string;
};

export default async function MonitoringPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/monitoring");
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
  const { data: sessions, error } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, stores(name)")
    .eq("company_id", membershipResult.membership.companyId)
    .order("created_at", { ascending: false })
    .returns<MonitoringSessionRow[]>();

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const photoCounts = new Map<string, number>();

  let photoCountError: string | null = null;

  if (sessionIds.length > 0) {
    const { data: photos, error: photosError } = await supabase
      .from("monitoring_photos")
      .select("session_id")
      .eq("company_id", membershipResult.membership.companyId)
      .in("session_id", sessionIds)
      .returns<MonitoringPhotoRow[]>();

    if (photosError) {
      photoCountError = photosError.message;
    }

    for (const photo of photos ?? []) {
      photoCounts.set(photo.session_id, (photoCounts.get(photo.session_id) ?? 0) + 1);
    }
  }

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href="/app">← Рабочая область</Link>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Мониторинг</h1>
          <p style={{ margin: 0 }}>Компания: {membershipResult.membership.companyName}</p>
        </div>
        <div>
          <Link href="/app/monitoring/new">Создать сессию мониторинга</Link>
        </div>
      </header>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Сессии мониторинга</h2>
        {photoCountError ? (
          <p style={{ color: "#b45309" }}>Не удалось загрузить количество фото: {photoCountError}</p>
        ) : null}
        {error ? (
          <p style={{ color: "#b91c1c" }}>Не удалось загрузить сессии: {error.message}</p>
        ) : !sessions || sessions.length === 0 ? (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            <p style={{ margin: 0 }}>Сессии мониторинга пока не созданы.</p>
            <Link href="/app/monitoring/new">Создать первую сессию</Link>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={cellStyle}>Дата создания</th>
                  <th style={cellStyle}>Статус</th>
                  <th style={cellStyle}>Магазин</th>
                  <th style={cellStyle}>Фото</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id}>
                    <td style={cellStyle}>{new Date(session.created_at).toLocaleString("ru-RU")}</td>
                    <td style={cellStyle}>{session.status}</td>
                    <td style={cellStyle}>{session.stores?.name ?? "—"}</td>
                    <td style={cellStyle}>{photoCounts.get(session.id) ?? 0}</td>
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
