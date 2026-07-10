import type { CropBBox } from "./crop-generator";
import type {
  ExternalOcrWorkerClient,
  ExternalOcrWorkerRequest,
  ExternalOcrWorkerResponse,
} from "./external-ocr-worker";
import type { LocalOcrTextBlock } from "./local-ocr";
import type { PipelineProviderInfo } from "./local-pipeline";

export const HTTP_OCR_WORKER_PROVIDER: PipelineProviderInfo = {
  provider: "http-worker",
  model: "http-ocr-worker-client-v1",
  version: "PV-05-03",
};

export const OCR_WORKER_REQUEST_SCHEMA_VERSION = "pricevision-ocr-worker-request-v1";
export const OCR_WORKER_RESPONSE_SCHEMA_VERSION = "pricevision-ocr-worker-response-v1";

export type HttpOcrWorkerClientOptions = {
  url: string;
  provider?: PipelineProviderInfo;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type HttpOcrWorkerRequestBody = {
  schemaVersion: typeof OCR_WORKER_REQUEST_SCHEMA_VERSION;
  requestId: string;
  image: {
    bytesBase64: string;
    pixelFormat: "grayscale" | "rgb" | "rgba";
    width: number;
    height: number;
    filename: string | null;
    contentType: string | null;
  };
  context: {
    companyId: string;
    storeId: string;
    week: 1 | 2;
    runId: string;
    itemId: string;
    detectionId: string | null;
  };
  hints: {
    languages: string[];
  };
};

export type HttpOcrWorkerSuccessBody = {
  schemaVersion?: string;
  requestId?: string | null;
  ok: true;
  provider?: string | null;
  model?: string | null;
  text?: string | null;
  confidence?: number | null;
  blocks?: Array<Partial<LocalOcrTextBlock> | null | undefined> | null;
  diagnostics?: Record<string, unknown>;
};

export type HttpOcrWorkerErrorBody = {
  schemaVersion?: string;
  requestId?: string | null;
  ok: false;
  provider?: string | null;
  model?: string | null;
  error?: {
    code?: string | null;
    message?: string | null;
  } | null;
  text?: string | null;
  confidence?: number | null;
  blocks?: Array<Partial<LocalOcrTextBlock> | null | undefined> | null;
  diagnostics?: Record<string, unknown>;
};

export type HttpOcrWorkerResponseBody = HttpOcrWorkerSuccessBody | HttpOcrWorkerErrorBody;

const DEFAULT_TIMEOUT_MS = 30_000;

export function createHttpOcrWorkerClient(options: HttpOcrWorkerClientOptions): ExternalOcrWorkerClient {
  return new HttpOcrWorkerClient(options);
}

export class HttpOcrWorkerClient implements ExternalOcrWorkerClient {
  readonly provider: PipelineProviderInfo;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HttpOcrWorkerClientOptions) {
    this.url = normalizeWorkerUrl(options.url);
    this.provider = options.provider ?? HTTP_OCR_WORKER_PROVIDER;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  }

  async recognize(request: ExternalOcrWorkerRequest): Promise<ExternalOcrWorkerResponse> {
    const started = Date.now();
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;

    try {
      const body = buildHttpOcrWorkerRequestBody(request);
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });

      const parsed = await parseJsonResponse(response);
      return normalizeHttpOcrWorkerResponse(parsed, {
        requestId: request.requestId,
        httpStatus: response.status,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      return {
        ok: false,
        errorCode: error instanceof Error && error.name === "AbortError" ? "worker_timeout" : "worker_request_failed",
        errorMessage: error instanceof Error ? error.message : "HTTP OCR worker request failed.",
        diagnostics: {
          requestId: request.requestId,
          url: this.url,
          durationMs: Date.now() - started,
        },
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export function buildHttpOcrWorkerRequestBody(request: ExternalOcrWorkerRequest): HttpOcrWorkerRequestBody {
  return {
    schemaVersion: OCR_WORKER_REQUEST_SCHEMA_VERSION,
    requestId: request.requestId,
    image: {
      bytesBase64: uint8ArrayToBase64(request.image.bytes),
      pixelFormat: inferPixelFormat(request.image.byteLength, request.image.width, request.image.height),
      width: request.image.width,
      height: request.image.height,
      filename: request.image.filename,
      contentType: request.image.contentType,
    },
    context: {
      companyId: request.run.companyId,
      storeId: request.run.storeId,
      week: request.run.week,
      runId: request.run.runId,
      itemId: request.item.itemId,
      detectionId: request.item.detectionId,
    },
    hints: {
      languages: request.hints.languages,
    },
  };
}

export function normalizeHttpOcrWorkerResponse(
  body: HttpOcrWorkerResponseBody,
  diagnostics: { requestId: string; httpStatus: number; durationMs: number },
): ExternalOcrWorkerResponse {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      errorCode: "invalid_worker_response",
      errorMessage: "OCR worker response must be a JSON object.",
      diagnostics,
    };
  }

  if (body.schemaVersion && body.schemaVersion !== OCR_WORKER_RESPONSE_SCHEMA_VERSION) {
    return {
      ok: false,
      errorCode: "invalid_worker_schema",
      errorMessage: "Unsupported OCR worker response schemaVersion.",
      diagnostics: {
        ...diagnostics,
        schemaVersion: body.schemaVersion,
      },
    };
  }

  if (body.ok === false) {
    return {
      ok: false,
      errorCode: normalizeWorkerString(body.error?.code, "worker_error"),
      errorMessage: normalizeWorkerString(body.error?.message, "OCR worker failed."),
      diagnostics: {
        ...diagnostics,
        requestIdFromWorker: body.requestId ?? null,
        ...body.diagnostics,
      },
    };
  }

  if (body.ok !== true) {
    return {
      ok: false,
      errorCode: "invalid_worker_response",
      errorMessage: "OCR worker response must include ok=true or ok=false.",
      diagnostics,
    };
  }

  return {
    ok: true,
    text: typeof body.text === "string" ? body.text : "",
    confidence: normalizeConfidence(body.confidence),
    blocks: normalizeBlocks(body.blocks),
    provider: {
      provider: normalizeWorkerString(body.provider, "rapidocr-worker"),
      model: normalizeWorkerString(body.model, "rapidocr-v1"),
      version: "PV-05-03",
    },
    diagnostics: {
      ...diagnostics,
      requestIdFromWorker: body.requestId ?? null,
      ...body.diagnostics,
    },
  };
}

async function parseJsonResponse(response: Response): Promise<HttpOcrWorkerResponseBody> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      ok: false,
      error: {
        code: response.ok ? "empty_worker_response" : "worker_http_error",
        message: response.ok ? "OCR worker returned an empty response." : `OCR worker returned HTTP ${response.status}.`,
      },
      diagnostics: {
        httpStatus: response.status,
      },
    };
  }

  try {
    return JSON.parse(text) as HttpOcrWorkerResponseBody;
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_worker_json",
        message: "OCR worker returned invalid JSON.",
      },
      diagnostics: {
        httpStatus: response.status,
        responseTextLength: text.length,
      },
    };
  }
}

function normalizeWorkerUrl(value: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("HTTP OCR worker url is required.");
  }

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("HTTP OCR worker url must use http or https.");
  }

  return url.toString();
}

function inferPixelFormat(byteLength: number, width: number, height: number): "grayscale" | "rgb" | "rgba" {
  const pixels = width * height;
  if (pixels > 0 && byteLength === pixels) return "grayscale";
  if (pixels > 0 && byteLength === pixels * 3) return "rgb";
  return "rgba";
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function normalizeTimeoutMs(value?: number | null): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(100, Math.trunc(value));
}

function normalizeWorkerString(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeConfidence(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

function normalizeBlocks(value: HttpOcrWorkerSuccessBody["blocks"]): Array<Partial<LocalOcrTextBlock>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((block) => normalizeBlock(block))
    .filter((block): block is Partial<LocalOcrTextBlock> => Boolean(block));
}

function normalizeBlock(value: Partial<LocalOcrTextBlock> | null | undefined): Partial<LocalOcrTextBlock> | null {
  if (!value || typeof value !== "object") return null;
  const text = normalizeNullableString(value.text);
  const confidence = normalizeConfidence(value.confidence);
  const bbox = normalizeBBox(value.bbox);

  if (!text && confidence === null && !bbox) return null;

  return {
    ...(text ? { text } : {}),
    ...(confidence !== null ? { confidence } : {}),
    ...(bbox ? { bbox } : {}),
  };
}

function normalizeBBox(value: unknown): CropBBox | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Record<keyof CropBBox, unknown>>;
  const x = normalizeNonNegativeInteger(record.x);
  const y = normalizeNonNegativeInteger(record.y);
  const width = normalizeNonNegativeInteger(record.width);
  const height = normalizeNonNegativeInteger(record.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
