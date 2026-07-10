import type { CropBBox } from "./crop-generator";
import type { DetectorOnlyProcessingResult, DetectorOnlyProcessingSummary } from "./detector-only-orchestrator";

export type DetectorOnlyRunReportDto = {
  schemaVersion: "detector-only-report-v1";
  run: DetectorOnlyRunReportRunDto;
  summary: DetectorOnlyRunReportSummaryDto;
  detections: DetectorOnlyRunReportDetectionDto[];
  drafts: DetectorOnlyRunReportDraftDto[];
  skipped: DetectorOnlyRunReportSkippedDto[];
  steps: DetectorOnlyRunReportStepDto[];
};

export type DetectorOnlyRunReportRunDto = {
  companyId: string;
  storeId: string;
  week: 1 | 2;
  runId: string;
  photoStoragePath: string | null;
  photoFilename: string | null;
  capturedDate: string | null;
};

export type DetectorOnlyRunReportSummaryDto = DetectorOnlyProcessingSummary & {
  statusReason: "ok" | "decode_failed" | "partial_invalid_crops" | "no_detections";
};

export type DetectorOnlyRunReportDetectionDto = {
  index: number;
  id: string | null;
  label: string | null;
  bbox: CropBBox;
  confidence: number;
  provider: string;
  model: string;
};

export type DetectorOnlyRunReportDraftDto = {
  index: number;
  itemId: string;
  bbox: CropBBox;
  crop: {
    storagePath: string;
    width: number;
    height: number;
  };
  detector: {
    provider: string;
    model: string;
    confidence: number;
  };
  review: {
    status: string;
    reason: string;
  };
  ai: {
    used: false;
  };
  product: {
    rawName: string;
    normalizedProductText: string | null;
    priceMinor: number | null;
    currency: string;
  };
};

export type DetectorOnlyRunReportSkippedDto = {
  index: number;
  detectionId: string | null;
  itemId: string;
  reason: "missing_decoded_image" | "invalid_crop";
  bbox: CropBBox;
};

export type DetectorOnlyRunReportStepDto = {
  index: number;
  step: string;
  status: string;
  durationMs: number;
  errorMessage: string | null;
};

export function buildDetectorOnlyRunReport(result: DetectorOnlyProcessingResult): DetectorOnlyRunReportDto {
  return {
    schemaVersion: "detector-only-report-v1",
    run: {
      companyId: result.run.companyId,
      storeId: result.run.storeId,
      week: result.run.week,
      runId: result.run.runId,
      photoStoragePath: result.run.photoStoragePath ?? null,
      photoFilename: result.run.photoFilename ?? null,
      capturedDate: result.run.capturedDate ?? null,
    },
    summary: {
      ...result.summary,
      statusReason: resolveStatusReason(result),
    },
    detections: result.detectorRun.detections.map((detection, index) => ({
      index,
      id: emptyToNull(detection.id),
      label: emptyToNull(detection.label),
      bbox: detection.bbox,
      confidence: clampConfidence(detection.confidence),
      provider: detection.provider,
      model: detection.model,
    })),
    drafts: result.drafts.map((draft, index) => ({
      index,
      itemId: draft.itemId,
      bbox: draft.row.bbox,
      crop: {
        storagePath: draft.row.crop_storage_path,
        width: draft.row.crop_width,
        height: draft.row.crop_height,
      },
      detector: {
        provider: draft.row.detector_provider,
        model: draft.row.detector_model,
        confidence: draft.row.detector_confidence,
      },
      review: {
        status: draft.row.review_status,
        reason: draft.row.review_reason,
      },
      ai: {
        used: draft.row.ai_used,
      },
      product: {
        rawName: draft.row.raw_name,
        normalizedProductText: draft.row.normalized_product_text,
        priceMinor: draft.row.price_minor,
        currency: draft.row.currency,
      },
    })),
    skipped: result.skipped.map((skipped, index) => ({
      index,
      detectionId: skipped.detectionId,
      itemId: skipped.itemId,
      reason: skipped.reason,
      bbox: skipped.bbox,
    })),
    steps: result.detectorRun.steps.map((step, index) => ({
      index,
      step: step.step,
      status: step.status,
      durationMs: Math.max(0, Math.trunc(step.durationMs)),
      errorMessage: emptyToNull(step.errorMessage),
    })),
  };
}

export function serializeDetectorOnlyRunReport(result: DetectorOnlyProcessingResult): string {
  return JSON.stringify(buildDetectorOnlyRunReport(result));
}

function resolveStatusReason(result: DetectorOnlyProcessingResult): DetectorOnlyRunReportSummaryDto["statusReason"] {
  if (result.summary.decodeFailed) return "decode_failed";
  if (result.summary.skippedCount > 0) return "partial_invalid_crops";
  if (result.summary.detectedCount === 0) return "no_detections";
  return "ok";
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
