import {
  buildControlledEvidenceTestRowCleanupInstruction,
  COMPETITOR_SHELF_ITEMS_TABLE,
  CONTROLLED_TEST_ROW_MARKER_PREFIX,
  PRICE_CAPTURE_RUNS_TABLE,
  type ControlledEvidenceTestRowCleanupInstruction,
} from "./controlled-evidence-test-row";

export type ControlledEvidenceCleanupResult = {
  data: unknown;
  error: unknown | null;
};

export type ControlledEvidenceCleanupFilterQuery = {
  eq(column: string, value: string): ControlledEvidenceCleanupFilterQuery;
  like(column: string, value: string): ControlledEvidenceCleanupFilterQuery;
  select(columns: "id"): Promise<ControlledEvidenceCleanupResult>;
};

export type ControlledEvidenceCleanupTableQuery = {
  delete(): ControlledEvidenceCleanupFilterQuery;
};

export type ControlledEvidenceTestRowCleanupClient = {
  from(table: typeof COMPETITOR_SHELF_ITEMS_TABLE | typeof PRICE_CAPTURE_RUNS_TABLE): ControlledEvidenceCleanupTableQuery;
};

export type ControlledEvidenceTestRowCleanupInput = {
  marker: string;
  runId: string;
};

export type ControlledEvidenceTestRowCleanupOptions = {
  client: ControlledEvidenceTestRowCleanupClient;
  execute?: boolean | null;
};

export type ControlledEvidenceTestRowCleanupResult = {
  ok: boolean;
  mode: "dry_run" | "execute";
  cleanupExecuted: boolean;
  instruction: ControlledEvidenceTestRowCleanupInstruction;
  deleted: {
    competitorShelfItems: unknown;
    priceCaptureRuns: unknown;
  };
  error: string | null;
};

export async function cleanupControlledEvidenceTestRow(
  input: ControlledEvidenceTestRowCleanupInput,
  options: ControlledEvidenceTestRowCleanupOptions,
): Promise<ControlledEvidenceTestRowCleanupResult> {
  const marker = requireControlledMarker(input.marker);
  const runId = requireUuid(input.runId, "runId");
  const instruction = buildControlledEvidenceTestRowCleanupInstruction({ marker, runId });

  if (options.execute !== true) {
    return buildCleanupResult({ instruction, mode: "dry_run", cleanupExecuted: false });
  }

  const evidenceResponse = await options.client
    .from(COMPETITOR_SHELF_ITEMS_TABLE)
    .delete()
    .eq("processing_run_id", instruction.evidenceWhere.processing_run_id)
    .like("raw_name", `${instruction.evidenceWhere.raw_name_starts_with}%`)
    .select("id");

  if (evidenceResponse.error) {
    return buildCleanupResult({
      instruction,
      mode: "execute",
      cleanupExecuted: true,
      error: `competitor_shelf_items cleanup failed: ${formatSupabaseError(evidenceResponse.error)}`,
    });
  }

  const runResponse = await options.client
    .from(PRICE_CAPTURE_RUNS_TABLE)
    .delete()
    .eq("id", instruction.runWhere.id)
    .eq("photo_filename", instruction.runWhere.photo_filename)
    .select("id");

  if (runResponse.error) {
    return buildCleanupResult({
      instruction,
      mode: "execute",
      cleanupExecuted: true,
      deleted: { competitorShelfItems: evidenceResponse.data, priceCaptureRuns: null },
      error: `price_capture_runs cleanup failed: ${formatSupabaseError(runResponse.error)}`,
    });
  }

  return buildCleanupResult({
    instruction,
    mode: "execute",
    cleanupExecuted: true,
    deleted: { competitorShelfItems: evidenceResponse.data, priceCaptureRuns: runResponse.data },
  });
}

function buildCleanupResult(input: {
  instruction: ControlledEvidenceTestRowCleanupInstruction;
  mode: "dry_run" | "execute";
  cleanupExecuted: boolean;
  deleted?: { competitorShelfItems: unknown; priceCaptureRuns: unknown };
  error?: string | null;
}): ControlledEvidenceTestRowCleanupResult {
  const error = input.error ?? null;
  return {
    ok: error === null,
    mode: input.mode,
    cleanupExecuted: input.cleanupExecuted,
    instruction: input.instruction,
    deleted: input.deleted ?? { competitorShelfItems: null, priceCaptureRuns: null },
    error,
  };
}

function requireControlledMarker(value: string): string {
  const normalized = value.trim();
  if (!normalized.startsWith(CONTROLLED_TEST_ROW_MARKER_PREFIX)) {
    throw new Error(`marker must start with ${CONTROLLED_TEST_ROW_MARKER_PREFIX}.`);
  }
  return normalized;
}

function requireUuid(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${fieldName} must be a UUID.`);
  }
  return normalized;
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
