import { randomUUID } from "node:crypto";

import {
  buildCompetitorShelfItemEvidenceDraft,
  type EvidenceDraft,
  type PriceCaptureRunContext,
} from "./evidence-contract";
import {
  buildCompetitorShelfItemInsertPayload,
  COMPETITOR_SHELF_ITEMS_TABLE,
  type CompetitorShelfItemInsertPayload,
} from "./evidence-persistence";

export { COMPETITOR_SHELF_ITEMS_TABLE } from "./evidence-persistence";

export const PRICE_CAPTURE_RUNS_TABLE = "price_capture_runs" as const;
export const CONTROLLED_TEST_ROW_MARKER_PREFIX = "PV_CONTROLLED_EVIDENCE_TEST_ROW" as const;
export const CONTROLLED_TEST_ROW_REVIEW_REASON = "controlled_test_row_do_not_use_for_reports" as const;

export type PriceCaptureRunInsertPayload = {
  id: string;
  company_id: string;
  store_id: string;
  week: 1 | 2;
  photo_storage_path: string;
  photo_filename: string;
  photo_sha256: string | null;
  status: "completed";
  error_message: null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  detected_count: number;
  crop_count: number;
  ocr_success_count: number;
  parsed_price_count: number;
  auto_matched_count: number;
  needs_review_count: number;
  unmatched_count: number;
  ai_calls_count: 0;
  ai_cost_microusd: 0;
};

export type ControlledEvidenceTestRowPlanInput = {
  companyId: string;
  storeId: string;
  week?: 1 | 2 | null;
  runId?: string | null;
  marker?: string | null;
  nowIso?: string | null;
  capturedDate?: string | null;
};

export type ControlledEvidenceTestRowCleanupInstruction = {
  tablesInOrder: readonly [typeof COMPETITOR_SHELF_ITEMS_TABLE, typeof PRICE_CAPTURE_RUNS_TABLE];
  evidenceWhere: {
    processing_run_id: string;
    raw_name_starts_with: string;
  };
  runWhere: {
    id: string;
    photo_filename: string;
  };
};

export type ControlledEvidenceTestRowPlan = {
  marker: string;
  run: PriceCaptureRunContext;
  draft: EvidenceDraft;
  priceCaptureRunPayload: PriceCaptureRunInsertPayload;
  evidencePayload: CompetitorShelfItemInsertPayload;
  cleanup: ControlledEvidenceTestRowCleanupInstruction;
  warnings: string[];
};

export function buildControlledEvidenceTestRowPlan(
  input: ControlledEvidenceTestRowPlanInput,
): ControlledEvidenceTestRowPlan {
  const companyId = requireUuid(input.companyId, "companyId");
  const storeId = requireUuid(input.storeId, "storeId");
  const week = input.week === 2 ? 2 : 1;
  const runId = input.runId ? requireUuid(input.runId, "runId") : randomUUID();
  const nowIso = normalizeIso(input.nowIso) ?? new Date().toISOString();
  const capturedDate = normalizeDate(input.capturedDate) ?? nowIso.slice(0, 10);
  const marker = normalizeMarker(input.marker) ?? `${CONTROLLED_TEST_ROW_MARKER_PREFIX}_${nowIso.replace(/[^0-9]/g, "").slice(0, 14)}`;
  const photoFilename = `${marker}.jpg`;
  const photoStoragePath = `controlled-test/evidence/${marker}/source.jpg`;

  const run: PriceCaptureRunContext = {
    companyId,
    storeId,
    week,
    runId,
    capturedDate,
    photoStoragePath,
    photoFilename,
  };
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run,
    image: { width: 240, height: 120 },
    detector: {
      itemId: `${marker}_item_1`,
      bbox: { x: 12, y: 24, width: 120, height: 44 },
      provider: "controlled-test",
      model: "manual-fixture-v1",
      confidence: 0.99,
    },
    cropExtension: "jpg",
    ocr: {
      provider: "controlled-test",
      model: "manual-ocr-fixture-v1",
      text: `${marker} Кофе тестовый 250 г 123,45`,
      confidence: 0.99,
    },
    parsedPrice: {
      priceMinor: 12345,
      oldPriceMinor: null,
      promoPriceMinor: null,
      currency: "RUB",
      confidence: 0.99,
    },
    productText: {
      rawName: `${marker} Кофе тестовый 250 г`,
      brand: "PV_TEST",
      sizeText: "250 г",
      priceTagText: `${marker} Кофе тестовый 250 г 123,45`,
      productVisibleText: `${marker} Кофе тестовый 250 г`,
      normalizedProductText: `${marker.toLowerCase()} кофе тестовый 250 г`,
    },
  });

  if (!draft) throw new Error("Failed to build controlled evidence test-row draft.");

  const priceCaptureRunPayload: PriceCaptureRunInsertPayload = {
    id: runId,
    company_id: companyId,
    store_id: storeId,
    week,
    photo_storage_path: photoStoragePath,
    photo_filename: photoFilename,
    photo_sha256: null,
    status: "completed",
    error_message: null,
    started_at: nowIso,
    finished_at: nowIso,
    duration_ms: 0,
    detected_count: 1,
    crop_count: 1,
    ocr_success_count: 1,
    parsed_price_count: 1,
    auto_matched_count: 0,
    needs_review_count: 1,
    unmatched_count: 1,
    ai_calls_count: 0,
    ai_cost_microusd: 0,
  };
  const evidencePayload = {
    ...buildCompetitorShelfItemInsertPayload({ draft, match: null, matchedAt: null }),
    review_reason: CONTROLLED_TEST_ROW_REVIEW_REASON,
  };

  return {
    marker,
    run,
    draft,
    priceCaptureRunPayload,
    evidencePayload,
    cleanup: buildControlledEvidenceTestRowCleanupInstruction({ marker, runId }),
    warnings: [
      "Dry-run plan only. Do not execute writes until env guards and one-row approval are set.",
      "This marker must be excluded from reports and production analytics.",
      "Clean up the evidence row first, then the price_capture_runs row.",
    ],
  };
}

export function buildControlledEvidenceTestRowCleanupInstruction(input: {
  marker: string;
  runId: string;
}): ControlledEvidenceTestRowCleanupInstruction {
  return {
    tablesInOrder: [COMPETITOR_SHELF_ITEMS_TABLE, PRICE_CAPTURE_RUNS_TABLE],
    evidenceWhere: {
      processing_run_id: input.runId,
      raw_name_starts_with: input.marker,
    },
    runWhere: {
      id: input.runId,
      photo_filename: `${input.marker}.jpg`,
    },
  };
}

function requireUuid(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`${fieldName} must be a UUID.`);
  }
  return normalized;
}

function normalizeIso(value?: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDate(value?: string | null): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  return value.trim();
}

function normalizeMarker(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  if (!normalized) return null;
  return normalized.startsWith(CONTROLLED_TEST_ROW_MARKER_PREFIX)
    ? normalized
    : `${CONTROLLED_TEST_ROW_MARKER_PREFIX}_${normalized}`;
}
