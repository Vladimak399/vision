import {
  createSharpHeuristicDetectorPipeline,
  type SharpHeuristicDetectorPipelineOptions,
} from "./decoded-detector-pipeline";
import {
  buildEvidenceDraftsFromDetectorRun,
  type DetectorEvidenceDraftOptions,
  type DetectorEvidenceDraftResult,
  type SkippedDetectorEvidenceDraft,
} from "./detector-evidence-drafts";
import {
  runDetectorService,
  type DetectorRunContextInput,
  type DetectorRunServiceResult,
  type DetectorRunStatus,
} from "./detector-run-service";
import type { EvidenceDraft, PriceCaptureRunContext } from "./evidence-contract";
import type { EncodedImageInput, ImageDecoder } from "./image-decoder";
import type { PriceTagDetector } from "./local-pipeline";

export type DetectorOnlyProcessingInput = {
  context: DetectorRunContextInput;
  image: EncodedImageInput;
  decoder: ImageDecoder;
  detector: PriceTagDetector;
  evidence?: DetectorEvidenceDraftOptions;
};

export type DetectorOnlyProcessingSummary = {
  status: DetectorRunStatus;
  detectedCount: number;
  draftCount: number;
  skippedCount: number;
  needsReviewCount: number;
  decodeFailed: boolean;
  detectExecuted: boolean;
  imageAvailable: boolean;
  durationMs: number;
  aiUsedCount: 0;
  aiCostMicrousd: 0;
  decoderProvider: string;
  decoderModel: string;
  detectorProvider: string;
  detectorModel: string;
};

export type DetectorOnlyProcessingResult = {
  run: PriceCaptureRunContext;
  detectorRun: DetectorRunServiceResult;
  evidence: DetectorEvidenceDraftResult;
  drafts: EvidenceDraft[];
  skipped: SkippedDetectorEvidenceDraft[];
  summary: DetectorOnlyProcessingSummary;
};

export type SharpHeuristicDetectorOnlyProcessorOptions = SharpHeuristicDetectorPipelineOptions & {
  evidence?: DetectorEvidenceDraftOptions;
};

export type SharpHeuristicDetectorOnlyProcessorInput = {
  context: DetectorRunContextInput;
  image: EncodedImageInput;
  evidence?: DetectorEvidenceDraftOptions;
};

export type SharpHeuristicDetectorOnlyProcessor = {
  decoder: ImageDecoder;
  detector: PriceTagDetector;
  process(input: SharpHeuristicDetectorOnlyProcessorInput): Promise<DetectorOnlyProcessingResult>;
};

export async function processDetectorOnlyPhoto(input: DetectorOnlyProcessingInput): Promise<DetectorOnlyProcessingResult> {
  const detectorRun = await runDetectorService({
    context: input.context,
    image: input.image,
    decoder: input.decoder,
    detector: input.detector,
  });

  const evidence = buildEvidenceDraftsFromDetectorRun(detectorRun, input.evidence);
  const summary = buildDetectorOnlySummary(detectorRun, evidence);

  return {
    run: detectorRun.run,
    detectorRun,
    evidence,
    drafts: evidence.drafts,
    skipped: evidence.skipped,
    summary,
  };
}

export function createSharpHeuristicDetectorOnlyProcessor(
  options: SharpHeuristicDetectorOnlyProcessorOptions = {},
): SharpHeuristicDetectorOnlyProcessor {
  const { decoder, detector } = createSharpHeuristicDetectorPipeline({
    decoder: options.decoder,
    detector: options.detector,
  });

  return {
    decoder,
    detector,
    process(input: SharpHeuristicDetectorOnlyProcessorInput) {
      return processDetectorOnlyPhoto({
        context: input.context,
        image: input.image,
        decoder,
        detector,
        evidence: input.evidence ?? options.evidence,
      });
    },
  };
}

export function buildDetectorOnlySummary(
  detectorRun: DetectorRunServiceResult,
  evidence: DetectorEvidenceDraftResult,
): DetectorOnlyProcessingSummary {
  return {
    status: detectorRun.metrics.status,
    detectedCount: detectorRun.metrics.detectedCount,
    draftCount: evidence.metrics.draftCount,
    skippedCount: evidence.metrics.skippedCount,
    needsReviewCount: evidence.metrics.draftCount,
    decodeFailed: detectorRun.metrics.decodeFailed,
    detectExecuted: detectorRun.metrics.detectExecuted,
    imageAvailable: evidence.metrics.imageAvailable,
    durationMs: detectorRun.metrics.durationMs,
    aiUsedCount: 0,
    aiCostMicrousd: 0,
    decoderProvider: detectorRun.metrics.decoderProvider,
    decoderModel: detectorRun.metrics.decoderModel,
    detectorProvider: detectorRun.metrics.detectorProvider,
    detectorModel: detectorRun.metrics.detectorModel,
  };
}
