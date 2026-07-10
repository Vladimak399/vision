/**
 * Alerts Module — TASK-21.10
 *
 * Правила алертов и генерация алертов для онлайн-мониторинга.
 * Проверяет: изменение цены, конкурент дешевле, товар пропал, падение source runs.
 * Email/Telegram — отдельная задача, здесь только сохранение в БД.
 */

import { createSupabaseServerClient } from "../../lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolve the Supabase client to use.
 * In request context (UI) callers omit `supabase` and we fall back to the
 * cookie-authenticated server client. In background jobs (worker) there is no
 * user session, so the caller must pass a service-role client to bypass RLS.
 */
async function resolveClient(supabase?: SupabaseClient): Promise<SupabaseClient> {
  if (supabase) return supabase;
  return createSupabaseServerClient();
}

// ── Types ──────────────────────────────────────────────────────────────

export type AlertType = "competitor_cheaper" | "price_change" | "out_of_stock" | "run_failure";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertStatus = "new" | "ack" | "resolved";

export type AlertRule = {
  id: string;
  companyId: string;
  sourceId: string | null;
  name: string;
  alertType: AlertType;
  threshold: number;
  enabled: boolean;
  config: Record<string, unknown> | null;
};

export type Alert = {
  id: string;
  companyId: string;
  ruleId: string | null;
  sourceId: string | null;
  runId: string | null;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  status: AlertStatus;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  triggeredAt: string;
};

// ── Reading alerts ──────────────────────────────────────────────────────

/**
 * Get alerts for the current company, optionally filtered by status.
 */
export async function getAlerts(
  companyId: string,
  options?: { status?: AlertStatus; limit?: number }
): Promise<Alert[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("online_price_alerts")
    .select("*")
    .eq("company_id", companyId)
    .order("triggered_at", { ascending: false });

  if (options?.status) {
    query = query.eq("status", options.status);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  } else {
    query = query.limit(200);
  }

  const { data, error } = await query;
  if (error) return [];

  return (data ?? []).map(mapAlertRow);
}

/**
 * Count new (unacknowledged) alerts for badge display.
 */
export async function getNewAlertCount(companyId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();

  const { count, error } = await supabase
    .from("online_price_alerts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "new");

  if (error) return 0;
  return count ?? 0;
}

/**
 * Get alert rules for the current company.
 */
export async function getAlertRules(companyId: string): Promise<AlertRule[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("online_price_alert_rules")
    .select("*")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (error) return [];

  return (data ?? []).map(mapRuleRow);
}

// ── Mutating alerts ────────────────────────────────────────────────────

/**
 * Acknowledge an alert (user has seen it).
 */
export async function acknowledgeAlert(alertId: string, companyId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("online_price_alerts")
    .update({ status: "ack", acknowledged_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("company_id", companyId);

  return !error;
}

/**
 * Resolve an alert.
 */
export async function resolveAlert(alertId: string, companyId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("online_price_alerts")
    .update({ status: "resolved", resolved_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("company_id", companyId);

  return !error;
}

/**
 * Acknowledge all new alerts for the company.
 */
export async function acknowledgeAllAlerts(companyId: string): Promise<number> {
  const supabase = await createSupabaseServerClient();

  // First count how many will be updated
  const { count: beforeCount } = await supabase
    .from("online_price_alerts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "new");

  const { error } = await supabase
    .from("online_price_alerts")
    .update({ status: "ack", acknowledged_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("status", "new");

  if (error) return 0;
  return beforeCount ?? 0;
}

// ── Alert generation (called after runs, price inserts, etc.) ──────────

export type GenerateAlertsInput = {
  companyId: string;
  sourceId: string;
  runId: string | null;
};

/**
 * Check alert rules and generate alerts after a source run.
 *
 * Currently checks:
 * - run_failure: if the run status is "failed" and threshold consecutive failures detected.
 */
export async function generateRunAlerts(
  input: GenerateAlertsInput,
  supabase?: SupabaseClient
): Promise<void> {
  const client = await resolveClient(supabase);

  // Load enabled run_failure rules for this source
  const { data: rules } = await client
    .from("online_price_alert_rules")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("alert_type", "run_failure")
    .eq("enabled", true);

  if (!rules || rules.length === 0) return;

  // Get the run that just completed
  const { data: currentRun } = await client
    .from("online_source_runs")
    .select("status, started_at")
    .eq("id", input.runId)
    .single();

  if (!currentRun || currentRun.status !== "failed") return;

  // Check consecutive failures for this source
  const { data: recentRuns } = await client
    .from("online_source_runs")
    .select("id, status")
    .eq("company_id", input.companyId)
    .eq("source_id", input.sourceId)
    .order("started_at", { ascending: false })
    .limit(10);

  if (!recentRuns) return;

  const consecutiveFailures = countConsecutiveFailures(recentRuns);

  for (const rule of rules) {
    const threshold = Number(rule.threshold);
    if (consecutiveFailures >= threshold) {
      // Check if we already have an alert for this consecutive failure count
      const { data: existingAlerts } = await client
        .from("online_price_alerts")
        .select("id")
        .eq("company_id", input.companyId)
        .eq("source_id", input.sourceId)
        .eq("alert_type", "run_failure")
        .eq("status", "new")
        .limit(1);

      if (existingAlerts && existingAlerts.length > 0) {
        // Already have an open alert, skip duplicate
        continue;
      }

      await client.from("online_price_alerts").insert({
        company_id: input.companyId,
        rule_id: rule.id,
        source_id: input.sourceId,
        run_id: input.runId,
        alert_type: "run_failure",
        severity: consecutiveFailures >= threshold * 2 ? "critical" : "warning",
        title: `Источник падает ${consecutiveFailures} раз подряд`,
        description: `Последние ${consecutiveFailures} запусков завершены с ошибкой. Порог: ${threshold}. Проверьте подключение и парсер.`,
        metadata: { consecutive_failures: consecutiveFailures, threshold },
      });
    }
  }
}

/**
 * Generate price change alerts after new prices are inserted.
 * Compares latest price with previous price for same (source_product_id, store).
 */
export async function generatePriceChangeAlerts(
  companyId: string,
  sourceId: string,
  sourceProductId: string,
  storeId: string,
  currentPriceMinor: number,
  previousPriceMinor: number | null,
  supabase?: SupabaseClient
): Promise<void> {
  const client = await resolveClient(supabase);

  // Load enabled price_change rules
  const { data: rules } = await client
    .from("online_price_alert_rules")
    .select("*")
    .eq("company_id", companyId)
    .eq("alert_type", "price_change")
    .eq("enabled", true);

  if (!rules || rules.length === 0) return;
  if (previousPriceMinor === null || previousPriceMinor === 0) return;

  const priceChangePercent = Math.abs(
    ((currentPriceMinor - previousPriceMinor) / previousPriceMinor) * 100
  );

  for (const rule of rules) {
    // Rule can be scoped to a specific source
    if (rule.source_id && rule.source_id !== sourceId) continue;

    const threshold = Number(rule.threshold);
    if (priceChangePercent < threshold) continue;

    await client.from("online_price_alerts").insert({
      company_id: companyId,
      rule_id: rule.id,
      source_id: sourceId,
      alert_type: "price_change",
      severity: priceChangePercent >= threshold * 2 ? "critical" : "warning",
      title: `Цена изменилась на ${priceChangePercent.toFixed(1)}%`,
      description: `Предыдущая: ${(previousPriceMinor / 100).toFixed(2)} ₽, текущая: ${(currentPriceMinor / 100).toFixed(2)} ₽. Порог: ${threshold}%.`,
      metadata: {
        source_product_id: sourceProductId,
        store_id: storeId,
        previous_price_minor: previousPriceMinor,
        current_price_minor: currentPriceMinor,
        change_percent: priceChangePercent,
      },
    });
  }
}

/**
 * Generate out_of_stock alert when a previously available product is now out of stock.
 */
export async function generateOutOfStockAlert(
  companyId: string,
  sourceId: string,
  sourceProductId: string,
  productName: string | null,
  supabase?: SupabaseClient
): Promise<void> {
  const client = await resolveClient(supabase);

  const { data: rules } = await client
    .from("online_price_alert_rules")
    .select("*")
    .eq("company_id", companyId)
    .eq("alert_type", "out_of_stock")
    .eq("enabled", true);

  if (!rules || rules.length === 0) return;

  await client.from("online_price_alerts").insert({
    company_id: companyId,
    rule_id: rules[0].id,
    source_id: sourceId,
    alert_type: "out_of_stock",
    severity: "info",
    title: `Товар отсутствует: ${productName ?? sourceProductId}`,
    description: `Товар больше не доступен в онлайн-каталоге. Ранее был в наличии.`,
    metadata: { source_product_id: sourceProductId },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

function countConsecutiveFailures(
  runs: Array<{ id: string; status: string }>
): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "failed") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function mapAlertRow(row: Record<string, unknown>): Alert {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    ruleId: (row.rule_id as string) ?? null,
    sourceId: (row.source_id as string) ?? null,
    runId: (row.run_id as string) ?? null,
    alertType: row.alert_type as AlertType,
    severity: row.severity as AlertSeverity,
    title: row.title as string,
    description: (row.description as string) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    status: row.status as AlertStatus,
    acknowledgedAt: (row.acknowledged_at as string) ?? null,
    resolvedAt: (row.resolved_at as string) ?? null,
    triggeredAt: row.triggered_at as string,
  };
}

function mapRuleRow(row: Record<string, unknown>): AlertRule {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    sourceId: (row.source_id as string) ?? null,
    name: row.name as string,
    alertType: row.alert_type as AlertType,
    threshold: Number(row.threshold),
    enabled: row.enabled as boolean,
    config: (row.config as Record<string, unknown>) ?? null,
  };
}
