/**
 * Claim Run Module — TASK-21.5
 *
 * Атомарный claim run'а для worker'а.
 * Переводит статус с queued → running.
 * Использует RPC функцию или fallback к UPDATE с проверкой.
 */

import { createSupabaseServiceRoleClient } from "../../lib/supabase/service-role";

/**
 * Claim a queued run for processing.
 * Atomic status change: queued -> running.
 *
 * @param runId ID запуска для claim
 * @returns true если успешно claim-нуто, false если уже обрабатывается
 */
export async function claimRun(runId: string): Promise<boolean> {
  const supabase = createSupabaseServiceRoleClient();

  // Try RPC first (requires claim_online_source_run function in DB)
  try {
    const { data, error } = await supabase.rpc("claim_online_source_run", {
      run_id: runId,
    });

    if (!error && data !== null) {
      return data === true;
    }
  } catch {
    // RPC не существует, используем fallback
  }

  // Fallback: атомарный UPDATE с проверкой статуса
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