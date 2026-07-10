import {
  COMPETITOR_SHELF_ITEMS_TABLE,
  type CompetitorShelfItemInsertPayload,
} from "./evidence-persistence";
import {
  PRICE_CAPTURE_RUNS_TABLE,
  type PriceCaptureRunInsertPayload,
} from "./controlled-evidence-test-row";

export const DEBUG_EVIDENCE_WRITE_PLAN_MODE = "dry_run_only" as const;
export const DEFAULT_DEBUG_EVIDENCE_WRITE_PLAN_MAX_ITEMS = 1;
export const MAX_DEBUG_EVIDENCE_WRITE_PLAN_ITEMS = 20;

export type DebugEvidenceWritePlanInput = {
  evidencePayloads: CompetitorShelfItemInsertPayload[];
  nowIso?: string | null;
  maxItems?: number | null;
};

export type DebugEvidenceWritePlanCleanupHint = {
  tablesInOrder: readonly [typeof COMPETITOR_SHELF_ITEMS_TABLE, typeof PRICE_CAPTURE_RUNS_TABLE];
  evidenceWhere: {
    processing_run_id: string;
    photo_storage_path: string | null;
  };
  runWhere: {
    id: string;
  };
};

export type DebugEvidenceWritePlan = {
  mode: typeof DEBUG_EVIDENCE_WRITE_PLAN_MODE;
  writeEnabled: false;
  tablesInOrder: readonly [typeof PRICE_CAPTURE_RUNS_TABLE, typeof COMPETITOR_SHELF_ITEMS_TABLE];
  selectedItemCount: number;
  totalAvailableItemCount: number;
  truncated: boolean;
  priceCaptureRunPayload: PriceCaptureRunInsertPayload;
  evidencePayloads: CompetitorShelfItemInsertPayload[];
  cleanup: DebugEvidenceWritePlanCleanupHint;
  warnings: string[];
};

export function buildDebugEvidenceWritePlan(input: DebugEvidenceWritePlanInput): DebugEvidenceWritePlan {
  const payloads = Array.isArray(input.evidencePayloads) ? input.evidencePayloads : [];
  if (payloads.length === 0) throw new Error("At least one evidence payload is required to build a debug evidence write plan.");

  const maxItems = normalizeMaxItems(input.maxItems);
  const selectedPayloads = payloads.slice(0, maxItems);
  const first = selectedPayloads[0];
  assertConsistentRun(selectedPayloads, first);

  const nowIso = normalizeIso(input.nowIso) ?? new Date().toISOString();
  const priceCaptureRunPayload = buildPriceCaptureRunPayloadFromEvidencePayloads({
    payloads: selectedPayloads,
    nowIso,
  });

  return {
    mode: DEBUG_EVIDENCE_WRITE_PLAN_MODE,
    writeEnabled: false,
    tablesInOrder: [PRICE_CAPTURE_RUNS_TABLE, COMPETITOR_SHELF_ITEMS_TABLE],
    selectedItemCount: selectedPayloads.length,
    totalAvailableItemCount: payloads.length,
    truncated: selectedPayloads.length < payloads.length,
    priceCaptureRunPayload,
    evidencePayloads: selectedPayloads,
    cleanup: {
      tablesInOrder: [COMPETITOR_SHELF_ITEMS_TABLE, PRICE_CAPTURE_RUNS_TABLE],
      evidenceWhere: {
        processing_run_id: first.processing_run_id,
        photo_storage_path: first.photo_storage_path,
      },
      runWhere: {
        id: first.processing_run_id,
      },
    },
    warnings: [
      "Dry-run plan only. This module does not call Supabase.",
      "Default selection is one evidence item to avoid accidental bulk writes.",
      "Write path must remain admin-only and guarded by explicit env confirmation.",
    ],
  };
}

export function buildPriceCaptureRunPayloadFromEvidencePayloads(input: {
  payloads: CompetitorShelfItemInsertPayload[];
  nowIso?: string | null;
}): PriceCaptureRunInsertPayload {
  if (input.payloads.length === 0) throw new Error("At least one evidence payload is required to build price_capture_runs payload.");
  const first = input.payloads[0];
  assertConsistentRun(input.payloads, first);
  const nowIso = normalizeIso(input.nowIso) ?? new Date().toISOString();

  const autoMatchedCount = input.payloads.filter((payload) => payload.catalog_product_id && payload.review_reason === "auto_matched").length;
  const needsReviewCount = input.payloads.filter((payload) => payload.review_status === "pending" && payload.review_reason !== "auto_matched").length;
  const parsedPriceCount = input.payloads.filter((payload) => payload.price_minor !== null).length;
  const ocrSuccessCount = input.payloads.filter((payload) => hasText(payload.ocr_text)).length;
  const cropCount = input.payloads.filter((payload) => hasText(payload.crop_storage_path)).length;

  return {
    id: first.processing_run_id,
    company_id: first.company_id,
    store_id: first.store_id,
    week: first.week,
    photo_storage_path: first.photo_storage_path ?? "",
    photo_filename: first.photo_filename ?? "",
    photo_sha256: null,
    status: "completed",
    error_message: null,
    started_at: nowIso,
    finished_at: nowIso,
    duration_ms: 0,
    detected_count: input.payloads.length,
    crop_count: cropCount,
    ocr_success_count: ocrSuccessCount,
    parsed_price_count: parsedPriceCount,
    auto_matched_count: autoMatchedCount,
    needs_review_count: needsReviewCount,
    unmatched_count: Math.max(0, input.payloads.length - autoMatchedCount),
    ai_calls_count: 0,
    ai_cost_microusd: 0,
  };
}

function normalizeMaxItems(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_DEBUG_EVIDENCE_WRITE_PLAN_MAX_ITEMS;
  const integer = Math.trunc(value);
  if (integer < 1) return DEFAULT_DEBUG_EVIDENCE_WRITE_PLAN_MAX_ITEMS;
  return Math.min(integer, MAX_DEBUG_EVIDENCE_WRITE_PLAN_ITEMS);
}

function assertConsistentRun(payloads: CompetitorShelfItemInsertPayload[], first: CompetitorShelfItemInsertPayload): void {
  for (const payload of payloads) {
    if (payload.processing_run_id !== first.processing_run_id) throw new Error("All evidence payloads must belong to the same processing_run_id.");
    if (payload.company_id !== first.company_id) throw new Error("All evidence payloads must belong to the same company_id.");
    if (payload.store_id !== first.store_id) throw new Error("All evidence payloads must belong to the same store_id.");
    if (payload.week !== first.week) throw new Error("All evidence payloads must belong to the same week.");
  }
}

function normalizeIso(value?: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function hasText(value?: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
