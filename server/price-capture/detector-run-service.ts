import { randomUUID } from "node:crypto";

import {
  detectPriceTagsFromEncodedImage,
  type EncodedDetectorPipelineResult,
  type EncodedDetectorPipelineStepReport,
} from "./decoded-detector-pipeline";
import type { EncodedImageInput, ImageDecoder } from "./image-decoder";
import type { PriceCaptureRunContext } from "./evidence-contract";
import type { PriceTagDetection, PriceTagDetector } from "./local-pipeline";

export type DetectorRunContextInput = {
  companyId: string;
  storeId: string;
  week: 1 | 2;
  runId?: string | null;
  photoStoragePath?: string | null;
  photoFilename?: string | null;
  capturedDate?: string | null;
};

export type DetectorRunServiceInput = {
  context: DetectorRunContextInput;
  image: EncodedImageInput;
  decoder: ImageDecoder;
  detector: PriceTagDetector;
};

export type DetectorRunStatus = "completed" | "failed";

export type DetectorRunMetrics = {
  status: DetectorRunStatus;
  detectedCount: number;
  decodeFailed: boolean;
  detectExecuted: boolean;
  durationMs: number;
  aiUsedCount: 0;
  aiCostMicrousd: 0;
  decoderProvider: string;
  decoderModel: string;
  detectorProvider: string;
  detectorModel: string;
};

export type DetectorRunServiceResult = {
  run: PriceCaptureRunContext;
  detections: PriceTagDetection[];
  pipeline: EncodedDetectorPipelineResult;
  metrics: DetectorRunMetrics;
  steps: EncodedDetectorPipelineStepReport[];
};

export function createDetectorRunContext(input: DetectorRunContextInput): PriceCaptureRunContext {
  return {
    companyId: input.companyId,
    storeId: input.storeId,
    week: input.week,
    runId: normalizeIdentifier(input.runId) ?? randomUUID(),
    photoStoragePath: emptyToNull(input.photoStoragePath),
    photoFilename: emptyToNull(input.photoFilename),
    capturedDate: emptyToNull(input.capturedDate),
  };
}

export async function runDetectorService(input: DetectorRunServiceInput): Promise<DetectorRunServiceResult> {
  const startedAt = Date.now();
  const run = createDetectorRunContext({
    ...input.context,
    photoStoragePath: input.context.photoStoragePath ?? input.image.storagePath ?? null,
    photoFilename: input.context.photoFilename ?? input.image.filename ?? null,
  });

  const pipeline = await detectPriceTagsFromEncodedImage({
    run,
    image: input.image,
    decoder: input.decoder,
    detector: input.detector,
  });

  const metrics: DetectorRunMetrics = {
    status: pipeline.decodeError ? "failed" : "completed",
    detectedCount: pipeline.detections.length,
    decodeFailed: Boolean(pipeline.decodeError),
    detectExecuted: Boolean(pipeline.detectorResult),
    durationMs: Date.now() - startedAt,
    aiUsedCount: 0,
    aiCostMicrousd: 0,
    decoderProvider: pipeline.diagnostics.decoderProvider,
    decoderModel: pipeline.diagnostics.decoderModel,
    detectorProvider: pipeline.diagnostics.detectorProvider,
    detectorModel: pipeline.diagnostics.detectorModel,
  };

  return {
    run,
    detections: pipeline.detections,
    pipeline,
    metrics,
    steps: pipeline.steps,
  };
}

function normalizeIdentifier(value?: string | null): string | null {
  const normalized = emptyToNull(value);
  return normalized && /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
