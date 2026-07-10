import type { CropBBox } from "./crop-generator";
import type { OcrEngine, OcrInput, OcrResult, PipelineProviderInfo } from "./local-pipeline";

export const UNSUPPORTED_LOCAL_OCR_PROVIDER: PipelineProviderInfo = {
  provider: "local",
  model: "unsupported-ocr-v0",
  version: "PV-03-01",
};

export type LocalOcrTextBlock = {
  text: string;
  confidence: number | null;
  bbox?: CropBBox | null;
};

export type LocalOcrResult = OcrResult & {
  blocks: LocalOcrTextBlock[];
  isEmpty: boolean;
};

export interface LocalOcrEngine extends OcrEngine {
  readonly provider: PipelineProviderInfo;
  recognize(input: OcrInput): Promise<LocalOcrResult>;
}

export type BuildLocalOcrResultInput = {
  provider: PipelineProviderInfo;
  text?: string | null;
  confidence?: number | null;
  blocks?: Array<Partial<LocalOcrTextBlock> | null | undefined> | null;
  diagnostics?: Record<string, unknown>;
};

export type UnsupportedLocalOcrOptions = {
  provider?: PipelineProviderInfo;
  diagnostics?: Record<string, unknown>;
};

export function createUnsupportedLocalOcrEngine(options: UnsupportedLocalOcrOptions = {}): LocalOcrEngine {
  return new UnsupportedLocalOcrEngine(options);
}

export class UnsupportedLocalOcrEngine implements LocalOcrEngine {
  readonly provider: PipelineProviderInfo;
  private readonly diagnostics: Record<string, unknown>;

  constructor(options: UnsupportedLocalOcrOptions = {}) {
    this.provider = options.provider ?? UNSUPPORTED_LOCAL_OCR_PROVIDER;
    this.diagnostics = options.diagnostics ?? {};
  }

  async recognize(input: OcrInput): Promise<LocalOcrResult> {
    void input;
    return buildLocalOcrResult({
      provider: this.provider,
      text: "",
      confidence: null,
      blocks: [],
      diagnostics: {
        reason: "unsupported_local_ocr",
        ...this.diagnostics,
      },
    });
  }
}

export function buildLocalOcrResult(input: BuildLocalOcrResultInput): LocalOcrResult {
  const blocks = normalizeOcrBlocks(input.blocks ?? []);
  const normalizedText = normalizeOcrText(input.text ?? blocks.map((block) => block.text).join("\n"));

  return {
    text: normalizedText,
    confidence: normalizeOcrConfidence(input.confidence ?? averageBlockConfidence(blocks)),
    provider: normalizeProviderField(input.provider.provider, "local"),
    model: normalizeProviderField(input.provider.model, "unknown-ocr-model"),
    diagnostics: input.diagnostics,
    blocks,
    isEmpty: normalizedText.length === 0,
  };
}

export function normalizeOcrText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .split(/\r?\n/g)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function normalizeOcrConfidence(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return round4(Math.min(Math.max(value, 0), 1));
}

export function normalizeOcrBlocks(
  blocks: Array<Partial<LocalOcrTextBlock> | null | undefined>,
): LocalOcrTextBlock[] {
  const normalized: LocalOcrTextBlock[] = [];

  for (const block of blocks) {
    if (!block) continue;
    const text = normalizeOcrText(block.text);
    if (!text) continue;

    normalized.push({
      text,
      confidence: normalizeOcrConfidence(block.confidence),
      bbox: normalizeOcrBBox(block.bbox),
    });
  }

  return normalized;
}

function normalizeOcrBBox(value: CropBBox | null | undefined): CropBBox | null {
  if (!value) return null;
  if (![value.x, value.y, value.width, value.height].every((part) => Number.isFinite(part))) return null;
  if (value.width <= 0 || value.height <= 0) return null;

  return {
    x: Math.max(0, Math.floor(value.x)),
    y: Math.max(0, Math.floor(value.y)),
    width: Math.ceil(value.width),
    height: Math.ceil(value.height),
  };
}

function averageBlockConfidence(blocks: LocalOcrTextBlock[]): number | null {
  const confidences = blocks
    .map((block) => block.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number" && Number.isFinite(confidence));

  if (confidences.length === 0) return null;
  return confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length;
}

function normalizeProviderField(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
