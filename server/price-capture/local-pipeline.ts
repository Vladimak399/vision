import type { CatalogMatchCandidate, CatalogMatchProduct } from "../catalog-matching";
import type { CropBBox, ImageDimensions } from "./crop-generator";
import type {
  BuildEvidenceDraftInput,
  EvidenceDraft,
  ParsedPriceCandidate,
  PriceCaptureRunContext,
  ProductTextCandidate,
} from "./evidence-contract";

export type PriceCapturePhotoInput = {
  bytes: Uint8Array;
  dimensions: ImageDimensions;
  storagePath?: string | null;
  filename?: string | null;
  sha256?: string | null;
};

export type PipelineProviderInfo = {
  provider: string;
  model: string;
  version?: string | null;
};

export type PriceTagDetection = {
  id: string;
  bbox: CropBBox;
  confidence: number;
  provider: string;
  model: string;
  label?: string | null;
};

export type PriceTagDetectorInput = {
  run: PriceCaptureRunContext;
  photo: PriceCapturePhotoInput;
};

export type PriceTagDetectorResult = {
  detections: PriceTagDetection[];
  provider: PipelineProviderInfo;
  diagnostics?: Record<string, unknown>;
};

export type OcrInput = {
  run: PriceCaptureRunContext;
  photo: PriceCapturePhotoInput;
  detection: PriceTagDetection;
  crop: EvidenceDraft["cropPlan"];
};

export type OcrResult = {
  text: string;
  confidence: number | null;
  provider: string;
  model: string;
  diagnostics?: Record<string, unknown>;
};

export type PriceParserInput = {
  run: PriceCaptureRunContext;
  detection: PriceTagDetection;
  ocr: OcrResult | null;
};

export type PriceParserResult = ParsedPriceCandidate & {
  diagnostics?: Record<string, unknown>;
};

export type ProductTextExtractorInput = {
  run: PriceCaptureRunContext;
  detection: PriceTagDetection;
  ocr: OcrResult | null;
  parsedPrice: PriceParserResult | null;
};

export type ProductTextExtractorResult = ProductTextCandidate & {
  diagnostics?: Record<string, unknown>;
};

export type ProductMatcherInput = {
  run: PriceCaptureRunContext;
  productText: ProductTextCandidate;
  parsedPrice: ParsedPriceCandidate | null;
  catalog: CatalogMatchProduct[];
};

export type ProductMatcherResult = {
  candidates: CatalogMatchCandidate[];
  selectedCatalogProductId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  reviewRequired: boolean;
};

export type EvidenceWriterInput = {
  run: PriceCaptureRunContext;
  draft: EvidenceDraft;
  match: ProductMatcherResult | null;
};

export type EvidenceWriteResult = {
  itemId: string;
  rowId: string | null;
  cropStoragePath: string;
  reviewRequired: boolean;
};

export interface PriceTagDetector {
  readonly provider: PipelineProviderInfo;
  detect(input: PriceTagDetectorInput): Promise<PriceTagDetectorResult>;
}

export interface OcrEngine {
  readonly provider: PipelineProviderInfo;
  recognize(input: OcrInput): Promise<OcrResult>;
}

export interface PriceParser {
  parse(input: PriceParserInput): Promise<PriceParserResult | null>;
}

export interface ProductTextExtractor {
  extract(input: ProductTextExtractorInput): Promise<ProductTextExtractorResult>;
}

export interface ProductMatcher {
  match(input: ProductMatcherInput): Promise<ProductMatcherResult>;
}

export interface EvidenceWriter {
  write(input: EvidenceWriterInput): Promise<EvidenceWriteResult>;
}

export type LocalPriceCapturePipeline = {
  detector: PriceTagDetector;
  ocr: OcrEngine;
  priceParser: PriceParser;
  productTextExtractor: ProductTextExtractor;
  productMatcher: ProductMatcher;
  evidenceWriter: EvidenceWriter;
};

export type PipelineStepStatus = "pending" | "skipped" | "completed" | "failed";

export type PipelineStepReport = {
  step: "detect" | "crop" | "ocr" | "parse_price" | "extract_product_text" | "match" | "write_evidence";
  status: PipelineStepStatus;
  durationMs?: number | null;
  errorMessage?: string | null;
  diagnostics?: Record<string, unknown>;
};

export type LocalPipelineItemResult = {
  detection: PriceTagDetection;
  draft: EvidenceDraft | null;
  ocr: OcrResult | null;
  parsedPrice: PriceParserResult | null;
  productText: ProductTextExtractorResult | null;
  match: ProductMatcherResult | null;
  write: EvidenceWriteResult | null;
  steps: PipelineStepReport[];
};

export type LocalPipelineRunResult = {
  runId: string;
  detectedCount: number;
  writtenCount: number;
  needsReviewCount: number;
  unmatchedCount: number;
  aiCallsCount: 0;
  aiCostMicrousd: 0;
  items: LocalPipelineItemResult[];
  steps: PipelineStepReport[];
};

export function createInitialLocalPipelineRunResult(runId: string): LocalPipelineRunResult {
  return {
    runId,
    detectedCount: 0,
    writtenCount: 0,
    needsReviewCount: 0,
    unmatchedCount: 0,
    aiCallsCount: 0,
    aiCostMicrousd: 0,
    items: [],
    steps: [],
  };
}

export function detectionToEvidenceDraftInput(input: {
  run: PriceCaptureRunContext;
  photo: PriceCapturePhotoInput;
  detection: PriceTagDetection;
  ocr?: OcrResult | null;
  productText?: ProductTextCandidate | null;
  parsedPrice?: ParsedPriceCandidate | null;
}): BuildEvidenceDraftInput {
  return {
    run: {
      ...input.run,
      photoStoragePath: input.run.photoStoragePath ?? input.photo.storagePath ?? null,
      photoFilename: input.run.photoFilename ?? input.photo.filename ?? null,
    },
    image: input.photo.dimensions,
    detector: {
      itemId: input.detection.id,
      bbox: input.detection.bbox,
      provider: input.detection.provider,
      model: input.detection.model,
      confidence: input.detection.confidence,
    },
    ocr: input.ocr ? {
      provider: input.ocr.provider,
      model: input.ocr.model,
      text: input.ocr.text,
      confidence: input.ocr.confidence,
    } : null,
    productText: input.productText ?? null,
    parsedPrice: input.parsedPrice ?? null,
  };
}
