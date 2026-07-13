import { buildDetectorOnlyRunReport, type DetectorOnlyRunReportDto } from "./detector-only-report";
import {
  createSharpHeuristicDetectorOnlyProcessor,
  type DetectorOnlyProcessingResult,
  type SharpHeuristicDetectorOnlyProcessor,
} from "./detector-only-orchestrator";
import type { DetectorEvidenceDraftOptions } from "./detector-evidence-drafts";
import type { DetectorRunContextInput } from "./detector-run-service";
import type { EncodedImageInput } from "./image-decoder";

export type DetectorOnlyApiByteInput = Uint8Array | ArrayBuffer | number[];

export type DetectorOnlyApiRequest = {
  companyId: string;
  storeId: string;
  week: 1 | 2;
  runId?: string | null;
  capturedDate?: string | null;
  photo: {
    bytes: DetectorOnlyApiByteInput;
    filename?: string | null;
    contentType?: string | null;
    storagePath?: string | null;
  };
  evidence?: DetectorEvidenceDraftOptions;
};

export type DetectorOnlyApiSuccessResponse = {
  ok: true;
  statusCode: 200;
  report: DetectorOnlyRunReportDto;
};

export type DetectorOnlyApiErrorCode =
  | "invalid_context"
  | "invalid_photo"
  | "processing_failed";

export type DetectorOnlyApiErrorResponse = {
  ok: false;
  statusCode: 400 | 422 | 500;
  error: {
    code: DetectorOnlyApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
};

export type DetectorOnlyApiResponse = DetectorOnlyApiSuccessResponse | DetectorOnlyApiErrorResponse;

export type DetectorOnlyApiHandlerOptions = {
  processor?: Pick<SharpHeuristicDetectorOnlyProcessor, "process">;
};

export async function handleDetectorOnlyApiRequest(
  request: DetectorOnlyApiRequest,
  options: DetectorOnlyApiHandlerOptions = {},
): Promise<DetectorOnlyApiResponse> {
  const contextResult = normalizeContext(request);
  if ("response" in contextResult) return contextResult.response;

  const photoResult = normalizePhoto(request.photo);
  if ("response" in photoResult) return photoResult.response;

  try {
    const processor = options.processor ?? createSharpHeuristicDetectorOnlyProcessor();
    const result = await processor.process({
      context: contextResult.context,
      image: photoResult.image,
      evidence: request.evidence,
    });

    return {
      ok: true,
      statusCode: 200,
      report: buildDetectorOnlyRunReport(result),
    };
  } catch (error) {
    return errorResponse(500, "processing_failed", "Detector-only processing failed.", {
      errorMessage: readableErrorMessage(error),
    });
  }
}

export function buildDetectorOnlyApiSuccessResponse(
  result: DetectorOnlyProcessingResult,
): DetectorOnlyApiSuccessResponse {
  return {
    ok: true,
    statusCode: 200,
    report: buildDetectorOnlyRunReport(result),
  };
}

function normalizeContext(request: DetectorOnlyApiRequest):
  | { ok: true; context: DetectorRunContextInput }
  | { ok: false; response: DetectorOnlyApiErrorResponse } {
  const companyId = emptyToNull(request.companyId);
  if (!companyId) return { ok: false, response: errorResponse(400, "invalid_context", "companyId is required.") };

  const storeId = emptyToNull(request.storeId);
  if (!storeId) return { ok: false, response: errorResponse(400, "invalid_context", "storeId is required.") };

  if (request.week !== 1 && request.week !== 2) {
    return { ok: false, response: errorResponse(400, "invalid_context", "week must be 1 or 2.", { week: request.week }) };
  }

  return {
    ok: true,
    context: {
      companyId,
      storeId,
      week: request.week,
      runId: emptyToNull(request.runId),
      capturedDate: emptyToNull(request.capturedDate),
      photoFilename: emptyToNull(request.photo?.filename),
      photoStoragePath: emptyToNull(request.photo?.storagePath),
    },
  };
}

function normalizePhoto(photo: DetectorOnlyApiRequest["photo"]):
  | { ok: true; image: EncodedImageInput }
  | { ok: false; response: DetectorOnlyApiErrorResponse } {
  if (!photo) return { ok: false, response: errorResponse(400, "invalid_photo", "photo is required.") };

  const bytes = normalizeBytes(photo.bytes);
  if (!bytes) {
    return {
      ok: false,
      response: errorResponse(422, "invalid_photo", "photo.bytes must be a non-empty Uint8Array, ArrayBuffer, or byte array."),
    };
  }

  return {
    ok: true,
    image: {
      bytes,
      filename: emptyToNull(photo.filename),
      contentType: normalizeContentType(photo.contentType),
      storagePath: emptyToNull(photo.storagePath),
    },
  };
}

function normalizeBytes(value: DetectorOnlyApiByteInput | undefined): Uint8Array | null {
  if (value instanceof Uint8Array) return value.byteLength > 0 ? value : null;

  if (value instanceof ArrayBuffer) {
    return value.byteLength > 0 ? new Uint8Array(value) : null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const bytes = new Uint8Array(value.length);
    for (const [index, byte] of value.entries()) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
      bytes[index] = byte;
    }
    return bytes;
  }

  return null;
}

function errorResponse(
  statusCode: DetectorOnlyApiErrorResponse["statusCode"],
  code: DetectorOnlyApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): DetectorOnlyApiErrorResponse {
  return {
    ok: false,
    statusCode,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}

function normalizeContentType(value?: string | null): string | null {
  const normalized = emptyToNull(value)?.toLowerCase();
  return normalized && normalized.includes("/") ? normalized : null;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function readableErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown processing error.";
}
