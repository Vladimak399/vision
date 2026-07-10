import type { CropBBox } from "./crop-generator";
import {
  buildLocalOcrResult,
  type LocalOcrEngine,
  type LocalOcrResult,
  type LocalOcrTextBlock,
} from "./local-ocr";
import type { OcrInput, PipelineProviderInfo } from "./local-pipeline";

export const EXTERNAL_OCR_WORKER_PROVIDER: PipelineProviderInfo = {
  provider: "external-worker",
  model: "external-ocr-worker-v1",
  version: "PV-03-09",
};

export const MOCK_EXTERNAL_OCR_WORKER_PROVIDER: PipelineProviderInfo = {
  provider: "mock-worker",
  model: "mock-ocr-worker-v1",
  version: "PV-03-10",
};

export type ExternalOcrWorkerImagePayload = {
  bytes: Uint8Array;
  width: number;
  height: number;
  byteLength: number;
  filename: string | null;
  contentType: string | null;
  storagePath: string | null;
};

export type ExternalOcrWorkerRequest = {
  requestId: string;
  run: {
    companyId: string;
    storeId: string;
    week: 1 | 2;
    runId: string;
  };
  item: {
    detectionId: string | null;
    itemId: string;
    detectionBBox: CropBBox;
    cropBBox: CropBBox;
  };
  image: ExternalOcrWorkerImagePayload;
  hints: {
    languages: string[];
  };
};

export type ExternalOcrWorkerSuccessResponse = {
  ok: true;
  text?: string | null;
  confidence?: number | null;
  blocks?: Array<Partial<LocalOcrTextBlock> | null | undefined> | null;
  provider?: PipelineProviderInfo | null;
  diagnostics?: Record<string, unknown>;
};

export type ExternalOcrWorkerErrorResponse = {
  ok: false;
  errorCode: string;
  errorMessage: string;
  diagnostics?: Record<string, unknown>;
};

export type ExternalOcrWorkerResponse = ExternalOcrWorkerSuccessResponse | ExternalOcrWorkerErrorResponse;

export interface ExternalOcrWorkerClient {
  readonly provider: PipelineProviderInfo;
  recognize(request: ExternalOcrWorkerRequest): Promise<ExternalOcrWorkerResponse>;
}

export type ExternalOcrWorkerEngineOptions = {
  client: ExternalOcrWorkerClient;
  languages?: string[];
  provider?: PipelineProviderInfo;
  throwOnWorkerError?: boolean;
};

export type MockExternalOcrWorkerClientOptions = {
  provider?: PipelineProviderInfo;
  text?: string | null;
  confidence?: number | null;
  blocks?: Array<Partial<LocalOcrTextBlock> | null | undefined> | null;
  fail?: boolean;
  errorCode?: string;
  errorMessage?: string;
  diagnostics?: Record<string, unknown>;
};

export function createExternalOcrWorkerEngine(options: ExternalOcrWorkerEngineOptions): LocalOcrEngine {
  return new ExternalOcrWorkerOcrEngine(options);
}

export class ExternalOcrWorkerOcrEngine implements LocalOcrEngine {
  readonly provider: PipelineProviderInfo;
  private readonly client: ExternalOcrWorkerClient;
  private readonly languages: string[];
  private readonly throwOnWorkerError: boolean;

  constructor(options: ExternalOcrWorkerEngineOptions) {
    this.client = options.client;
    this.provider = options.provider ?? options.client.provider ?? EXTERNAL_OCR_WORKER_PROVIDER;
    this.languages = normalizeLanguages(options.languages ?? ["ru", "en"]);
    this.throwOnWorkerError = options.throwOnWorkerError ?? false;
  }

  async recognize(input: OcrInput): Promise<LocalOcrResult> {
    const request = buildExternalOcrWorkerRequest(input, this.languages);
    const response = await this.client.recognize(request);

    if (!response.ok) {
      if (this.throwOnWorkerError) {
        throw new Error(response.errorMessage || response.errorCode || "External OCR worker failed.");
      }

      return buildLocalOcrResult({
        provider: this.provider,
        text: "",
        confidence: null,
        blocks: [],
        diagnostics: {
          reason: "external_ocr_worker_failed",
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          requestId: request.requestId,
          ...response.diagnostics,
        },
      });
    }

    return buildLocalOcrResult({
      provider: response.provider ?? this.provider,
      text: response.text,
      confidence: response.confidence,
      blocks: response.blocks,
      diagnostics: {
        requestId: request.requestId,
        workerProvider: this.client.provider.provider,
        workerModel: this.client.provider.model,
        ...response.diagnostics,
      },
    });
  }
}

export function buildExternalOcrWorkerRequest(input: OcrInput, languages: string[] = ["ru", "en"]): ExternalOcrWorkerRequest {
  const detectionId = emptyToNull(input.detection.id);
  const itemId = detectionId ?? "ocr-item";

  return {
    requestId: `${input.run.runId}:${itemId}`,
    run: {
      companyId: input.run.companyId,
      storeId: input.run.storeId,
      week: input.run.week,
      runId: input.run.runId,
    },
    item: {
      detectionId,
      itemId,
      detectionBBox: input.detection.bbox,
      cropBBox: input.crop.bbox,
    },
    image: {
      bytes: input.photo.bytes,
      width: input.photo.dimensions.width,
      height: input.photo.dimensions.height,
      byteLength: input.photo.bytes.byteLength,
      filename: emptyToNull(input.photo.filename),
      contentType: null,
      storagePath: emptyToNull(input.photo.storagePath),
    },
    hints: {
      languages: normalizeLanguages(languages),
    },
  };
}

export function createMockExternalOcrWorkerClient(
  options: MockExternalOcrWorkerClientOptions = {},
): ExternalOcrWorkerClient {
  return new MockExternalOcrWorkerClient(options);
}

export class MockExternalOcrWorkerClient implements ExternalOcrWorkerClient {
  readonly provider: PipelineProviderInfo;
  private readonly options: MockExternalOcrWorkerClientOptions;

  constructor(options: MockExternalOcrWorkerClientOptions = {}) {
    this.provider = options.provider ?? MOCK_EXTERNAL_OCR_WORKER_PROVIDER;
    this.options = options;
  }

  async recognize(request: ExternalOcrWorkerRequest): Promise<ExternalOcrWorkerResponse> {
    if (this.options.fail) {
      return {
        ok: false,
        errorCode: this.options.errorCode ?? "mock_worker_failed",
        errorMessage: this.options.errorMessage ?? "Mock OCR worker failed.",
        diagnostics: {
          requestId: request.requestId,
          ...this.options.diagnostics,
        },
      };
    }

    return {
      ok: true,
      text: this.options.text ?? "",
      confidence: this.options.confidence ?? null,
      blocks: this.options.blocks ?? null,
      provider: this.provider,
      diagnostics: {
        requestId: request.requestId,
        imageWidth: request.image.width,
        imageHeight: request.image.height,
        imageByteLength: request.image.byteLength,
        languages: request.hints.languages,
        ...this.options.diagnostics,
      },
    };
  }
}

function normalizeLanguages(value: string[]): string[] {
  const languages = value
    .map((language) => emptyToNull(language)?.toLowerCase() ?? null)
    .filter((language): language is string => Boolean(language));

  return languages.length > 0 ? Array.from(new Set(languages)) : ["ru", "en"];
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
