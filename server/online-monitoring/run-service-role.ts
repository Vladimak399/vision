/**
 * Worker Service-Role Run Boundary — TASK-31 / TASK-32
 *
 * Служебные операции с `online_source_runs`, которые вызываются ТОЛЬКО из
 * автономного worker-а (вне HTTP-контекста). Модуль использует service-role
 * клиент для обхода RLS и НЕ должен импортировать `createSupabaseServerClient`
 * / `cookies()` из `next/headers` — иначе worker упадёт вне request/response.
 *
 * Импортируется в `server/worker/online-monitoring-worker.ts` вместо
 * `server/online-monitoring/run.ts` (который заточен под HTTP-контекст UI).
 */

import { createSupabaseServiceRoleClient } from "../../lib/supabase/service-role";
import type { OnlineSourceRun } from "./types";

export type RunStats = {
  fetched: number;
  productsUpserted: number;
  pricesInserted: number;
  matched: number;
  unmatched: number;
  errors: number;
};

export const DEFAULT_RUN_LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 мин

const initialStats: RunStats = {
  fetched: 0,
  productsUpserted: 0,
  pricesInserted: 0,
  matched: 0,
  unmatched: 0,
  errors: 0,
};

/**
 * Service-role аналог `getRun` из `run.ts`.
 * Читает run вне HTTP-контекста (worker). НЕ использует серверный клиент.
 */
export async function getRunForWorker(
  runId: string
): Promise<OnlineSourceRun | null> {
  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("online_source_runs")
    .select("*")
    .eq("id", runId)
    .single();

  if (error) {
    return null;
  }

  return {
    id: data.id,
    companyId: data.company_id,
    sourceId: data.source_id,
    sourceStoreId: data.source_store_id,
    trigger: data.trigger,
    status: data.status,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    parserVersion: data.parser_version,
    stats: (data.stats as RunStats) ?? { ...initialStats },
    errorSummary: data.error_summary,
  };
}

/**
 * Чистая функция классификации «застрявшего» running run-а (TASK-32).
 *
 * - `ok`       — ещё в пределах lock-таймаута, трогать не надо
 * - `requeue`  — висит дольше lock-таймаута → вернуть в очередь
 * - `fail`     — висит дольше 2×lock-таймаута → пометить failed (requeue не помог)
 *
 * Выделена отдельно для юнит-тестирования без БД.
 */
export type StaleRunAction = "ok" | "requeue" | "fail";

export function classifyStaleRun(
  startedAt: string | null,
  now: number,
  lockTimeoutMs: number
): StaleRunAction {
  if (!startedAt) return "ok";

  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return "ok";

  const age = now - started;
  if (age >= lockTimeoutMs * 2) return "fail";
  if (age >= lockTimeoutMs) return "requeue";
  return "ok";
}

/**
 * Восстановление застрявших `running` run-ов (TASK-32, B6).
 *
 * Запускается на старте worker-а (и опционально периодически) и переводит
 * run-ы, зависшие в `running` из-за падения worker-а / потери сигнала, обратно
 * в очередь (`requeue`) или в `failed` после повторного таймаута.
 *
 * @returns количество requeued / failed run-ов
 */
export async function recoverStaleRuns(
  now: number = Date.now(),
  lockTimeoutMs: number = DEFAULT_RUN_LOCK_TIMEOUT_MS
): Promise<{ requeued: number; failed: number }> {
  const supabase = createSupabaseServiceRoleClient();

  // 1) Самые старые зависшие run-ы → failed (requeue уже не помог бы).
  const failCutoff = new Date(now - lockTimeoutMs * 2).toISOString();
  const { data: failed, error: failErr } = await supabase
    .from("online_source_runs")
    .update({
      status: "failed",
      completed_at: new Date(now).toISOString(),
      error_summary:
        "Stale run: stuck in 'running' beyond lock timeout (auto-recovered as failed)",
    })
    .eq("status", "running")
    .lt("started_at", failCutoff)
    .select("id");

  if (failErr) {
    console.error("recoverStaleRuns (fail) error:", failErr.message);
  }

  // 2) Остальные зависшие running → обратно в очередь на повтор.
  const requeueCutoff = new Date(now - lockTimeoutMs).toISOString();
  const { data: requeued, error: reqErr } = await supabase
    .from("online_source_runs")
    .update({ status: "queued", started_at: null })
    .eq("status", "running")
    .lt("started_at", requeueCutoff)
    .select("id");

  if (reqErr) {
    console.error("recoverStaleRuns (requeue) error:", reqErr.message);
  }

  const requeuedCount = requeued?.length ?? 0;
  const failedCount = failed?.length ?? 0;

  if (requeuedCount > 0 || failedCount > 0) {
    console.log(
      `recoverStaleRuns: requeued=${requeuedCount}, failed=${failedCount}`
    );
  }

  return { requeued: requeuedCount, failed: failedCount };
}
