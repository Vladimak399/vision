import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle,
  Info,
  XCircle,
} from "lucide-react";

import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import {
  acknowledgeAlertAction,
  resolveAlertAction,
  acknowledgeAllAlertsAction,
} from "../actions";
import { getAlerts, getNewAlertCount, getAlertRules } from "../../../../server/online-monitoring/alerts";

export const dynamic = "force-dynamic";

type AlertRow = {
  id: string;
  rule_id: string | null;
  source_id: string | null;
  run_id: string | null;
  alert_type: "competitor_cheaper" | "price_change" | "out_of_stock" | "run_failure";
  severity: "info" | "warning" | "critical";
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  status: "new" | "ack" | "resolved";
  acknowledged_at: string | null;
  resolved_at: string | null;
  triggered_at: string;
};

type SourceInfo = {
  id: string;
  display_name: string;
};

function formatDateTime(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getAlertTypeLabel(type: string): string {
  switch (type) {
    case "competitor_cheaper": return "Конкурент дешевле";
    case "price_change": return "Изменение цены";
    case "out_of_stock": return "Нет в наличии";
    case "run_failure": return "Сбой источника";
    default: return type;
  }
}

function getSeverityIcon(severity: string) {
  switch (severity) {
    case "critical": return <AlertCircle size={18} style={{ color: "#dc2626" }} />;
    case "warning": return <AlertTriangle size={18} style={{ color: "#d97706" }} />;
    case "info": return <Info size={18} style={{ color: "#0ea5e9" }} />;
    default: return <Bell size={18} style={{ color: "#64748b" }} />;
  }
}

function getStatusBadge(status: string) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    new: { bg: "#fef3c7", text: "#92400e", label: "Новое" },
    ack: { bg: "#dbeafe", text: "#1e40af", label: "Просмотрено" },
    resolved: { bg: "#dcfce7", text: "#166534", label: "Решено" },
  };
  const s = styles[status] ?? styles.new;
  return (
    <span style={{ padding: "0.125rem 0.5rem", borderRadius: 4, fontSize: "0.75rem", background: s.bg, color: s.text, fontWeight: 500 }}>
      {s.label}
    </span>
  );
}

function getSeverityBg(severity: string): string {
  switch (severity) {
    case "critical": return "#fef2f2";
    case "warning": return "#fffbeb";
    case "info": return "#f0f9ff";
    default: return "#f8fafc";
  }
}

export default async function OnlineMonitoringAlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/online-monitoring/alerts");

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

  // Fetch alerts and rules
  const alertsList = await getAlerts(companyId);
  const newCount = await getNewAlertCount(companyId);
  const rules = await getAlertRules(companyId);

  // Get source names for display
  const sourceIds = [...new Set(alertsList.map(a => a.sourceId).filter(Boolean))] as string[];
  const { data: sources } = sourceIds.length > 0
    ? await supabase
        .from("online_sources")
        .select("id, display_name")
        .in("id", sourceIds)
        .returns<SourceInfo[]>()
    : { data: [] };
  const sourceMap = new Map((sources ?? []).map((s: SourceInfo) => [s.id, s.display_name]));

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <div>
        <Link href="/app" style={{ textDecoration: "none", color: "#0ea5e9" }}>← Вернуться в рабочую область</Link>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>
          Алерты
          {newCount > 0 && (
            <span style={{ marginLeft: "0.5rem", display: "inline-flex", alignItems: "center", gap: "0.25rem", padding: "0.125rem 0.5rem", borderRadius: 999, background: "#fef3c7", color: "#92400e", fontSize: "0.75rem", fontWeight: 600 }}>
              <AlertCircle size={14} />
              {newCount}
            </span>
          )}
        </h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>
          Уведомления об изменении цен, сбоях источников и исчезнувших товарах.
        </p>
      </div>

      {/* Success/error banners */}
      {params.ackAll && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#dcfce7", border: "1px solid #bbf7d0", color: "#166534", fontSize: "0.875rem" }}>
          <CheckCircle size={16} style={{ verticalAlign: "middle", marginRight: "0.25rem" }} />
          Все новые алерты отмечены как просмотренные.
        </div>
      )}
      {params.resolved && (
        <div style={{ padding: "0.75rem 1rem", borderRadius: 8, background: "#dcfce7", border: "1px solid #bbf7d0", color: "#166534", fontSize: "0.875rem" }}>
          <CheckCircle size={16} style={{ verticalAlign: "middle", marginRight: "0.25rem" }} />
          Алерт отмечен как решённый.
        </div>
      )}

      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/app/online-monitoring" style={{ color: "#64748b" }}>Источники</Link>
        <Link href="/app/online-monitoring/runs" style={{ color: "#64748b" }}>Запуски</Link>
        <Link href="/app/online-monitoring/unmatched" style={{ color: "#64748b" }}>Несопоставленные</Link>
        <Link href="/app/online-monitoring/alerts" style={{ color: "#0ea5e9", fontWeight: 500 }}>Алерты</Link>

        {newCount > 0 && (
          <form action={acknowledgeAllAlertsAction} style={{ marginLeft: "auto" }}>
            <button
              type="submit"
              style={{
                display: "flex", gap: "0.25rem", alignItems: "center",
                padding: "0.375rem 0.75rem", background: "#f1f5f9",
                color: "#475569", border: "1px solid #e2e8f0", borderRadius: 6,
                cursor: "pointer", fontSize: "0.75rem",
              }}
            >
              <Check size={14} />
              Отметить все как просмотренные ({newCount})
            </button>
          </form>
        )}
      </nav>

      {/* Rules summary */}
      {rules.length > 0 && (
        <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1rem 1.5rem", background: "#f8fafc" }}>
          <h3 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "0.875rem", color: "#475569" }}>
            Активные правила ({rules.length})
          </h3>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {rules.map(rule => (
              <span key={rule.id} style={{ padding: "0.25rem 0.5rem", borderRadius: 4, fontSize: "0.75rem", background: "#e2e8f0", color: "#475569" }}>
                {getAlertTypeLabel(rule.alertType)}: {rule.threshold}
                {rule.alertType === "run_failure" ? " подряд" : "%"}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Alerts list */}
      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>
          Список алертов ({alertsList.length})
        </h2>

        {alertsList.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
            <Bell size={32} style={{ marginBottom: "0.5rem", opacity: 0.4 }} />
            <p style={{ marginBottom: 0 }}>Нет алертов. Настройте правила для автоматических уведомлений.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {alertsList.map((alert) => (
              <div
                key={alert.id}
                style={{
                  border: alert.status === "new" ? `1px solid ${getSeverityBg(alert.severity)}` : "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "1rem",
                  background: alert.status === "resolved" ? "#f0fdf4" : alert.status === "new" ? getSeverityBg(alert.severity) : "#fafafa",
                  opacity: alert.status === "resolved" ? 0.6 : 1,
                }}
              >
                <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                  {/* Severity icon */}
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    {getSeverityIcon(alert.severity)}
                  </div>

                  {/* Content */}
                  <div style={{ flexGrow: 1, minWidth: 280 }}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{alert.title}</span>
                      {getStatusBadge(alert.status)}
                      <span style={{ padding: "0.125rem 0.5rem", borderRadius: 4, fontSize: "0.7rem", background: "#f1f5f9", color: "#475569" }}>
                        {getAlertTypeLabel(alert.alertType)}
                      </span>
                    </div>
                    {alert.description && (
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem", color: "#475563" }}>
                        {alert.description}
                      </p>
                    )}
                    <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: "0.25rem" }}>
                      {alert.sourceId && (
                        <span style={{ marginRight: "1rem" }}>
                          Источник: {sourceMap.get(alert.sourceId) ?? alert.sourceId}
                        </span>
                      )}
                      <span>Создано: {formatDateTime(alert.triggeredAt)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  {alert.status !== "resolved" && (
                    <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
                      {alert.status === "new" && (
                        <form action={acknowledgeAlertAction}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <button
                            type="submit"
                            title="Отметить как просмотренное"
                            style={{ padding: "0.375rem", background: "#dbeafe", color: "#1e40af", border: "none", borderRadius: 4, cursor: "pointer" }}
                          >
                            <Check size={16} />
                          </button>
                        </form>
                      )}
                      <form action={resolveAlertAction}>
                        <input type="hidden" name="alertId" value={alert.id} />
                        <button
                          type="submit"
                          title="Отметить как решённое"
                          style={{ padding: "0.375rem", background: "#dcfce7", color: "#166534", border: "none", borderRadius: 4, cursor: "pointer" }}
                        >
                          <CheckCircle size={16} />
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
