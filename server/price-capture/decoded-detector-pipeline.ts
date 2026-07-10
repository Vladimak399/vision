import { decodedImageToDetectorPhotoInput, type DecodedImagePixels, type EncodedImageInput, type ImageDecodeError, type ImageDecoder } from "./image-decoder";
import { createHeuristicPriceTagDetector, type HeuristicPriceTagDetectorOptions } from "./heuristic-price-tag-detector";
import { createSharpImageDecoder, type SharpImageDecoderOptions } from "./sharp-image-decoder";
import type { PriceCaptureRunContext } from "./evidence-contract";
import type { PriceTagDetection, PriceTagDetector, PriceTagDetectorResult } from "./local-pipeline";

export type EncodedDetectorPipelineInput = {
  run: PriceCaptureRunContext;
  image: EncodedImageInput;
  decoder: ImageDecoder;
  detector: PriceTagDetector;
};

export type EncodedDetectorPipelineStepReport = {
  step: "decode_image" | "detect";
  status: "completed" | "failed";
  durationMs: number;
  errorMessage?: string | null;
  diagnostics?: Record<string, unknown>;
};

export type EncodedDetectorPipelineResult = {
  detections: PriceTagDetection[];
  decodedImage: DecodedImagePixels | null;
  detectorResult: PriceTagDetectorResult | null;
  decodeError: ImageDecodeError | null;
  steps: EncodedDetectorPipelineStepReport[];
  diagnostics: {
    decoderProvider: string;
    decoderModel: string;
    detectorProvider: string;
    detectorModel: string;
  };
};

export type SharpHeuristicDetectorPipelineOptions = {
  decoder?: SharpImageDecoderOptions;
  detector?: HeuristicPriceTagDetectorOptions;
};

export async function detectPriceTagsFromEncodedImage(input: EncodedDetectorPipelineInput): Promise<EncodedDetectorPipelineResult> {
  const steps: EncodedDetectorPipelineStepReport[] = [];
  const decodeStartedAt = Date.now();
  const decodeResult = await input.decoder.decode(input.image);

  steps.push({
    step: "decode_image",
    status: decodeResult.image ? "completed" : "failed",
    durationMs: Date.now() - decodeStartedAt,
    errorMessage: decodeResult.error?.message ?? null,
    diagnostics: decodeResult.image?.diagnostics ?? decodeResult.error?.diagnostics,
  });

  if (!decodeResult.image) {
    return {
      detections: [],
      decodedImage: null,
      detectorResult: null,
      decodeError: decodeResult.error,
      steps,
      diagnostics: {
        decoderProvider: input.decoder.provider,
        decoderModel: input.decoder.model,
        detectorProvider: input.detector.provider.provider,
        detectorModel: input.detector.provider.model,
      },
    };
  }

  const detectorStartedAt = Date.now();
  const detectorResult = await input.detector.detect({
    run: input.run,
    photo: decodedImageToDetectorPhotoInput(decodeResult.image),
  });

  steps.push({
    step: "detect",
    status: "completed",
    durationMs: Date.now() - detectorStartedAt,
    diagnostics: detectorResult.diagnostics,
  });

  return {
    detections: detectorResult.detections,
    decodedImage: decodeResult.image,
    detectorResult,
    decodeError: null,
    steps,
    diagnostics: {
      decoderProvider: input.decoder.provider,
      decoderModel: input.decoder.model,
      detectorProvider: detectorResult.provider.provider,
      detectorModel: detectorResult.provider.model,
    },
  };
}

export function createSharpHeuristicDetectorPipeline(options: SharpHeuristicDetectorPipelineOptions = {}): {
  decoder: ImageDecoder;
  detector: PriceTagDetector;
} {
  return {
    decoder: createSharpImageDecoder(options.decoder),
    detector: createHeuristicPriceTagDetector(options.detector),
  };
}
