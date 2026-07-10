import {
  buildCompetitorShelfItemEvidenceDraft,
  type EvidenceDraft,
} from "./evidence-contract";
import type { CropPaddingOptions } from "./crop-generator";
import type { DetectorRunServiceResult } from "./detector-run-service";
import type { PriceTagDetection } from "./local-pipeline";

export type DetectorEvidenceDraftOptions = {
  cropPadding?: CropPaddingOptions;
  cropExtension?: string | null;
  itemIdPrefix?: string | null;
};

export type SkippedDetectorEvidenceDraft = {
  detectionId: string | null;
  itemId: string;
  reason: "missing_decoded_image" | "invalid_crop";
  bbox: PriceTagDetection["bbox"];
};

export type DetectorEvidenceDraftMetrics = {
  detectedCount: number;
  draftCount: number;
  skippedCount: number;
  imageAvailable: boolean;
  decodeFailed: boolean;
};

export type DetectorEvidenceDraftResult = {
  drafts: EvidenceDraft[];
  skipped: SkippedDetectorEvidenceDraft[];
  metrics: DetectorEvidenceDraftMetrics;
};

export function buildEvidenceDraftsFromDetectorRun(
  runResult: DetectorRunServiceResult,
  options: DetectorEvidenceDraftOptions = {},
): DetectorEvidenceDraftResult {
  const decodedImage = runResult.pipeline.decodedImage;
  const drafts: EvidenceDraft[] = [];
  const skipped: SkippedDetectorEvidenceDraft[] = [];

  if (!decodedImage) {
    for (const [index, detection] of runResult.detections.entries()) {
      skipped.push({
        detectionId: emptyToNull(detection.id),
        itemId: buildItemId(detection, index, options.itemIdPrefix),
        reason: "missing_decoded_image",
        bbox: detection.bbox,
      });
    }

    return buildResult(runResult, drafts, skipped, false);
  }

  for (const [index, detection] of runResult.detections.entries()) {
    const itemId = buildItemId(detection, index, options.itemIdPrefix);
    const draft = buildCompetitorShelfItemEvidenceDraft({
      run: runResult.run,
      image: decodedImage.dimensions,
      detector: {
        itemId,
        bbox: detection.bbox,
        provider: detection.provider,
        model: detection.model,
        confidence: detection.confidence,
      },
      cropPadding: options.cropPadding,
      cropExtension: options.cropExtension,
    });

    if (!draft) {
      skipped.push({
        detectionId: emptyToNull(detection.id),
        itemId,
        reason: "invalid_crop",
        bbox: detection.bbox,
      });
      continue;
    }

    drafts.push(draft);
  }

  return buildResult(runResult, drafts, skipped, true);
}

function buildResult(
  runResult: DetectorRunServiceResult,
  drafts: EvidenceDraft[],
  skipped: SkippedDetectorEvidenceDraft[],
  imageAvailable: boolean,
): DetectorEvidenceDraftResult {
  return {
    drafts,
    skipped,
    metrics: {
      detectedCount: runResult.detections.length,
      draftCount: drafts.length,
      skippedCount: skipped.length,
      imageAvailable,
      decodeFailed: runResult.metrics.decodeFailed,
    },
  };
}

function buildItemId(detection: PriceTagDetection, index: number, prefix?: string | null): string {
  const normalizedPrefix = sanitizePathSegment(prefix) ?? "det";
  const normalizedDetectionId = sanitizePathSegment(detection.id);
  if (normalizedDetectionId) return `${normalizedPrefix}-${normalizedDetectionId}`;
  return `${normalizedPrefix}-${index + 1}`;
}

function sanitizePathSegment(value?: string | null): string | null {
  const normalized = emptyToNull(value);
  if (!normalized) return null;
  const safe = normalized.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return safe || null;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
