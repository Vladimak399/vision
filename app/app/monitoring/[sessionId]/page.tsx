import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

export const dynamic = "force-dynamic";

type MonitoringSession = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  stores: {
    name: string;
    address: string | null;
  } | null;
};

type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function MonitoringSessionPage({ params }: PageProps) {
  const { sessionId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/app/monitoring/${encodeURIComponent(sessionId)}`);
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
  const { data: session, error } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, started_at, completed_at, stores(name, address)")
    .eq("company_id", membershipResult.membership.companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<MonitoringSession | null>();

  if (error) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <Link href="/app/monitoring">← Мониторинг</Link>
        <h1>Не удалось загрузить сессию мониторинга</h1>
        <p>{error.message}</p>
      </main>
    );
  }

  if (!session) {
    return <SessionNotFound />;
  }

  const { count: photoCount, error: photoCountError } = await supabase
    .from("monitoring_photos")
    .select("id", { count: "exact", head: true })
    .eq("company_id", membershipResult.membership.companyId)
    .eq("session_id", session.id);

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href="/app/monitoring">← Мониторинг</Link>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Сессия мониторинга {formatShortId(session.id)}</h1>
          <p style={{ margin: 0 }}>Компания: {membershipResult.membership.companyName}</p>
        </div>
      </header>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Детали сессии</h2>
        {photoCountError ? (
          <p style={{ color: "#b45309" }}>Не удалось загрузить количество фото: {photoCountError.message}</p>
        ) : null}
        <dl style={{ display: "grid", gap: "0.75rem", margin: 0 }}>
          <DetailRow label="ID сессии" value={session.id} />
          <DetailRow label="Компания" value={membershipResult.membership.companyName} />
          <DetailRow label="Магазин" value={session.stores?.name ?? "—"} />
          <DetailRow label="Адрес магазина" value={session.stores?.address || "—"} />
          <DetailRow label="Статус" value={session.status} />
          <DetailRow label="Создана" value={formatDateTime(session.created_at)} />
          {session.started_at ? <DetailRow label="Начата" value={formatDateTime(session.started_at)} /> : null}
          {session.completed_at ? <DetailRow label="Завершена" value={formatDateTime(session.completed_at)} /> : null}
          <DetailRow label="Фото" value={String(photoCount ?? 0)} />
        </dl>
      </section>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb" }}>
        <h2 style={{ marginTop: 0 }}>Фото</h2>
        <p style={{ marginBottom: "0.25rem" }}>Фото пока не загружены</p>
        <p style={{ margin: 0, color: "#4b5563" }}>Загрузка фото будет добавлена следующим этапом</p>
      </section>
    </main>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: "0.25rem", gridTemplateColumns: "minmax(140px, 220px) 1fr" }}>
      <dt style={{ color: "#4b5563" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

function SessionNotFound() {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app/monitoring">← Мониторинг</Link>
      <h1>Сессия мониторинга не найдена</h1>
      <p>Сессия не существует или недоступна для текущей компании.</p>
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU");
}

function formatShortId(value: string) {
  return value.slice(0, 8);
}
