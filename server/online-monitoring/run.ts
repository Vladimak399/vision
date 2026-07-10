/**
 * Run Management Module — TASK-21.3
 *
 * Управление запусками парсинга: stats и error collection.
 * Совместим с fixture-friendly parsing для тестов.
 */

import { createSupabaseServerClient } from "../../lib/supabase/server";
import type { OnlineSourceRun, OnlineSourceRunEvent } from "./types";

export type RunStats = {
  fetched: number;
  productsUpserted: number;
  pricesInserted: number;
  matched: number;
  unmatched: number;
  errors: number;
};

export type RunStatsInput = Partial<RunStats>;

const initialStats: RunStats = {
  fetched: 0,
  productsUpserted: 0,
  pricesInserted: 0,
  matched: 0,
  unmatched: 0,
  errors: 0,
};

/**
 * Run context для отслеживания статистики и ошибок.
 * Может использоваться как в продакшене (с записью в БД),
 * так и в тестах (fixture-friendly).
 */
export class RunContext {
  private runId: string;
  private stats: RunStats = { ...initialStats };
  private errorMessages: string[] = [];

  constructor(runId: string) {
    this.runId = runId;
  }

  get id(): string {
    return this.runId;
  }

  get currentStats(): RunStats {
    return { ...this.stats };
  }

  get currentErrors(): string[] {
    return [...this.errorMessages];
  }

  /**
   * Увеличить счётчик статистики.
   */
  inc(field: keyof RunStats, delta = 1): void {
    this.stats[field] += delta;
  }

  /**
   * Добавить ошибку в лог.
   */
  addError(message: string, metadata?: Record<string, unknown>): void {
    this.stats.errors += 1;
    this.errorMessages.push(message);

    // В продакшене записываем в БД
    if (process.env.NODE_ENV !== "test") {
      void this.logEvent("error", message, metadata);
    }
  }

  /**
   * Добавить предупреждение в лог.
   */
  addWarn(message: string, metadata?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== "test") {
      void this.logEvent("warn", message, metadata);
    }
  }

  /**
   * Добавить инфо-сообщение в лог.
   */
  addInfo(message: string, metadata?: Record<string, unknown>): void {
    if (process.env.NODE_ENV !== "test") {
      void this.logEvent("info", message, metadata);
    }
  }

  /**
   * Записать событие в БД.
   */
  private async logEvent(
    level: "info" | "warn" | "error",
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const supabase = await createSupabaseServerClient();

    await supabase.from("online_source_run_events").insert({
      run_id: this.runId,
      level,
      message,
      metadata: metadata ?? {},
    });
  }

  /**
   * Завершить run и записать финальные stats в БД.
   */
  async complete(status: "succeeded" | "failed" | "cancelled"): Promise<void> {
    const supabase = await createSupabaseServerClient();

    await supabase
      .from("online_source_runs")
      .update({
        status,
        completed_at: new Date().toISOString(),
        stats: this.stats,
      })
      .eq("id", this.runId);
  }
}

/**
 * Create a new run in the database.
 * Returns run ID for subsequent operations.
 */
export async function createRun(
  companyId: string,
  sourceId: string,
  sourceStoreId: string | null,
  trigger: "cron" | "manual" | "retry" = "manual",
  parserVersion: string = "1.0.0"
): Promise<string> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("online_source_runs")
    .insert({
      company_id: companyId,
      source_id: sourceId,
      source_store_id: sourceStoreId,
      trigger,
      status: "queued",
      parser_version: parserVersion,
      stats: initialStats,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Не удалось создать run: ${error.message}`);
  }

  return data.id;
}

/**
 * Claim a queued run for processing.
 * Atomic status change: queued -> running.
 */
export async function claimRun(runId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("claim_online_source_run", {
    run_id: runId,
  });

  if (error) {
    // RPC может не существовать, тогда fallback к прямому UPDATE с проверкой
    const { data: updated, error: updateError } = await supabase
      .from("online_source_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("status", "queued")
      .select("id")
      .single();

    if (updateError || !updated) {
      return false;
    }
    return true;
  }

  return data === true;
}

/**
 * Get run by ID with stats.
 */
export async function getRun(runId: string): Promise<OnlineSourceRun | null> {
  const supabase = await createSupabaseServerClient();

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
    stats: data.stats as RunStats,
    errorSummary: data.error_summary,
  };
}

/**
 * Get events for a run.
 */
export async function getRunEvents(runId: string): Promise<OnlineSourceRunEvent[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("online_source_run_events")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    return [];
  }

  return data.map((e) => ({
    id: e.id,
    companyId: e.company_id,
    runId: e.run_id,
    level: e.level,
    message: e.message,
    metadata: e.metadata,
    createdAt: e.created_at,
  }));
}