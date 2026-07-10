export type SupabaseSchemaColumnSnapshot = {
  name: string;
  data_type?: string | null;
  format?: string | null;
  options?: readonly string[] | null;
  default_value?: string | null;
};

export type SupabaseForeignKeySnapshot = {
  name: string;
  source?: string | null;
  target?: string | null;
};

export type SupabaseTableSnapshot = {
  name: string;
  rls_enabled?: boolean | null;
  rows?: number | null;
  columns?: readonly SupabaseSchemaColumnSnapshot[] | null;
  foreign_key_constraints?: readonly SupabaseForeignKeySnapshot[] | null;
};

export type SupabaseSecurityAdvisorySnapshot = {
  name: string;
  level?: string | null;
  title?: string | null;
  detail?: string | null;
  metadata?: {
    schema?: string | null;
    name?: string | null;
    type?: string | null;
    [key: string]: unknown;
  } | null;
};

export type ExpectedSupabaseColumn = {
  name: string;
  type: string;
  requiredFor: "evidence" | "processing_run";
};

export const COMPETITOR_SHELF_ITEMS_TABLE_NAME = "public.competitor_shelf_items" as const;
export const PRICE_CAPTURE_RUNS_TABLE_NAME = "public.price_capture_runs" as const;

export const EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS: readonly ExpectedSupabaseColumn[] = [
  { name: "bbox", type: "jsonb", requiredFor: "evidence" },
  { name: "crop_storage_path", type: "text", requiredFor: "evidence" },
  { name: "crop_width", type: "integer", requiredFor: "evidence" },
  { name: "crop_height", type: "integer", requiredFor: "evidence" },
  { name: "detector_provider", type: "text", requiredFor: "evidence" },
  { name: "detector_model", type: "text", requiredFor: "evidence" },
  { name: "detector_confidence", type: "numeric(5,4)", requiredFor: "evidence" },
  { name: "ocr_provider", type: "text", requiredFor: "evidence" },
  { name: "ocr_model", type: "text", requiredFor: "evidence" },
  { name: "ocr_text", type: "text", requiredFor: "evidence" },
  { name: "ocr_confidence", type: "numeric(5,4)", requiredFor: "evidence" },
  { name: "parsed_price_confidence", type: "numeric(5,4)", requiredFor: "evidence" },
  { name: "normalized_product_text", type: "text", requiredFor: "evidence" },
  { name: "review_status", type: "text", requiredFor: "evidence" },
  { name: "review_reason", type: "text", requiredFor: "evidence" },
  { name: "ai_used", type: "boolean", requiredFor: "evidence" },
  { name: "ai_reason", type: "text", requiredFor: "evidence" },
  { name: "ai_provider", type: "text", requiredFor: "evidence" },
  { name: "ai_model", type: "text", requiredFor: "evidence" },
  { name: "ai_cost_microusd", type: "bigint", requiredFor: "evidence" },
  { name: "processing_run_id", type: "uuid", requiredFor: "processing_run" },
] as const;

export const EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS: readonly ExpectedSupabaseColumn[] = [
  { name: "id", type: "uuid", requiredFor: "processing_run" },
  { name: "company_id", type: "uuid", requiredFor: "processing_run" },
  { name: "store_id", type: "uuid", requiredFor: "processing_run" },
  { name: "week", type: "smallint", requiredFor: "processing_run" },
  { name: "photo_storage_path", type: "text", requiredFor: "processing_run" },
  { name: "photo_filename", type: "text", requiredFor: "processing_run" },
  { name: "photo_sha256", type: "text", requiredFor: "processing_run" },
  { name: "status", type: "text", requiredFor: "processing_run" },
  { name: "error_message", type: "text", requiredFor: "processing_run" },
  { name: "started_at", type: "timestamptz", requiredFor: "processing_run" },
  { name: "finished_at", type: "timestamptz", requiredFor: "processing_run" },
  { name: "duration_ms", type: "bigint", requiredFor: "processing_run" },
  { name: "detected_count", type: "integer", requiredFor: "processing_run" },
  { name: "crop_count", type: "integer", requiredFor: "processing_run" },
  { name: "ocr_success_count", type: "integer", requiredFor: "processing_run" },
  { name: "parsed_price_count", type: "integer", requiredFor: "processing_run" },
  { name: "auto_matched_count", type: "integer", requiredFor: "processing_run" },
  { name: "needs_review_count", type: "integer", requiredFor: "processing_run" },
  { name: "unmatched_count", type: "integer", requiredFor: "processing_run" },
  { name: "ai_calls_count", type: "integer", requiredFor: "processing_run" },
  { name: "ai_cost_microusd", type: "bigint", requiredFor: "processing_run" },
  { name: "created_at", type: "timestamptz", requiredFor: "processing_run" },
  { name: "updated_at", type: "timestamptz", requiredFor: "processing_run" },
] as const;

export type TableColumnStatus = {
  tableName: string;
  exists: boolean;
  rlsEnabled: boolean | null;
  expectedColumnCount: number;
  presentColumnNames: string[];
  missingColumnNames: string[];
  unexpectedColumnNames: string[];
};

export type PriceVisionSupabaseSchemaStatus = {
  status: "ready" | "migration_required";
  competitorShelfItems: TableColumnStatus;
  priceCaptureRuns: TableColumnStatus;
  blockers: string[];
  securityFindings: string[];
};

export function buildTableColumnStatus(input: {
  tableName: string;
  table: SupabaseTableSnapshot | null | undefined;
  expectedColumns: readonly ExpectedSupabaseColumn[];
}): TableColumnStatus {
  const actualNames = new Set(normalizeColumnNames(input.table?.columns));
  const expectedNames = input.expectedColumns.map((column) => column.name);
  const expectedNameSet = new Set(expectedNames);

  return {
    tableName: input.tableName,
    exists: Boolean(input.table),
    rlsEnabled: typeof input.table?.rls_enabled === "boolean" ? input.table.rls_enabled : null,
    expectedColumnCount: expectedNames.length,
    presentColumnNames: expectedNames.filter((name) => actualNames.has(name)),
    missingColumnNames: expectedNames.filter((name) => !actualNames.has(name)),
    unexpectedColumnNames: [...actualNames]
      .filter((name) => !expectedNameSet.has(name))
      .sort(),
  };
}

export function buildPriceVisionSupabaseSchemaStatus(input: {
  competitorShelfItems?: SupabaseTableSnapshot | null;
  priceCaptureRuns?: SupabaseTableSnapshot | null;
  securityAdvisories?: readonly SupabaseSecurityAdvisorySnapshot[] | null;
}): PriceVisionSupabaseSchemaStatus {
  const competitorShelfItems = buildTableColumnStatus({
    tableName: COMPETITOR_SHELF_ITEMS_TABLE_NAME,
    table: input.competitorShelfItems ?? null,
    expectedColumns: EXPECTED_COMPETITOR_SHELF_ITEM_EVIDENCE_COLUMNS,
  });
  const priceCaptureRuns = buildTableColumnStatus({
    tableName: PRICE_CAPTURE_RUNS_TABLE_NAME,
    table: input.priceCaptureRuns ?? null,
    expectedColumns: EXPECTED_PRICE_CAPTURE_RUNS_COLUMNS,
  });
  const securityFindings = buildSecurityFindings(input.securityAdvisories ?? []);
  const blockers = buildBlockers({ competitorShelfItems, priceCaptureRuns, securityFindings });

  return {
    status: blockers.length === 0 ? "ready" : "migration_required",
    competitorShelfItems,
    priceCaptureRuns,
    blockers,
    securityFindings,
  };
}

function buildBlockers(input: {
  competitorShelfItems: TableColumnStatus;
  priceCaptureRuns: TableColumnStatus;
  securityFindings: string[];
}): string[] {
  const blockers: string[] = [];

  if (!input.competitorShelfItems.exists) {
    blockers.push(`${COMPETITOR_SHELF_ITEMS_TABLE_NAME} is missing`);
  }
  if (input.competitorShelfItems.missingColumnNames.length > 0) {
    blockers.push(`${COMPETITOR_SHELF_ITEMS_TABLE_NAME} is missing ${input.competitorShelfItems.missingColumnNames.length} evidence/run column(s)`);
  }
  if (!input.priceCaptureRuns.exists) {
    blockers.push(`${PRICE_CAPTURE_RUNS_TABLE_NAME} is missing`);
  } else if (input.priceCaptureRuns.missingColumnNames.length > 0) {
    blockers.push(`${PRICE_CAPTURE_RUNS_TABLE_NAME} is missing ${input.priceCaptureRuns.missingColumnNames.length} column(s)`);
  }
  if (input.securityFindings.length > 0) {
    blockers.push("Supabase security advisors contain unresolved exposed-schema finding(s)");
  }

  return blockers;
}

function buildSecurityFindings(advisories: readonly SupabaseSecurityAdvisorySnapshot[]): string[] {
  return advisories
    .filter((advisory) => {
      const level = advisory.level?.toUpperCase();
      return level === "ERROR" || advisory.name === "rls_disabled_in_public" || advisory.name === "sensitive_columns_exposed";
    })
    .map((advisory) => {
      const entity = [advisory.metadata?.schema, advisory.metadata?.name].filter(Boolean).join(".");
      return [advisory.name, advisory.level, entity, advisory.title].filter(Boolean).join(": ");
    });
}

function normalizeColumnNames(columns: readonly SupabaseSchemaColumnSnapshot[] | null | undefined): string[] {
  return (columns ?? [])
    .map((column) => column.name.trim())
    .filter(Boolean)
    .sort();
}
