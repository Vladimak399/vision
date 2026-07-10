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

export type DetectorOnlyRunReportOcrSummaryDto = {
  processedCount: number;
  textResultCount: number;
  emptyResultCount: number;
};

export type DetectorOnlyRunReportPriceSummaryDto = {
  parsedCount: number;
  pricedCount: number;
  oldPriceCount: number;
  promoPriceCount: number;
};

export type DetectorOnlyRunReportProductTextSummaryDto = {
  namedCount: number;
  normalizedCount: number;
  unknownCount: number;
};

export type DetectorOnlyRunReportSummaryDto = DetectorOnlyProcessingSummary & {
  statusReason: "ok" | "decode_failed" | "partial_invalid_crops" | "no_detections";
  ocr: DetectorOnlyRunReportOcrSummaryDto;
  price: DetectorOnlyRunReportPriceSummaryDto;
  productText: DetectorOnlyRunReportProductTextSummaryDto;
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

export type DetectorOnlyRunReportDraftOcrDto = {
  provider: string | null;
  model: string | null;
  text: string | null;
  confidence: number | null;
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
    productVisibleText: string | null;
    brand: string | null;
    sizeText: string | null;
    priceMinor: number | null;
    oldPriceMinor: number | null;
    promoPriceMinor: number | null;
    parsedPriceConfidence: number | null;
    currency: string;
  };
  ocr?: DetectorOnlyRunReportDraftOcrDto;
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
      ocr: buildOcrSummary(result.drafts),
      price: buildPriceSummary(result.drafts),
      productText: buildProductTextSummary(result.drafts),
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
        productVisibleText: draft.row.product_visible_text,
        brand: draft.row.brand,
        sizeText: draft.row.size_text,
        priceMinor: draft.row.price_minor,
        oldPriceMinor: draft.row.old_price_minor,
        promoPriceMinor: draft.row.promo_price_minor,
        parsedPriceConfidence: clampNullableConfidence(draft.row.parsed_price_confidence),
        currency: draft.row.currency,
      },
      ...(hasOcrEvidence(draft.row) ? {
        ocr: {
          provider: emptyToNull(draft.row.ocr_provider),
          model: emptyToNull(draft.row.ocr_model),
          text: emptyToNull(draft.row.ocr_text),
          confidence: clampNullableConfidence(draft.row.ocr_confidence),
        },
      } : {}),
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

function buildOcrSummary(drafts: DetectorOnlyProcessingResult["drafts"]): DetectorOnlyRunReportOcrSummaryDto {
  const processed = drafts.filter((draft) => hasOcrEvidence(draft.row));
  const textResultCount = processed.filter((draft) => Boolean(emptyToNull(draft.row.ocr_text))).length;

  return {
    processedCount: processed.length,
    textResultCount,
    emptyResultCount: processed.length - textResultCount,
  };
}

function buildPriceSummary(drafts: DetectorOnlyProcessingResult["drafts"]): DetectorOnlyRunReportPriceSummaryDto {
  const parsed = drafts.filter((draft) => hasNumericConfidence(draft.row.parsed_price_confidence));

  return {
    parsedCount: parsed.length,
    pricedCount: drafts.filter((draft) => draft.row.price_minor !== null).length,
    oldPriceCount: drafts.filter((draft) => draft.row.old_price_minor !== null).length,
    promoPriceCount: drafts.filter((draft) => draft.row.promo_price_minor !== null).length,
  };
}

function buildProductTextSummary(drafts: DetectorOnlyProcessingResult["drafts"]): DetectorOnlyRunReportProductTextSummaryDto {
  const namedCount = drafts.filter((draft) => !isUnknownRawName(draft.row.raw_name)).length;
  const normalizedCount = drafts.filter((draft) => Boolean(emptyToNull(draft.row.normalized_product_text))).length;

  return {
    namedCount,
    normalizedCount,
    unknownCount: Math.max(0, drafts.length - namedCount),
  };
}

function hasOcrEvidence(row: DetectorOnlyProcessingResult["drafts"][number]["row"]): boolean {
  return Boolean(
    emptyToNull(row.ocr_provider)
    || emptyToNull(row.ocr_model)
    || emptyToNull(row.ocr_text)
    || hasNumericConfidence(row.ocr_confidence),
  );
}

function isUnknownRawName(value: string | null | undefined): boolean {
  const normalized = emptyToNull(value)?.toLowerCase();
  return !normalized || normalized === "unknown";
}

function hasNumericConfidence(value?: number | null): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function clampNullableConfidence(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampConfidence(value);
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
