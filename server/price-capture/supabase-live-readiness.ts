import {
  EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS,
  EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS,
} from "./supabase-schema-status";
import {
  resolveSupabaseEvidenceWriteGuard,
  type SupabaseEvidenceWriteGuard,
} from "./supabase-evidence-repository";

export const LIVE_COMPETITOR_SHELF_ITEMS_TABLE = "competitor_shelf_items" as const;
export const LIVE_PRICE_CAPTURE_RUNS_TABLE = "price_capture_runs" as const;

export type SupabaseLiveReadinessSelectResponse = {
  data?: unknown;
  error: unknown | null;
};

export type SupabaseLiveReadinessSelectQuery = {
  limit(count: 0): Promise<SupabaseLiveReadinessSelectResponse>;
};

export type SupabaseLiveReadinessTableQuery = {
  select(columns: string, options?: { head?: boolean; count?: "exact" }): SupabaseLiveReadinessSelectQuery;
};

export type SupabaseLiveReadinessClient = {
  from(table: string): SupabaseLiveReadinessTableQuery;
};

export type SupabaseLiveTableProbeResult = {
  table: typeof LIVE_COMPETITOR_SHELF_ITEMS_TABLE | typeof LIVE_PRICE_CAPTURE_RUNS_TABLE;
  ok: boolean;
  checkedColumnCount: number;
  checkedColumns: string[];
  error: string | null;
};

export type SupabaseLiveSchemaReadinessReport = {
  status: "ready" | "migration_required";
  checks: SupabaseLiveTableProbeResult[];
  blockers: string[];
};

export type SupabaseEvidenceWriteReadinessReport = {
  schema: SupabaseLiveSchemaReadinessReport;
  guard: SupabaseEvidenceWriteGuard;
  canAttemptControlledTestInsert: boolean;
  blockers: string[];
};

export async function checkLiveSupabaseEvidenceSchema(
  client: SupabaseLiveReadinessClient,
): Promise<SupabaseLiveSchemaReadinessReport> {
  const checks = await Promise.all([
    probeTableColumns({
      client,
      table: LIVE_COMPETITOR_SHELF_ITEMS_TABLE,
      columns: ["id", ...EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS.map((column) => column.name)],
    }),
    probeTableColumns({
      client,
      table: LIVE_PRICE_CAPTURE_RUNS_TABLE,
      columns: EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS.map((column) => column.name),
    }),
  ]);
  const blockers = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.table} readiness probe failed: ${check.error ?? "unknown error"}`);

  return {
    status: blockers.length === 0 ? "ready" : "migration_required",
    checks,
    blockers,
  };
}

export function buildSupabaseEvidenceWriteReadinessReport(input: {
  schema: SupabaseLiveSchemaReadinessReport;
  env?: Record<string, string | undefined> | null;
}): SupabaseEvidenceWriteReadinessReport {
  const guard = resolveSupabaseEvidenceWriteGuard(input.env);
  const blockers = [
    ...input.schema.blockers,
    ...(guard.writeEnabled ? [] : [guard.message]),
  ];

  return {
    schema: input.schema,
    guard,
    canAttemptControlledTestInsert: input.schema.status === "ready" && guard.writeEnabled,
    blockers,
  };
}

async function probeTableColumns(input: {
  client: SupabaseLiveReadinessClient;
  table: typeof LIVE_COMPETITOR_SHELF_ITEMS_TABLE | typeof LIVE_PRICE_CAPTURE_RUNS_TABLE;
  columns: string[];
}): Promise<SupabaseLiveTableProbeResult> {
  const checkedColumns = dedupeColumns(input.columns);

  try {
    const response = await input.client
      .from(input.table)
      .select(checkedColumns.join(","), { head: true, count: "exact" })
      .limit(0);

    if (response.error) {
      return {
        table: input.table,
        ok: false,
        checkedColumnCount: checkedColumns.length,
        checkedColumns,
        error: formatSupabaseError(response.error),
      };
    }

    return {
      table: input.table,
      ok: true,
      checkedColumnCount: checkedColumns.length,
      checkedColumns,
      error: null,
    };
  } catch (error) {
    return {
      table: input.table,
      ok: false,
      checkedColumnCount: checkedColumns.length,
      checkedColumns,
      error: formatSupabaseError(error),
    };
  }
}

function dedupeColumns(columns: string[]): string[] {
  return [...new Set(columns.map((column) => column.trim()).filter(Boolean))];
}

function formatSupabaseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    const code = record.code;
    if (typeof code === "string" && code.trim()) return code.trim();
    const details = record.details;
    if (typeof details === "string" && details.trim()) return details.trim();
  }
  return String(error);
}
