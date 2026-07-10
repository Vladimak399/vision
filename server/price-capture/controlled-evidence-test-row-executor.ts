import {
  buildControlledEvidenceTestRowPlan,
  COMPETITOR_SHELF_ITEMS_TABLE,
  PRICE_CAPTURE_RUNS_TABLE,
  type ControlledEvidenceTestRowPlan,
  type ControlledEvidenceTestRowPlanInput,
  type PriceCaptureRunInsertPayload,
} from "./controlled-evidence-test-row";
import type { CompetitorShelfItemInsertPayload } from "./evidence-persistence";
import {
  resolveSupabaseEvidenceWriteGuard,
  type SupabaseEvidenceWriteGuard,
} from "./supabase-evidence-repository";

export type ControlledEvidenceInsertResult = {
  data: { id?: string | null } | null;
  error: unknown | null;
};

export type ControlledEvidenceInsertQuery = {
  select(columns: "id"): {
    single(): Promise<ControlledEvidenceInsertResult>;
  };
};

export type ControlledEvidenceTableQuery<Payload> = {
  insert(payload: Payload): ControlledEvidenceInsertQuery;
};

export type ControlledEvidenceTestRowClient = {
  from(table: typeof PRICE_CAPTURE_RUNS_TABLE): ControlledEvidenceTableQuery<PriceCaptureRunInsertPayload>;
  from(table: typeof COMPETITOR_SHELF_ITEMS_TABLE): ControlledEvidenceTableQuery<CompetitorShelfItemInsertPayload>;
};

export type ControlledEvidenceTestRowExecutorOptions = {
  client: ControlledEvidenceTestRowClient;
  env?: Record<string, string | undefined> | null;
  execute?: boolean | null;
};

export type ControlledEvidenceTestRowExecutionResult = {
  ok: boolean;
  mode: "dry_run" | "execute";
  writeExecuted: boolean;
  plan: ControlledEvidenceTestRowPlan;
  guard: SupabaseEvidenceWriteGuard;
  inserted: {
    priceCaptureRunId: string | null;
    competitorShelfItemId: string | null;
  };
  error: string | null;
};

export async function executeControlledEvidenceTestRow(
  input: ControlledEvidenceTestRowPlanInput,
  options: ControlledEvidenceTestRowExecutorOptions,
): Promise<ControlledEvidenceTestRowExecutionResult> {
  const plan = buildControlledEvidenceTestRowPlan(input);
  const guard = resolveSupabaseEvidenceWriteGuard(options.env);
  const execute = options.execute === true;

  if (!execute) {
    return buildResult({ plan, guard, mode: "dry_run", writeExecuted: false });
  }

  if (!guard.writeEnabled) {
    return buildResult({
      plan,
      guard,
      mode: "execute",
      writeExecuted: false,
      error: guard.message,
    });
  }

  const runResponse = await options.client
    .from(PRICE_CAPTURE_RUNS_TABLE)
    .insert(plan.priceCaptureRunPayload)
    .select("id")
    .single();

  if (runResponse.error) {
    return buildResult({
      plan,
      guard,
      mode: "execute",
      writeExecuted: false,
      error: `price_capture_runs insert failed: ${formatSupabaseError(runResponse.error)}`,
    });
  }

  const runId = normalizeReturnedId(runResponse.data?.id);
  if (!runId) {
    return buildResult({
      plan,
      guard,
      mode: "execute",
      writeExecuted: false,
      error: "price_capture_runs insert did not return id",
    });
  }

  const evidenceResponse = await options.client
    .from(COMPETITOR_SHELF_ITEMS_TABLE)
    .insert(plan.evidencePayload)
    .select("id")
    .single();

  if (evidenceResponse.error) {
    return buildResult({
      plan,
      guard,
      mode: "execute",
      writeExecuted: true,
      inserted: { priceCaptureRunId: runId, competitorShelfItemId: null },
      error: `competitor_shelf_items insert failed: ${formatSupabaseError(evidenceResponse.error)}`,
    });
  }

  const evidenceId = normalizeReturnedId(evidenceResponse.data?.id);
  if (!evidenceId) {
    return buildResult({
      plan,
      guard,
      mode: "execute",
      writeExecuted: true,
      inserted: { priceCaptureRunId: runId, competitorShelfItemId: null },
      error: "competitor_shelf_items insert did not return id",
    });
  }

  return buildResult({
    plan,
    guard,
    mode: "execute",
    writeExecuted: true,
    inserted: { priceCaptureRunId: runId, competitorShelfItemId: evidenceId },
  });
}

function buildResult(input: {
  plan: ControlledEvidenceTestRowPlan;
  guard: SupabaseEvidenceWriteGuard;
  mode: "dry_run" | "execute";
  writeExecuted: boolean;
  inserted?: { priceCaptureRunId: string | null; competitorShelfItemId: string | null };
  error?: string | null;
}): ControlledEvidenceTestRowExecutionResult {
  const error = input.error ?? null;
  return {
    ok: error === null,
    mode: input.mode,
    writeExecuted: input.writeExecuted,
    plan: input.plan,
    guard: input.guard,
    inserted: input.inserted ?? { priceCaptureRunId: null, competitorShelfItemId: null },
    error,
  };
}

function normalizeReturnedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function formatSupabaseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
    if (typeof record.code === "string" && record.code.trim()) return record.code.trim();
  }
  return String(error);
}
