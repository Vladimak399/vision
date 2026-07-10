import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink, Play, Clock, AlertCircle } from "lucide-react";

import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { runSourceAction } from "./actions";

export const dynamic = "force-dynamic";

type OnlineSourceWithStores = {
  id: string;
  source_key: string;
  display_name: string;
  base_url: string | null;
  enabled: boolean;
  legal_status: "pending" | "allowed" | "blocked";
  rate_limit_per_minute: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
  source_stores: Array<{
    store_id: string;
    source_store_id: string | null;
    source_city: string | null;
    source_address: string | null;
    store: { id: string; name: string } | null;
  }>;
};

type SupabaseSource = {
  id: string;
  source_key: string;
  display_name: string;
  base_url: string | null;
  enabled: boolean;
  legal_status: "pending" | "allowed" | "blocked";
  rate_limit_per_minute: number | null;
  updated_at: string;
};

interface SupabaseStoreItem {
  source_id: unknown;
  store_id: unknown;
  source_store_id: unknown;
  source_city: unknown;
  source_address: unknown;
  stores: { id: string; name: string } | { id: string; name: string }[] | null;
}

function formatDate(date: string | null): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function getLegalStatusBadge(status: "pending" | "allowed" | "blocked") {
  const styles = {
    pending: { bg: "#fef3c7", text: "#92400e", label: "Ожидает проверки" },
    allowed: { bg: "#dcfce7", text: "#166534", label: "Разрешён" },
    blocked: { bg: "#fee2e2", text: "#991b1b", label: "Запрещён" },
  };
  const s = styles[status];
  return (
    <span style={{ padding: "0.125rem 0.5rem", borderRadius: 4, fontSize: "0.75rem", background: s.bg, color: s.text, fontWeight: 500 }}>
      {s.label}
    </span>
  );
}

export default async function OnlineMonitoringPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/online-monitoring");

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <h1>Ошибка доступа</h1>
        <p>Нет доступа к компании.</p>
        <Link href="/app">← Вернуться в рабочую область</Link>
      </main>
    );
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();

  const { data: sources } = await supabase
    .from("online_sources")
    .select("id, source_key, display_name, base_url, enabled, legal_status, rate_limit_per_minute, updated_at")
    .eq("company_id", companyId)
    .order("display_name", { ascending: true });

  const { data: lastRuns } = await supabase
    .from("online_source_runs")
    .select("source_id, status, started_at")
    .eq("company_id", companyId)
    .order("started_at", { ascending: false });

  const { data: sourceStores } = await supabase
    .from("online_source_stores")
    .select("source_id, store_id, source_store_id, source_city, source_address, stores:store_id(id, name)")
    .eq("enabled", true);

  const sourcesList = (sources ?? []).map((source: SupabaseSource) => {
    const lastRun = lastRuns?.find((r) => r.source_id === source.id);
    const stores = (sourceStores ?? []).filter((ss: SupabaseStoreItem) => ss.source_id === source.id);
    return {
      ...source,
      last_run_at: lastRun?.started_at ?? null,
      last_run_status: lastRun?.status ?? null,
      source_stores: stores.map((s: SupabaseStoreItem) => {
        const storeData = Array.isArray(s.stores) ? s.stores[0] : s.stores;
        return {
          store_id: String(s.store_id ?? ""),
          source_store_id: s.source_store_id ? String(s.source_store_id) : null,
          source_city: s.source_city ? String(s.source_city) : null,
          source_address: s.source_address ? String(s.source_address) : null,
          store: storeData ?? null,
        };
      }),
    };
  });

  return (
    <main style={{ display: "grid", gap: "1.5rem", margin: "2rem auto", maxWidth: 1120, padding: "0 1rem" }}>
      <div>
        <Link href="/app" style={{ textDecoration: "none", color: "#0ea5e9" }}>← Вернуться в рабочую область</Link>
        <h1 style={{ margin: "0.5rem 0 0 0" }}>Онлайн-мониторинг</h1>
        <p style={{ color: "#64748b", marginTop: "0.25rem" }}>Сбор цен из онлайн-каталогов конкурентов.</p>
      </div>

      <nav style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/app/online-monitoring" style={{ color: "#0ea5e9", fontWeight: 500 }}>Источники</Link>
        <Link href="/app/online-monitoring/runs" style={{ color: "#64748b" }}>Запуски</Link>
        <Link href="/app/online-monitoring/unmatched" style={{ color: "#64748b" }}>Несопоставленные</Link>
        <Link href="/app/online-monitoring/alerts" style={{ color: "#64748b" }}>Алерты</Link>
      </nav>

      <section style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "1.5rem" }}>
        <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Источники цен</h2>

        {sourcesList.length === 0 ? (
          <p style={{ color: "#64748b", marginBottom: 0 }}>Источников онлайн-мониторинга пока нет.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Источник</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Статус</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Магазины</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Последний запуск</th>
                  <th style={{ padding: "0.75rem", textAlign: "left" }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {sourcesList.map((source: OnlineSourceWithStores) => (
                  <tr key={source.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "0.75rem" }}>
                      <div style={{ fontWeight: 500 }}>{source.display_name}</div>
                      {source.base_url && (
                        <a href={source.base_url} target="_blank" rel="noopener noreferrer" style={{ color: "#64748b", fontSize: "0.75rem", textDecoration: "none" }}>
                          {source.base_url} <ExternalLink size={12} />
                        </a>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        <span style={{ padding: "0.125rem 0.5rem", borderRadius: 4, fontSize: "0.75rem", background: source.enabled ? "#dcfce7" : "#e2e8f0", color: source.enabled ? "#166534" : "#64748b" }}>
                          {source.enabled ? "Включён" : "Отключён"}
                        </span>
                        {getLegalStatusBadge(source.legal_status)}
                      </div>
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      {source.source_stores.length === 0 ? (
                        <span style={{ color: "#64748b" }}>—</span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                          {source.source_stores.map((ss) => (
                            <li key={ss.store_id} style={{ marginBottom: "0.25rem" }}>
                              {ss.store?.name ?? "?"}{ss.source_city ? ` (${ss.source_city})` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                        <Clock size={14} style={{ color: "#64748b" }} />
                        <span>{formatDate(source.last_run_at)}</span>
                      </div>
                      {source.last_run_status === "failed" && (
                        <span style={{ color: "#dc2626", fontSize: "0.75rem" }}>
                          <AlertCircle size={12} /> Ошибка
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "0.75rem" }}>
                      <form action={runSourceAction} method="post" style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                        <input type="hidden" name="sourceKey" value={source.source_key} />
                        {source.source_stores.length > 1 ? (
                          <select name="storeId" style={{ padding: "0.25rem 0.5rem", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: "0.75rem", maxWidth: 160 }}>
                            <option value="">Все магазины</option>
                            {source.source_stores.map((ss) => (
                              <option key={ss.store_id} value={ss.source_store_id ?? ""}>
                                {ss.store?.name ?? "?"}{ss.source_city ? ` (${ss.source_city})` : ""}
                              </option>
                            ))}
                          </select>
                        ) : source.source_stores.length === 1 ? (
                          <input type="hidden" name="storeId" value={source.source_stores[0].source_store_id ?? ""} />
                        ) : null}
                        <button type="submit" style={{ display: "flex", gap: "0.25rem", alignItems: "center", padding: "0.375rem 0.75rem", background: "#0ea5e9", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.75rem" }}>
                          <Play size={12} /> Запустить
                        </button>
                      </form>
                    </td>
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