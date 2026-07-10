import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react";

import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";

type RunRow = {
  id: string;
  source_id: string | null;
  trigger: "cron" | "manual" | "retry";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  started_at: string | null;
  completed_at: string | null;
  parser_version: string;
  stats: {
    fetched: number;
    productsUpserted: number;
    pricesInserted: number;
    matched: number;
    unmatched: number;
    errors: number;
  } | null;
  error_summary: string | null;
};

type SourceInfo = {
  id: string;
  source_key: string;
  display_name: string;
};

function getStatusIcon(status: string) {
  switch (status) {
    case "succeeded": return <CheckCircle size={16} style={{ color: "#16a34a" }} />;
    case "failed": return <XCircle size={16} style={{ color: "#dc2626" }} />;
    case "running": return <Clock size={16} style={{ color: "#2563eb" }} />;
    case "queued": return <Clock size={16} style={{ color: "#64748b" }} />;
    default: return <AlertCircle size={16} style={{ color: "#92400e" }} />;
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "queued": return "В очереди";
    case "running": return "Выполняется";
    case "succeeded": return "Успешно";
    case "failed": return "Ошибка";
    case "cancelled": return "Отменено";
    default: return status;
  }
}

function formatDateTime(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds} сек`;
  return `${Math.round(seconds / 60)} мин ${seconds % 60} сек`;
}

export default async function OnlineMonitoringRunsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/online-monitoring/runs");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <h1>Ошибка доступа</h1>
        <Link href="/app">← Вернуться в рабочую область</Link>
      </main>
    );
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  const { data: runs } = await supabase
    .from("online_source_runs")
    .select(`
      id,
      source_id,
      trigger,
      status,
      started_at,
      completed_at,
      parser_version,
      stats,
      error_summary
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);

  const runsList = (runs ?? []) as RunRow[];

  const sourceIds = [...new Set(runsList.map(r => r.source_id).filter(Boolean))] as string[];
  const { data: sources } = sourceIds.length > 0
    ? await supabase
        .from("online_sources")
        .select("id, source_key, display_name")
        .in("id", sourceIds)
        .returns<SourceInfo[]>()
    : { data: [] };

  const sourceMap = new Map((sources ?? []).map((s: SourceInfo) => [s.id, s]));

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <div>
        <Link href="/app" style={{ textDecoration: "none", color: "#0ea5e9" }}>← Вернуться в рабочую область</Link>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Запуски онлайн-мониторинга</h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>
          История запусков: статус, статистика, ошибки. Компания: {membershipResult.membership.companyName}
        </p>
      </div>

      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/app/online-monitoring" style={{ color: "#64748b" }}>
          Источники
        </Link>
        <Link href="/app/online-monitoring/runs" style={{ color: "#0ea5e9", fontWeight: 500 }}>
          Запуски
        </Link>
        <Link href="/app/online-monitoring/unmatched" style={{ color: "#64748b" }}>
          Несопоставленные
        </Link>
        <Link href="/app/online-monitoring/alerts" style={{ color: "#64748b" }}>
          Алерты
        </Link>
      </nav>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>История запусков</h2>

        {runsList.length === 0 ? (
          <p style={{ color: "#64748b", marginBottom: 0 }}>
            Запусков пока нет. Добавьте источники и запустите мониторинг.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Источник</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Триггер</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Статус</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Статистика</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Время</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Ошибка</th>
                </tr>
              </thead>
              <tbody>
                {runsList.map((run) => {
                  const source = run.source_id ? sourceMap.get(run.source_id) : undefined;
                  return (
                    <tr key={run.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "0.75rem", fontWeight: 500 }}>
                        {source?.display_name ?? "—"}
                      </td>
                      <td style={{ padding: "0.75rem" }}>
                        {run.trigger === "cron" ? "Плановый" : run.trigger === "manual" ? "Вручную" : "Повтор"}
                      </td>
                      <td style={{ padding: "0.75rem" }}>
                        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                          {getStatusIcon(run.status)}
                          <span>{getStatusLabel(run.status)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#4b5563" }}>
                        {run.stats ? (
                          <div>
                            Товаров: {run.stats.fetched}, Сопоставлено: {run.stats.matched}, Неопознано: {run.stats.unmatched}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "0.75rem", fontSize: "0.8125rem", color: "#64748b" }}>
                        <div>
                          {formatDateTime(run.started_at)}
                        </div>
                        <div>
                          {run.completed_at && (
                            <span>Длительность: {formatDuration(run.started_at, run.completed_at)}</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem", maxWidth: 200 }}>
                        {run.error_summary ? (
                          <span style={{ color: "#dc2626", fontSize: "0.8125rem" }}>
                            {run.error_summary.length > 80 ? `${run.error_summary.slice(0, 80)}...` : run.error_summary}
                          </span>
                        ) : (
                          <span style={{ color: "#64748b" }}>—</span>
                        )}
                      </td>
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