export const REAL_PHOTO_FAILURE_REPORT_SCHEMA_VERSION = "real-photo-failure-report-v1" as const;

export type RealPhotoFailureKind =
  | "detector_no_detections"
  | "detector_low_count"
  | "ocr_empty"
  | "price_not_parsed"
  | "product_text_missing"
  | "match_missing"
  | "match_needs_review"
  | "match_low_confidence"
  | "write_plan_empty";

export type RealPhotoDebugSummary = {
  photo: string;
  ok?: boolean | null;
  detectedCount?: number | null;
  draftCount?: number | null;
  ocrTextCount?: number | null;
  pricedCount?: number | null;
  namedCount?: number | null;
  matchedCount?: number | null;
  needsReviewCount?: number | null;
  evidenceWritePlanCount?: number | null;
  matchItems?: Array<{
    itemId: string;
    selectedCatalogProductId?: string | null;
    matchConfidence?: number | null;
    reviewRequired?: boolean | null;
    matchReason?: string | null;
  }> | null;
};

export type RealPhotoFailure = {
  photo: string;
  kind: RealPhotoFailureKind;
  severity: "info" | "warning" | "blocking";
  message: string;
  itemId: string | null;
  value: number | string | boolean | null;
};

export type RealPhotoFailureReport = {
  schemaVersion: typeof REAL_PHOTO_FAILURE_REPORT_SCHEMA_VERSION;
  photoCount: number;
  blockingCount: number;
  warningCount: number;
  infoCount: number;
  metrics: {
    totalDetectedCount: number;
    totalDraftCount: number;
    totalOcrTextCount: number;
    totalPricedCount: number;
    totalNamedCount: number;
    totalMatchedCount: number;
    totalNeedsReviewCount: number;
    totalEvidenceWritePlanCount: number;
  };
  failures: RealPhotoFailure[];
  nextActions: string[];
};

export function buildRealPhotoFailureReport(input: {
  photos: RealPhotoDebugSummary[];
  expectedMinimumDetectionsPerPhoto?: number | null;
  lowMatchConfidenceThreshold?: number | null;
}): RealPhotoFailureReport {
  const minimumDetections = normalizePositiveInteger(input.expectedMinimumDetectionsPerPhoto) ?? 1;
  const lowMatchThreshold = normalizeConfidence(input.lowMatchConfidenceThreshold) ?? 0.7;
  const failures = input.photos.flatMap((photo) => analyzePhoto(photo, { minimumDetections, lowMatchThreshold }));

  return {
    schemaVersion: REAL_PHOTO_FAILURE_REPORT_SCHEMA_VERSION,
    photoCount: input.photos.length,
    blockingCount: failures.filter((failure) => failure.severity === "blocking").length,
    warningCount: failures.filter((failure) => failure.severity === "warning").length,
    infoCount: failures.filter((failure) => failure.severity === "info").length,
    metrics: {
      totalDetectedCount: sum(input.photos, "detectedCount"),
      totalDraftCount: sum(input.photos, "draftCount"),
      totalOcrTextCount: sum(input.photos, "ocrTextCount"),
      totalPricedCount: sum(input.photos, "pricedCount"),
      totalNamedCount: sum(input.photos, "namedCount"),
      totalMatchedCount: sum(input.photos, "matchedCount"),
      totalNeedsReviewCount: sum(input.photos, "needsReviewCount"),
      totalEvidenceWritePlanCount: sum(input.photos, "evidenceWritePlanCount"),
    },
    failures,
    nextActions: buildNextActions(failures),
  };
}

export function debugWritePlanJsonToPhotoSummary(input: {
  photo: string;
  json: string;
}): RealPhotoDebugSummary {
  const parsed = JSON.parse(input.json) as Record<string, unknown>;
  const report = getRecord(parsed.report);
  const summary = getRecord(report?.summary);
  const ocr = getRecord(summary?.ocr);
  const price = getRecord(summary?.price);
  const productText = getRecord(summary?.productText);
  const match = getRecord(parsed.match);
  const matchMetrics = getRecord(match?.metrics);
  const evidenceWritePlan = getRecord(parsed.evidenceWritePlan);
  const evidencePayloads = Array.isArray(evidenceWritePlan?.evidencePayloads)
    ? evidenceWritePlan.evidencePayloads
    : [];

  return {
    photo: input.photo,
    ok: parsed.ok === true,
    detectedCount: toNumber(summary?.detectedCount),
    draftCount: toNumber(summary?.draftCount),
    ocrTextCount: toNumber(ocr?.textCount),
    pricedCount: toNumber(price?.pricedCount),
    namedCount: toNumber(productText?.namedCount),
    matchedCount: toNumber(matchMetrics?.selectedCount),
    needsReviewCount: toNumber(matchMetrics?.needsReviewCount),
    evidenceWritePlanCount: evidencePayloads.length,
    matchItems: parseMatchItems(match?.items),
  };
}

function analyzePhoto(
  photo: RealPhotoDebugSummary,
  options: { minimumDetections: number; lowMatchThreshold: number },
): RealPhotoFailure[] {
  const failures: RealPhotoFailure[] = [];
  const detectedCount = safeNumber(photo.detectedCount);
  const draftCount = safeNumber(photo.draftCount);
  const ocrTextCount = safeNumber(photo.ocrTextCount);
  const pricedCount = safeNumber(photo.pricedCount);
  const namedCount = safeNumber(photo.namedCount);
  const matchedCount = safeNumber(photo.matchedCount);
  const writePlanCount = safeNumber(photo.evidenceWritePlanCount);

  if (detectedCount === 0) {
    failures.push(failure(photo.photo, "detector_no_detections", "blocking", "No price-tag detections were produced.", null, detectedCount));
  } else if (detectedCount < options.minimumDetections) {
    failures.push(failure(photo.photo, "detector_low_count", "warning", "Detected fewer price tags than expected for this photo.", null, detectedCount));
  }

  if (draftCount > 0 && ocrTextCount === 0) {
    failures.push(failure(photo.photo, "ocr_empty", "blocking", "Crops were produced, but OCR returned no text.", null, ocrTextCount));
  }

  if (ocrTextCount > 0 && pricedCount === 0) {
    failures.push(failure(photo.photo, "price_not_parsed", "warning", "OCR text exists, but no price was parsed.", null, pricedCount));
  }

  if (ocrTextCount > 0 && namedCount === 0) {
    failures.push(failure(photo.photo, "product_text_missing", "warning", "OCR text exists, but product text was not extracted.", null, namedCount));
  }

  if (namedCount > 0 && matchedCount === 0) {
    failures.push(failure(photo.photo, "match_missing", "warning", "Product text exists, but no catalog item was selected.", null, matchedCount));
  }

  for (const item of photo.matchItems ?? []) {
    if (item.reviewRequired) {
      failures.push(failure(photo.photo, "match_needs_review", "info", item.matchReason ?? "Match requires manual review.", item.itemId, true));
    }
    if (typeof item.matchConfidence === "number" && item.matchConfidence < options.lowMatchThreshold) {
      failures.push(failure(photo.photo, "match_low_confidence", "warning", "Catalog match confidence is below threshold.", item.itemId, item.matchConfidence));
    }
  }

  if (detectedCount > 0 && writePlanCount === 0) {
    failures.push(failure(photo.photo, "write_plan_empty", "blocking", "Detections exist, but no evidence write plan was built.", null, writePlanCount));
  }

  return failures;
}

function failure(
  photo: string,
  kind: RealPhotoFailureKind,
  severity: RealPhotoFailure["severity"],
  message: string,
  itemId: string | null,
  value: number | string | boolean | null,
): RealPhotoFailure {
  return { photo, kind, severity, message, itemId, value };
}

function buildNextActions(failures: RealPhotoFailure[]): string[] {
  const kinds = new Set(failures.map((failure) => failure.kind));
  const actions: string[] = [];

  if (kinds.has("detector_no_detections") || kinds.has("detector_low_count")) {
    actions.push("Tune detector thresholds and crop strategy on real shelf photos first.");
  }
  if (kinds.has("ocr_empty")) {
    actions.push("Inspect generated crops and RapidOCR worker output before changing matching logic.");
  }
  if (kinds.has("price_not_parsed")) {
    actions.push("Add OCR text examples to local-price-parser tests and extend price patterns.");
  }
  if (kinds.has("product_text_missing")) {
    actions.push("Add OCR text examples to product-text extractor tests and improve noise cleanup.");
  }
  if (kinds.has("match_missing") || kinds.has("match_low_confidence") || kinds.has("match_needs_review")) {
    actions.push("Compare normalized product text with catalog names and add aliases/normalization rules.");
  }
  if (kinds.has("write_plan_empty")) {
    actions.push("Fix persistence mapping before enabling any controlled write for real photo output.");
  }

  return actions;
}

function parseMatchItems(value: unknown): RealPhotoDebugSummary["matchItems"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = getRecord(item) ?? {};
    return {
      itemId: String(record.itemId ?? "unknown"),
      selectedCatalogProductId: toNullableString(record.selectedCatalogProductId),
      matchConfidence: toNumber(record.matchConfidence),
      reviewRequired: typeof record.reviewRequired === "boolean" ? record.reviewRequired : null,
      matchReason: toNullableString(record.matchReason),
    };
  });
}

function sum(photos: RealPhotoDebugSummary[], key: keyof RealPhotoDebugSummary): number {
  return photos.reduce((total, photo) => total + safeNumber(photo[key]), 0);
}

function safeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : null;
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
