import type { CropBBox, ImageDimensions } from "./crop-generator";

export const OCR_CROP_PREPROCESS_DEFAULTS = {
  minSourceWidthForOcr: 160,
  minSourceHeightForOcr: 40,
  minOcrWidth: 320,
  minOcrHeight: 80,
  paddingPx: 12,
  maxUpscaleFactor: 6,
  panelExpansionEnabled: true,
  panelWidthMultiplier: 4,
  panelHeightMultiplier: 8,
  panelMinWidth: 260,
  panelMinHeight: 110,
  panelUpwardBias: 0.68,
} as const;

export type OcrCropPreprocessOptions = {
  minSourceWidthForOcr?: number | null;
  minSourceHeightForOcr?: number | null;
  minOcrWidth?: number | null;
  minOcrHeight?: number | null;
  paddingPx?: number | null;
  maxUpscaleFactor?: number | null;
  panelExpansionEnabled?: boolean | null;
  panelWidthMultiplier?: number | null;
  panelHeightMultiplier?: number | null;
  panelMinWidth?: number | null;
  panelMinHeight?: number | null;
  panelUpwardBias?: number | null;
  dumpCrops?: boolean | null;
  cropDumpDir?: string | null;
  sourceImageStem?: string | null;
};

export type OcrCropExpansionMode = "padding_only" | "price_tag_panel";

export type OcrCropPreprocessPlan = {
  originalBBox: CropBBox;
  expandedBBox: CropBBox;
  originalWidth: number;
  originalHeight: number;
  expandedWidth: number;
  expandedHeight: number;
  ocrInputWidth: number;
  ocrInputHeight: number;
  upscaleFactor: number;
  paddingPx: number;
  expansionMode: OcrCropExpansionMode;
  panelExpansionEnabled: boolean;
  panelUpwardBias: number;
  isProbablyTooSmallForOcr: boolean;
  wasExpanded: boolean;
  wasUpscaled: boolean;
  reviewReason: "detected_bbox_too_small_for_ocr" | null;
  imageDimensions: ImageDimensions;
};

export function buildOcrCropPreprocessPlan(input: {
  imageDimensions: ImageDimensions;
  originalBBox: CropBBox;
  options?: OcrCropPreprocessOptions | null;
}): OcrCropPreprocessPlan {
  const options = normalizeOptions(input.options);
  const imageDimensions = normalizeDimensions(input.imageDimensions);
  const originalBBox = normalizeBBox(input.originalBBox, imageDimensions);
  const isProbablyTooSmallForOcr = originalBBox.width < options.minSourceWidthForOcr
    || originalBBox.height < options.minSourceHeightForOcr;
  const expansionMode: OcrCropExpansionMode = options.panelExpansionEnabled && isProbablyTooSmallForOcr
    ? "price_tag_panel"
    : "padding_only";
  const expandedBBox = expansionMode === "price_tag_panel"
    ? expandBBoxAsPriceTagPanel({ bbox: originalBBox, dimensions: imageDimensions, options })
    : expandBBoxAroundCenter({
        bbox: originalBBox,
        dimensions: imageDimensions,
        targetWidth: Math.max(originalBBox.width + options.paddingPx * 2, options.minSourceWidthForOcr),
        targetHeight: Math.max(originalBBox.height + options.paddingPx * 2, options.minSourceHeightForOcr),
      });
  const upscaleFactor = computeUpscaleFactor({
    width: expandedBBox.width,
    height: expandedBBox.height,
    minWidth: options.minOcrWidth,
    minHeight: options.minOcrHeight,
    maxUpscaleFactor: options.maxUpscaleFactor,
  });

  return {
    originalBBox,
    expandedBBox,
    originalWidth: originalBBox.width,
    originalHeight: originalBBox.height,
    expandedWidth: expandedBBox.width,
    expandedHeight: expandedBBox.height,
    ocrInputWidth: Math.max(1, Math.round(expandedBBox.width * upscaleFactor)),
    ocrInputHeight: Math.max(1, Math.round(expandedBBox.height * upscaleFactor)),
    upscaleFactor,
    paddingPx: options.paddingPx,
    expansionMode,
    panelExpansionEnabled: options.panelExpansionEnabled,
    panelUpwardBias: options.panelUpwardBias,
    isProbablyTooSmallForOcr,
    wasExpanded: !sameBBox(originalBBox, expandedBBox),
    wasUpscaled: upscaleFactor > 1,
    reviewReason: isProbablyTooSmallForOcr ? "detected_bbox_too_small_for_ocr" : null,
    imageDimensions,
  };
}

function normalizeOptions(options?: OcrCropPreprocessOptions | null) {
  return {
    minSourceWidthForOcr: positiveInteger(options?.minSourceWidthForOcr, OCR_CROP_PREPROCESS_DEFAULTS.minSourceWidthForOcr),
    minSourceHeightForOcr: positiveInteger(options?.minSourceHeightForOcr, OCR_CROP_PREPROCESS_DEFAULTS.minSourceHeightForOcr),
    minOcrWidth: positiveInteger(options?.minOcrWidth, OCR_CROP_PREPROCESS_DEFAULTS.minOcrWidth),
    minOcrHeight: positiveInteger(options?.minOcrHeight, OCR_CROP_PREPROCESS_DEFAULTS.minOcrHeight),
    paddingPx: nonNegativeInteger(options?.paddingPx, OCR_CROP_PREPROCESS_DEFAULTS.paddingPx),
    maxUpscaleFactor: positiveInteger(options?.maxUpscaleFactor, OCR_CROP_PREPROCESS_DEFAULTS.maxUpscaleFactor),
    panelExpansionEnabled: options?.panelExpansionEnabled ?? OCR_CROP_PREPROCESS_DEFAULTS.panelExpansionEnabled,
    panelWidthMultiplier: positiveNumber(options?.panelWidthMultiplier, OCR_CROP_PREPROCESS_DEFAULTS.panelWidthMultiplier),
    panelHeightMultiplier: positiveNumber(options?.panelHeightMultiplier, OCR_CROP_PREPROCESS_DEFAULTS.panelHeightMultiplier),
    panelMinWidth: positiveInteger(options?.panelMinWidth, OCR_CROP_PREPROCESS_DEFAULTS.panelMinWidth),
    panelMinHeight: positiveInteger(options?.panelMinHeight, OCR_CROP_PREPROCESS_DEFAULTS.panelMinHeight),
    panelUpwardBias: unitFloat(options?.panelUpwardBias, OCR_CROP_PREPROCESS_DEFAULTS.panelUpwardBias),
  };
}

function expandBBoxAsPriceTagPanel(input: {
  bbox: CropBBox;
  dimensions: ImageDimensions;
  options: ReturnType<typeof normalizeOptions>;
}): CropBBox {
  const targetWidth = Math.max(
    input.bbox.width + input.options.paddingPx * 2,
    Math.round(input.bbox.width * input.options.panelWidthMultiplier),
    input.options.panelMinWidth,
    input.options.minSourceWidthForOcr,
  );
  const targetHeight = Math.max(
    input.bbox.height + input.options.paddingPx * 2,
    Math.round(input.bbox.height * input.options.panelHeightMultiplier),
    input.options.panelMinHeight,
    input.options.minSourceHeightForOcr,
  );
  return expandBBoxWithVerticalBias({
    bbox: input.bbox,
    dimensions: input.dimensions,
    targetWidth,
    targetHeight,
    upwardBias: input.options.panelUpwardBias,
  });
}

function expandBBoxWithVerticalBias(input: {
  bbox: CropBBox;
  dimensions: ImageDimensions;
  targetWidth: number;
  targetHeight: number;
  upwardBias: number;
}): CropBBox {
  const width = Math.min(input.dimensions.width, Math.max(1, Math.floor(input.targetWidth)));
  const height = Math.min(input.dimensions.height, Math.max(1, Math.floor(input.targetHeight)));
  const centerX = input.bbox.x + input.bbox.width / 2;
  const topGrowth = Math.max(0, height - input.bbox.height) * input.upwardBias;
  const x = clamp(Math.round(centerX - width / 2), 0, input.dimensions.width - width);
  const y = clamp(Math.round(input.bbox.y - topGrowth), 0, input.dimensions.height - height);
  return { x, y, width, height };
}

function expandBBoxAroundCenter(input: {
  bbox: CropBBox;
  dimensions: ImageDimensions;
  targetWidth: number;
  targetHeight: number;
}): CropBBox {
  const width = Math.min(input.dimensions.width, Math.max(1, Math.floor(input.targetWidth)));
  const height = Math.min(input.dimensions.height, Math.max(1, Math.floor(input.targetHeight)));
  const centerX = input.bbox.x + input.bbox.width / 2;
  const centerY = input.bbox.y + input.bbox.height / 2;
  const x = clamp(Math.round(centerX - width / 2), 0, input.dimensions.width - width);
  const y = clamp(Math.round(centerY - height / 2), 0, input.dimensions.height - height);
  return { x, y, width, height };
}

function computeUpscaleFactor(input: {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  maxUpscaleFactor: number;
}): number {
  const required = Math.max(
    input.minWidth / Math.max(1, input.width),
    input.minHeight / Math.max(1, input.height),
    1,
  );
  return Math.min(Math.ceil(required), input.maxUpscaleFactor);
}

function normalizeBBox(value: CropBBox, dimensions: ImageDimensions): CropBBox {
  const x = clamp(Math.floor(value.x), 0, dimensions.width - 1);
  const y = clamp(Math.floor(value.y), 0, dimensions.height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.min(Math.floor(value.width), dimensions.width - x)),
    height: Math.max(1, Math.min(Math.floor(value.height), dimensions.height - y)),
  };
}

function normalizeDimensions(value: ImageDimensions): ImageDimensions {
  return {
    width: Math.max(1, Math.floor(value.width)),
    height: Math.max(1, Math.floor(value.height)),
  };
}

function positiveInteger(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
}

function positiveNumber(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function unitFloat(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, 0), 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sameBBox(left: CropBBox, right: CropBBox): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}
