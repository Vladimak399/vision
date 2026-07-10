import {
  buildCompetitorShelfItemInsertPayload,
  COMPETITOR_SHELF_ITEMS_TABLE,
  type CompetitorShelfItemInsertPayload,
} from "./evidence-persistence";
import type { EvidenceWriter, EvidenceWriterInput, EvidenceWriteResult } from "./local-pipeline";

export const SUPABASE_EVIDENCE_WRITE_MODE_ENV = "PRICEVISION_EVIDENCE_PERSISTENCE_MODE" as const;
export const SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV = "PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM" as const;
export const SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE = "YES_I_UNDERSTAND_THIS_WRITES_EVIDENCE" as const;
export const SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV = "PRICEVISION_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM" as const;
export const SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE = "YES_I_UNDERSTAND_THIS_INSERTS_ONE_TEST_ROW" as const;

export type SupabaseEvidenceWriteGuardReason =
  | "mode_not_write"
  | "missing_write_confirmation"
  | "missing_controlled_test_row_confirmation"
  | "write_enabled";

export type SupabaseEvidenceWriteGuard =
  | {
      writeEnabled: false;
      reason: Exclude<SupabaseEvidenceWriteGuardReason, "write_enabled">;
      message: string;
      mode: string | null;
      confirmationPresent: boolean;
      controlledTestRowConfirmationPresent: boolean;
    }
  | {
      writeEnabled: true;
      reason: "write_enabled";
      message: string;
      mode: "write";
      confirmationPresent: true;
      controlledTestRowConfirmationPresent: true;
    };

export type SupabaseEvidenceInsertResult = {
  data: { id?: string | null } | null;
  error: unknown | null;
};

export type SupabaseEvidenceInsertQuery = {
  select(columns: "id"): {
    single(): Promise<SupabaseEvidenceInsertResult>;
  };
};

export type SupabaseEvidenceTableQuery = {
  insert(payload: CompetitorShelfItemInsertPayload): SupabaseEvidenceInsertQuery;
};

export type SupabaseEvidenceClient = {
  from(table: typeof COMPETITOR_SHELF_ITEMS_TABLE): SupabaseEvidenceTableQuery;
};

export type SupabaseEvidenceRepositoryOptions = {
  client: SupabaseEvidenceClient;
  env?: Record<string, string | undefined> | null;
  matchedAt?: string | null;
};

export type SupabaseEvidenceRepositoryWriteResult = EvidenceWriteResult & {
  writeEnabled: boolean;
  guard: SupabaseEvidenceWriteGuard;
  table: typeof COMPETITOR_SHELF_ITEMS_TABLE;
};

export function resolveSupabaseEvidenceWriteGuard(
  env: Record<string, string | undefined> | null | undefined = process.env,
): SupabaseEvidenceWriteGuard {
  const mode = normalizeEnv(env?.[SUPABASE_EVIDENCE_WRITE_MODE_ENV]);
  const confirmation = normalizeEnv(env?.[SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV]);
  const controlledTestRowConfirmation = normalizeEnv(env?.[SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV]);
  const confirmationPresent = confirmation === SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE;
  const controlledTestRowConfirmationPresent = controlledTestRowConfirmation === SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE;

  if (mode !== "write") {
    return {
      writeEnabled: false,
      reason: "mode_not_write",
      message: `${SUPABASE_EVIDENCE_WRITE_MODE_ENV}=write is required before competitor shelf item evidence can be inserted.`,
      mode,
      confirmationPresent,
      controlledTestRowConfirmationPresent,
    };
  }

  if (!confirmationPresent) {
    return {
      writeEnabled: false,
      reason: "missing_write_confirmation",
      message: `${SUPABASE_EVIDENCE_WRITE_CONFIRM_ENV}=${SUPABASE_EVIDENCE_WRITE_CONFIRM_VALUE} is required before competitor shelf item evidence can be inserted.`,
      mode,
      confirmationPresent: false,
      controlledTestRowConfirmationPresent,
    };
  }

  if (!controlledTestRowConfirmationPresent) {
    return {
      writeEnabled: false,
      reason: "missing_controlled_test_row_confirmation",
      message: `${SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_ENV}=${SUPABASE_EVIDENCE_CONTROLLED_TEST_ROW_CONFIRM_VALUE} is required before inserting the first controlled evidence test row.`,
      mode,
      confirmationPresent: true,
      controlledTestRowConfirmationPresent: false,
    };
  }

  return {
    writeEnabled: true,
    reason: "write_enabled",
    message: "Supabase evidence writes are explicitly enabled for this controlled test-row process.",
    mode: "write",
    confirmationPresent: true,
    controlledTestRowConfirmationPresent: true,
  };
}

export function createSupabaseEvidenceRepository(
  options: SupabaseEvidenceRepositoryOptions,
): EvidenceWriter {
  return new SupabaseEvidenceRepository(options);
}

export class SupabaseEvidenceRepository implements EvidenceWriter {
  private readonly client: SupabaseEvidenceClient;
  private readonly env: Record<string, string | undefined> | null | undefined;
  private readonly matchedAt: string | null;

  constructor(options: SupabaseEvidenceRepositoryOptions) {
    this.client = options.client;
    this.env = options.env;
    this.matchedAt = options.matchedAt ?? null;
  }

  async write(input: EvidenceWriterInput): Promise<SupabaseEvidenceRepositoryWriteResult> {
    const payload = buildCompetitorShelfItemInsertPayload({
      draft: input.draft,
      match: input.match,
      matchedAt: this.matchedAt,
    });
    const guard = resolveSupabaseEvidenceWriteGuard(this.env);

    if (!guard.writeEnabled) {
      return buildWriteResult({ input, payload, rowId: null, guard });
    }

    const response = await this.client
      .from(COMPETITOR_SHELF_ITEMS_TABLE)
      .insert(payload)
      .select("id")
      .single();

    if (response.error) {
      throw new Error(`Supabase evidence insert failed: ${formatSupabaseError(response.error)}`);
    }

    const rowId = normalizeRowId(response.data?.id);
    if (!rowId) {
      throw new Error("Supabase evidence insert did not return a row id.");
    }

    return buildWriteResult({ input, payload, rowId, guard });
  }
}

function buildWriteResult(input: {
  input: EvidenceWriterInput;
  payload: CompetitorShelfItemInsertPayload;
  rowId: string | null;
  guard: SupabaseEvidenceWriteGuard;
}): SupabaseEvidenceRepositoryWriteResult {
  return {
    itemId: input.input.draft.itemId,
    rowId: input.rowId,
    cropStoragePath: input.payload.crop_storage_path,
    reviewRequired: input.input.match?.reviewRequired ?? true,
    writeEnabled: input.guard.writeEnabled,
    guard: input.guard,
    table: COMPETITOR_SHELF_ITEMS_TABLE,
  };
}

function normalizeEnv(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeRowId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function formatSupabaseError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    const code = record.code;
    if (typeof code === "string" && code.trim()) return code.trim();
  }
  return String(error);
}
