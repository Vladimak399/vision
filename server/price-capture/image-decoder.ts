import type { ImageDimensions } from "./crop-generator";
import type { PriceCapturePhotoInput } from "./local-pipeline";

export type DecodedPixelFormat = "grayscale" | "rgb" | "rgba";

export type EncodedImageInput = {
  bytes: Uint8Array;
  filename?: string | null;
  contentType?: string | null;
  storagePath?: string | null;
};

export type RawPixelImageInput = EncodedImageInput & {
  dimensions: ImageDimensions;
  pixelFormat: DecodedPixelFormat;
};

export type DecodedImagePixels = {
  bytes: Uint8Array;
  dimensions: ImageDimensions;
  pixelFormat: DecodedPixelFormat;
  filename: string | null;
  contentType: string | null;
  storagePath: string | null;
  decoderProvider: string;
  decoderModel: string;
  diagnostics?: Record<string, unknown>;
};

export type ImageDecodeResult = {
  image: DecodedImagePixels | null;
  error: ImageDecodeError | null;
};

export type ImageDecodeErrorCode =
  | "invalid_dimensions"
  | "invalid_raw_pixel_length"
  | "unsupported_encoded_image"
  | "decode_failed";

export type ImageDecodeError = {
  code: ImageDecodeErrorCode;
  message: string;
  diagnostics?: Record<string, unknown>;
};

export interface ImageDecoder {
  readonly provider: string;
  readonly model: string;
  decode(input: EncodedImageInput): Promise<ImageDecodeResult>;
}

export function createRawPixelDecodedImage(input: RawPixelImageInput): ImageDecodeResult {
  const width = toPositiveInteger(input.dimensions.width);
  const height = toPositiveInteger(input.dimensions.height);

  if (!width || !height) {
    return failure("invalid_dimensions", "Raw pixel image dimensions must be positive integers.", {
      width: input.dimensions.width,
      height: input.dimensions.height,
    });
  }

  const expectedLength = expectedByteLength(width, height, input.pixelFormat);
  if (input.bytes.byteLength !== expectedLength) {
    return failure("invalid_raw_pixel_length", "Raw pixel buffer length does not match dimensions and pixel format.", {
      byteLength: input.bytes.byteLength,
      expectedLength,
      width,
      height,
      pixelFormat: input.pixelFormat,
    });
  }

  return {
    image: {
      bytes: input.bytes,
      dimensions: { width, height },
      pixelFormat: input.pixelFormat,
      filename: emptyToNull(input.filename),
      contentType: normalizeContentType(input.contentType) ?? rawContentType(input.pixelFormat),
      storagePath: emptyToNull(input.storagePath),
      decoderProvider: "local",
      decoderModel: "raw-pixel-boundary-v1",
      diagnostics: {
        source: "raw_pixels",
        byteLength: input.bytes.byteLength,
      },
    },
    error: null,
  };
}

export function decodedImageToDetectorPhotoInput(image: DecodedImagePixels): PriceCapturePhotoInput {
  return {
    bytes: image.bytes,
    dimensions: image.dimensions,
    storagePath: image.storagePath,
    filename: image.filename,
  };
}

export function createUnsupportedEncodedImageDecoder(): ImageDecoder {
  return new UnsupportedEncodedImageDecoder();
}

export class UnsupportedEncodedImageDecoder implements ImageDecoder {
  readonly provider = "local";
  readonly model = "unsupported-encoded-image-boundary-v1";

  async decode(input: EncodedImageInput): Promise<ImageDecodeResult> {
    return failure("unsupported_encoded_image", "Encoded image decoding is not implemented in the local boundary adapter.", {
      byteLength: input.bytes.byteLength,
      filename: emptyToNull(input.filename),
      contentType: normalizeContentType(input.contentType),
      storagePath: emptyToNull(input.storagePath),
      nextStep: "Implement a separate decoder adapter, for example sharp/jimp/canvas/worker, without changing detector contracts.",
    });
  }
}

function expectedByteLength(width: number, height: number, pixelFormat: DecodedPixelFormat): number {
  const channels = pixelFormat === "grayscale" ? 1 : pixelFormat === "rgb" ? 3 : 4;
  return width * height * channels;
}

function rawContentType(pixelFormat: DecodedPixelFormat): string {
  return `application/x-pricevision-raw-${pixelFormat}`;
}

function failure(code: ImageDecodeErrorCode, message: string, diagnostics?: Record<string, unknown>): ImageDecodeResult {
  return {
    image: null,
    error: {
      code,
      message,
      diagnostics,
    },
  };
}

function normalizeContentType(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("/") ? normalized : null;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function toPositiveInteger(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const integer = Math.floor(value);
  return integer > 0 ? integer : null;
}
