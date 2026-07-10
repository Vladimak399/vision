import { buildCropStoragePath, createCropPlan, serializeCropEvidence, type CropBBox, type CropPaddingOptions, type CropPlan, type ImageDimensions } from "./crop-generator";

export type PriceCaptureRunContext = {
  companyId: string;
  storeId: string;
  week: 1 | 2;
  runId: string;
  photoStoragePath?: string | null;
  photoFilename?: string | null;
  capturedDate?: string | null;
};

export type DetectorCandidate = {
  itemId: string;
  bbox: CropBBox;
  provider: string;
  model: string;
  confidence: number;
};

export type OcrCandidate = {
  provider?: string | null;
  model?: string | null;
  text?: string | null;
  confidence?: number | null;
};

export type ProductTextCandidate = {
  rawName?: string | null;
  brand?: string | null;
  sizeText?: string | null;
  priceTagText?: string | null;
  productVisibleText?: string | null;
  normalizedProductText?: string | null;
};

export type ParsedPriceCandidate = {
  priceMinor?: number | null;
  oldPriceMinor?: number | null;
  promoPriceMinor?: number | null;
  currency?: string | null;
  confidence?: number | null;
};

export type BuildEvidenceDraftInput = {
  run: PriceCaptureRunContext;
  image: ImageDimensions;
  detector: DetectorCandidate;
  cropPadding?: CropPaddingOptions;
  cropExtension?: string | null;
  ocr?: OcrCandidate | null;
  productText?: ProductTextCandidate | null;
  parsedPrice?: ParsedPriceCandidate | null;
};

export type CompetitorShelfItemEvidenceRow = {
  company_id: string;
  store_id: string;
  week: 1 | 2;
  processing_run_id: string;

  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string;
  price_tag_text: string | null;
  product_visible_text: string | null;

  confidence: number;
  photo_storage_path: string | null;
  photo_filename: string | null;
  captured_date: string | null;

  bbox: CropBBox;
  crop_storage_path: string;
  crop_width: number;
  crop_height: number;

  detector_provider: string;
  detector_model: string;
  detector_confidence: number;

  ocr_provider: string | null;
  ocr_model: string | null;
  ocr_text: string | null;
  ocr_confidence: number | null;

  parsed_price_confidence: number | null;
  normalized_product_text: string | null;

  review_status: "pending";
  review_reason: string;
  ai_used: false;
};

export type EvidenceDraft = {
  itemId: string;
  cropPlan: CropPlan;
  row: CompetitorShelfItemEvidenceRow;
};

const DEFAULT_CURRENCY = "RUB";
const DEFAULT_REVIEW_REASON = "awaiting_local_ocr_or_match";

export function buildCompetitorShelfItemEvidenceDraft(input: BuildEvidenceDraftInput): EvidenceDraft | null {
  const cropPlan = createCropPlan({
    image: input.image,
    bbox: input.detector.bbox,
    padding: input.cropPadding,
  });

  if (!cropPlan) return null;

  const cropEvidence = serializeCropEvidence(cropPlan);
  const cropStoragePath = buildCropStoragePath({
    companyId: input.run.companyId,
    runId: input.run.runId,
    itemId: input.detector.itemId,
    sourceFilename: input.run.photoFilename,
    extension: input.cropExtension,
  });

  const ocr = input.ocr ?? null;
  const productText = input.productText ?? null;
  const parsedPrice = input.parsedPrice ?? null;
  const rawName = normalizeRawName(productText?.rawName, ocr?.text);
  const confidence = clampConfidence(input.detector.confidence);

  return {
    itemId: input.detector.itemId,
    cropPlan,
    row: {
      company_id: input.run.companyId,
      store_id: input.run.storeId,
      week: input.run.week,
      processing_run_id: input.run.runId,

      raw_name: rawName,
      brand: emptyToNull(productText?.brand),
      size_text: emptyToNull(productText?.sizeText),
      price_minor: toNullableInteger(parsedPrice?.priceMinor),
      old_price_minor: toNullableInteger(parsedPrice?.oldPriceMinor),
      promo_price_minor: toNullableInteger(parsedPrice?.promoPriceMinor),
      currency: normalizeCurrency(parsedPrice?.currency),
      price_tag_text: emptyToNull(productText?.priceTagText),
      product_visible_text: emptyToNull(productText?.productVisibleText),

      confidence,
      photo_storage_path: emptyToNull(input.run.photoStoragePath),
      photo_filename: emptyToNull(input.run.photoFilename),
      captured_date: emptyToNull(input.run.capturedDate),

      bbox: cropEvidence.bbox,
      crop_storage_path: cropStoragePath,
      crop_width: cropEvidence.crop_width,
      crop_height: cropEvidence.crop_height,

      detector_provider: input.detector.provider,
      detector_model: input.detector.model,
      detector_confidence: confidence,

      ocr_provider: emptyToNull(ocr?.provider),
      ocr_model: emptyToNull(ocr?.model),
      ocr_text: emptyToNull(ocr?.text),
      ocr_confidence: clampNullableConfidence(ocr?.confidence),

      parsed_price_confidence: clampNullableConfidence(parsedPrice?.confidence),
      normalized_product_text: emptyToNull(productText?.normalizedProductText),

      review_status: "pending",
      review_reason: DEFAULT_REVIEW_REASON,
      ai_used: false,
    },
  };
}

function normalizeRawName(rawName?: string | null, ocrText?: string | null): string {
  return emptyToNull(rawName) ?? emptyToNull(ocrText) ?? "unknown";
}

function normalizeCurrency(value?: string | null): string {
  const normalized = emptyToNull(value)?.toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : DEFAULT_CURRENCY;
}

function toNullableInteger(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function clampNullableConfidence(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return clampConfidence(value);
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
