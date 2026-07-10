import sharp from "sharp";

import type {
  DecodedImagePixels,
  DecodedPixelFormat,
  EncodedImageInput,
  ImageDecodeError,
  ImageDecodeResult,
  ImageDecoder,
} from "./image-decoder";

export type SharpImageDecoderOptions = {
  /**
   * Output format expected by local detectors. RGBA is safest because it keeps alpha
   * and has a stable 4-channel byte layout.
   */
  pixelFormat?: DecodedPixelFormat;
  /** Apply image metadata orientation before extracting raw pixels. */
  autoOrient?: boolean;
  /** Optional sharp/libvips input pixel guard. Leave null to use sharp defaults. */
  limitInputPixels?: number | boolean | null;
};

const DEFAULT_OPTIONS: Required<Omit<SharpImageDecoderOptions, "limitInputPixels">> & Pick<SharpImageDecoderOptions, "limitInputPixels"> = {
  pixelFormat: "rgba",
  autoOrient: true,
  limitInputPixels: null,
};

export function createSharpImageDecoder(options: SharpImageDecoderOptions = {}): ImageDecoder {
  return new SharpImageDecoder(options);
}

export class SharpImageDecoder implements ImageDecoder {
  readonly provider = "sharp";
  readonly model = "sharp-image-decoder-v1";

  private readonly options: Required<Omit<SharpImageDecoderOptions, "limitInputPixels">> & Pick<SharpImageDecoderOptions, "limitInputPixels">;

  constructor(options: SharpImageDecoderOptions = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...normalizeOptions(options),
    };
  }

  async decode(input: EncodedImageInput): Promise<ImageDecodeResult> {
    try {
      let pipeline = sharp(input.bytes, this.sharpInputOptions());
      const metadata = await pipeline.metadata();

      if (this.options.autoOrient) {
        pipeline = pipeline.rotate();
      }

      pipeline = convertToPixelFormat(pipeline, this.options.pixelFormat);

      const output = await pipeline.raw().toBuffer({ resolveWithObject: true });
      const pixelFormat = pixelFormatFromChannels(output.info.channels);

      if (!pixelFormat) {
        return failure("decode_failed", "Sharp returned an unsupported raw channel count.", input, {
          channels: output.info.channels,
          width: output.info.width,
          height: output.info.height,
          inputFormat: metadata.format,
        });
      }

      const image: DecodedImagePixels = {
        bytes: new Uint8Array(output.data),
        dimensions: {
          width: output.info.width,
          height: output.info.height,
        },
        pixelFormat,
        filename: emptyToNull(input.filename),
        contentType: rawContentType(pixelFormat),
        storagePath: emptyToNull(input.storagePath),
        decoderProvider: this.provider,
        decoderModel: this.model,
        diagnostics: {
          source: "sharp",
          inputByteLength: input.bytes.byteLength,
          inputContentType: normalizeContentType(input.contentType),
          inputFormat: metadata.format ?? null,
          outputChannels: output.info.channels,
          outputSize: output.info.size,
          autoOrient: this.options.autoOrient,
        },
      };

      return { image, error: null };
    } catch (error) {
      return failure("decode_failed", readableErrorMessage(error), input);
    }
  }

  private sharpInputOptions(): sharp.SharpOptions | undefined {
    if (this.options.limitInputPixels === null) return undefined;
    return { limitInputPixels: this.options.limitInputPixels };
  }
}

function convertToPixelFormat(pipeline: sharp.Sharp, pixelFormat: DecodedPixelFormat): sharp.Sharp {
  if (pixelFormat === "grayscale") return pipeline.grayscale();
  if (pixelFormat === "rgb") return pipeline.removeAlpha();
  return pipeline.ensureAlpha();
}

function pixelFormatFromChannels(channels: number): DecodedPixelFormat | null {
  if (channels === 1) return "grayscale";
  if (channels === 3) return "rgb";
  if (channels === 4) return "rgba";
  return null;
}

function normalizeOptions(options: SharpImageDecoderOptions): SharpImageDecoderOptions {
  return {
    pixelFormat: normalizePixelFormat(options.pixelFormat),
    autoOrient: typeof options.autoOrient === "boolean" ? options.autoOrient : undefined,
    limitInputPixels: normalizeLimitInputPixels(options.limitInputPixels),
  };
}

function normalizePixelFormat(value?: DecodedPixelFormat): DecodedPixelFormat | undefined {
  return value === "grayscale" || value === "rgb" || value === "rgba" ? value : undefined;
}

function normalizeLimitInputPixels(value?: number | boolean | null): number | boolean | null | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

function failure(
  code: ImageDecodeError["code"],
  message: string,
  input: EncodedImageInput,
  diagnostics: Record<string, unknown> = {},
): ImageDecodeResult {
  return {
    image: null,
    error: {
      code,
      message,
      diagnostics: {
        ...diagnostics,
        decoderProvider: "sharp",
        decoderModel: "sharp-image-decoder-v1",
        byteLength: input.bytes.byteLength,
        filename: emptyToNull(input.filename),
        contentType: normalizeContentType(input.contentType),
        storagePath: emptyToNull(input.storagePath),
      },
    },
  };
}

function rawContentType(pixelFormat: DecodedPixelFormat): string {
  return `application/x-pricevision-raw-${pixelFormat}`;
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

function readableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Sharp image decode failed.";
}
