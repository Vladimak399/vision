import type { CropBBox, ImageDimensions } from "./crop-generator";
import type { DecodedImagePixels, DecodedPixelFormat } from "./image-decoder";
import type { EvidenceDraft, PriceCaptureRunContext } from "./evidence-contract";
import type { LocalOcrEngine, LocalOcrResult } from "./local-ocr";
import type { OcrInput, PriceCapturePhotoInput, PriceTagDetection } from "./local-pipeline";

export type OcrCropImage = {
  bytes: Uint8Array;
  dimensions: ImageDimensions;
  pixelFormat: DecodedPixelFormat;
  sourceBBox: CropBBox;
  itemId: string;
  filename: string | null;
  contentType: string;
  storagePath: string | null;
  diagnostics: Record<string, unknown>;
};

export type OcrCropExtractionErrorCode =
  | "missing_decoded_image"
  | "invalid_image"
  | "invalid_crop"
  | "unsupported_pixel_format";

export type OcrCropExtractionError = {
  code: OcrCropExtractionErrorCode;
  message: string;
  diagnostics?: Record<string, unknown>;
};

export type OcrCropExtractionResult = {
  cropImage: OcrCropImage | null;
  error: OcrCropExtractionError | null;
};

export type OcrDraftItem = {
  detection: PriceTagDetection;
  draft: EvidenceDraft;
};

export type LocalOcrDraftItemResult = {
  itemId: string;
  detectionId: string | null;
  detection: PriceTagDetection;
  draft: EvidenceDraft;
  cropImage: OcrCropImage;
  ocr: LocalOcrResult;
};

export type SkippedLocalOcrDraftItem = {
  itemId: string;
  detectionId: string | null;
  reason: OcrCropExtractionErrorCode | "ocr_failed";
  errorMessage: string;
  diagnostics?: Record<string, unknown>;
};

export type LocalOcrDraftMetrics = {
  itemCount: number;
  processedCount: number;
  textResultCount: number;
  emptyResultCount: number;
  skippedCount: number;
  failedCount: number;
};

export type LocalOcrDraftRunResult = {
  items: LocalOcrDraftItemResult[];
  skipped: SkippedLocalOcrDraftItem[];
  metrics: LocalOcrDraftMetrics;
};

export type RunLocalOcrForDraftItemsInput = {
  run: PriceCaptureRunContext;
  decodedImage: DecodedImagePixels | null;
  items: OcrDraftItem[];
  ocr: LocalOcrEngine;
};

export function createOcrCropImage(
  decodedImage: DecodedImagePixels | null,
  draft: EvidenceDraft,
): OcrCropExtractionResult {
  if (!decodedImage) {
    return failure("missing_decoded_image", "Decoded image is required before OCR crop extraction.", {
      itemId: draft.itemId,
    });
  }

  const imageValidation = validateDecodedImage(decodedImage);
  if (imageValidation) return imageValidation;

  const bbox = normalizeCropBBox(draft.cropPlan?.bbox, decodedImage.dimensions);
  if (!bbox) {
    return failure("invalid_crop", "Evidence draft crop bbox is invalid or outside decoded image bounds.", {
      itemId: draft.itemId,
      cropBBox: draft.cropPlan?.bbox,
      imageDimensions: decodedImage.dimensions,
    });
  }

  const bytes = extractCropBytes(decodedImage, bbox);
  if (!bytes) {
    return failure("unsupported_pixel_format", "Decoded pixel format is not supported for OCR crop extraction.", {
      itemId: draft.itemId,
      pixelFormat: decodedImage.pixelFormat,
    });
  }

  const storagePath = draft.row.crop_storage_path ?? null;
  const filename = filenameFromPath(storagePath) ?? `${draft.itemId}.raw`;

  return {
    cropImage: {
      bytes,
      dimensions: { width: bbox.width, height: bbox.height },
      pixelFormat: decodedImage.pixelFormat,
      sourceBBox: bbox,
      itemId: draft.itemId,
      filename,
      contentType: rawPixelContentType(decodedImage.pixelFormat),
      storagePath,
      diagnostics: {
        itemId: draft.itemId,
        sourceImageDimensions: decodedImage.dimensions,
        sourceImageFilename: decodedImage.filename,
        sourceImageStoragePath: decodedImage.storagePath,
        cropStoragePath: storagePath,
        byteLength: bytes.byteLength,
      },
    },
    error: null,
  };
}

export function ocrCropImageToPhotoInput(cropImage: OcrCropImage): PriceCapturePhotoInput {
  return {
    bytes: cropImage.bytes,
    dimensions: cropImage.dimensions,
    storagePath: cropImage.storagePath,
    filename: cropImage.filename,
  };
}

export function buildOcrInputFromCropImage(input: {
  run: PriceCaptureRunContext;
  detection: PriceTagDetection;
  draft: EvidenceDraft;
  cropImage: OcrCropImage;
}): OcrInput {
  return {
    run: input.run,
    photo: ocrCropImageToPhotoInput(input.cropImage),
    detection: input.detection,
    crop: input.draft.cropPlan,
  };
}

export async function runLocalOcrForDraftItems(
  input: RunLocalOcrForDraftItemsInput,
): Promise<LocalOcrDraftRunResult> {
  const items: LocalOcrDraftItemResult[] = [];
  const skipped: SkippedLocalOcrDraftItem[] = [];

  for (const item of input.items) {
    const extraction = createOcrCropImage(input.decodedImage, item.draft);
    if (!extraction.cropImage) {
      skipped.push({
        itemId: item.draft.itemId,
        detectionId: emptyToNull(item.detection.id),
        reason: extraction.error?.code ?? "invalid_crop",
        errorMessage: extraction.error?.message ?? "OCR crop extraction failed.",
        diagnostics: extraction.error?.diagnostics,
      });
      continue;
    }

    try {
      const ocrInput = buildOcrInputFromCropImage({
        run: input.run,
        detection: item.detection,
        draft: item.draft,
        cropImage: extraction.cropImage,
      });
      const ocr = await input.ocr.recognize(ocrInput);
      items.push({
        itemId: item.draft.itemId,
        detectionId: emptyToNull(item.detection.id),
        detection: item.detection,
        draft: item.draft,
        cropImage: extraction.cropImage,
        ocr,
      });
    } catch (error) {
      skipped.push({
        itemId: item.draft.itemId,
        detectionId: emptyToNull(item.detection.id),
        reason: "ocr_failed",
        errorMessage: readableErrorMessage(error),
      });
    }
  }

  return {
    items,
    skipped,
    metrics: {
      itemCount: input.items.length,
      processedCount: items.length,
      textResultCount: items.filter((item) => !item.ocr.isEmpty).length,
      emptyResultCount: items.filter((item) => item.ocr.isEmpty).length,
      skippedCount: skipped.length,
      failedCount: skipped.filter((item) => item.reason === "ocr_failed").length,
    },
  };
}

function extractCropBytes(image: DecodedImagePixels, bbox: CropBBox): Uint8Array | null {
  const channels = channelCount(image.pixelFormat);
  if (!channels) return null;

  const cropBytes = new Uint8Array(bbox.width * bbox.height * channels);
  const cropRowByteLength = bbox.width * channels;

  for (let row = 0; row < bbox.height; row += 1) {
    const sourceOffset = ((bbox.y + row) * image.dimensions.width + bbox.x) * channels;
    const targetOffset = row * cropRowByteLength;
    cropBytes.set(image.bytes.subarray(sourceOffset, sourceOffset + cropRowByteLength), targetOffset);
  }

  return cropBytes;
}

function validateDecodedImage(image: DecodedImagePixels): OcrCropExtractionResult | null {
  const width = positiveInteger(image.dimensions.width);
  const height = positiveInteger(image.dimensions.height);
  if (!width || !height) {
    return failure("invalid_image", "Decoded image dimensions must be positive integers.", {
      dimensions: image.dimensions,
    });
  }

  const channels = channelCount(image.pixelFormat);
  if (!channels) {
    return failure("unsupported_pixel_format", "Decoded image pixel format is unsupported.", {
      pixelFormat: image.pixelFormat,
    });
  }

  const expectedByteLength = width * height * channels;
  if (image.bytes.byteLength !== expectedByteLength) {
    return failure("invalid_image", "Decoded image byte length does not match dimensions and pixel format.", {
      byteLength: image.bytes.byteLength,
      expectedByteLength,
      dimensions: image.dimensions,
      pixelFormat: image.pixelFormat,
    });
  }

  return null;
}

function normalizeCropBBox(value: CropBBox | undefined, dimensions: ImageDimensions): CropBBox | null {
  if (!value) return null;
  if (![value.x, value.y, value.width, value.height].every((part) => Number.isFinite(part))) return null;

  const x = Math.floor(value.x);
  const y = Math.floor(value.y);
  const width = Math.floor(value.width);
  const height = Math.floor(value.height);

  if (width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0) return null;
  if (x + width > dimensions.width || y + height > dimensions.height) return null;

  return { x, y, width, height };
}

function failure(
  code: OcrCropExtractionErrorCode,
  message: string,
  diagnostics?: Record<string, unknown>,
): OcrCropExtractionResult {
  return {
    cropImage: null,
    error: { code, message, diagnostics },
  };
}

function channelCount(pixelFormat: DecodedPixelFormat): 1 | 3 | 4 | null {
  if (pixelFormat === "grayscale") return 1;
  if (pixelFormat === "rgb") return 3;
  if (pixelFormat === "rgba") return 4;
  return null;
}

function rawPixelContentType(pixelFormat: DecodedPixelFormat): string {
  return `application/x-pricevision-raw-${pixelFormat}`;
}

function filenameFromPath(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]+/g);
  return parts[parts.length - 1] || null;
}

function positiveInteger(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const integer = Math.floor(value);
  return integer > 0 ? integer : null;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function readableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "OCR recognition failed.";
}
