import { readFile } from "node:fs/promises";
import path from "node:path";

import { handleDetectorOnlyApiRequest, type DetectorOnlyApiResponse } from "../server/price-capture/detector-only-api-boundary";
import { createSharpHeuristicDetectorOnlyProcessor, type DetectorOnlyProcessingResult } from "../server/price-capture/detector-only-orchestrator";
import { buildDetectorOnlyRunReport, type DetectorOnlyRunReportDto } from "../server/price-capture/detector-only-report";
import type { EvidenceDraft, PriceCaptureRunContext } from "../server/price-capture/evidence-contract";
import { createExternalOcrWorkerEngine, createMockExternalOcrWorkerClient } from "../server/price-capture/external-ocr-worker";
import { createHttpOcrWorkerClient } from "../server/price-capture/http-ocr-worker-client";
import { createUnsupportedLocalOcrEngine, type LocalOcrEngine } from "../server/price-capture/local-ocr";
import { createRussianPriceParser } from "../server/price-capture/local-price-parser";
import { createLocalProductTextExtractor } from "../server/price-capture/local-product-text-extractor";
import type { PriceParserResult, PriceTagDetection, ProductTextExtractorResult } from "../server/price-capture/local-pipeline";
import { mergeLocalOcrRunIntoEvidenceDrafts, type OcrEvidenceMergeMetrics } from "../server/price-capture/ocr-evidence";
import { runLocalOcrForDraftItems, type LocalOcrDraftRunResult } from "../server/price-capture/ocr-crop";
import { mergeParsedPricesIntoEvidenceDrafts, type ParsedPriceEvidenceMergeMetrics } from "../server/price-capture/price-evidence";
import { mergeProductTextsIntoEvidenceDrafts, type ProductTextEvidenceMergeMetrics } from "../server/price-capture/product-text-evidence";

export type DetectorOnlyDebugOcrMode = "unsupported-noop" | "mock-worker" | "rapidocr-worker";
export type DetectorOnlyDebugOcrItemStatus = "text" | "empty" | "worker_error" | "unsupported";

export type DetectorOnlyDebugCliOptions = {
  imagePath: string;
  companyId: string;
  storeId: string;
  week: 1 | 2;
  runId: string;
  capturedDate: string | null;
  contentType: string | null;
  cropExtension: string | null;
  cropPaddingPixels: number;
  withOcr: boolean;
  ocrMode: DetectorOnlyDebugOcrMode;
  ocrWorkerUrl: string | null;
  ocrWorkerTimeoutMs: number | null;
  mockOcrText: string | null;
  mockOcrConfidence: number | null;
  parsePrice: boolean;
  extractProductText: boolean;
  dumpCrops: boolean;
  cropDumpDir: string | null;
  pretty: boolean;
};

export type DetectorOnlyDebugCliParseResult =
  | { ok: true; options: DetectorOnlyDebugCliOptions }
  | { ok: false; error: string };

export type DetectorOnlyDebugOcrItem = {
  itemId: string;
  detectionId: string | null;
  provider: string;
  model: string;
  status: DetectorOnlyDebugOcrItemStatus;
  textLength: number;
  textPreview: string | null;
  confidence: number | null;
  blockCount: number;
  diagnostics: Record<string, unknown> | null;
  cropDiagnostics: Record<string, unknown> | null;
};

export type DetectorOnlyDebugSkippedOcrItem = {
  itemId: string;
  detectionId: string | null;
  reason: string;
  errorMessage: string;
  diagnostics: Record<string, unknown> | null;
};

export type DetectorOnlyDebugOcrSection = {
  mode: DetectorOnlyDebugOcrMode;
  metrics: OcrEvidenceMergeMetrics;
  skipped: DetectorOnlyDebugSkippedOcrItem[];
  items: DetectorOnlyDebugOcrItem[];
  diagnostics: {
    workerUrl: string | null;
    timeoutMs: number | null;
    dumpCrops: boolean;
    cropDumpDir: string | null;
  };
};

export type DetectorOnlyDebugPriceSection = {
  parser: "ru-price-parser-heuristic-v1";
  metrics: ParsedPriceEvidenceMergeMetrics;
  parsed: Array<{
    itemId: string;
    priceMinor: number | null;
    oldPriceMinor: number | null;
    promoPriceMinor: number | null;
    confidence: number | null;
    currency: string | null;
  }>;
};

export type DetectorOnlyDebugProductTextSection = {
  extractor: "ru-product-text-extractor-heuristic-v1";
  metrics: ProductTextEvidenceMergeMetrics;
  extracted: Array<{
    itemId: string;
    rawName: string | null;
    normalizedProductText: string | null;
  }>;
};

export type DetectorOnlyDebugOcrResponse = {
  ok: true;
  statusCode: 200;
  report: DetectorOnlyRunReportDto;
  ocr: DetectorOnlyDebugOcrSection;
  price?: DetectorOnlyDebugPriceSection;
  productText?: DetectorOnlyDebugProductTextSection;
};

export type DetectorOnlyDebugResponse = DetectorOnlyApiResponse | DetectorOnlyDebugOcrResponse;

const DEFAULT_COMPANY_ID = "local-debug-company";
const DEFAULT_STORE_ID = "local-debug-store";
const DEFAULT_RUN_ID = "local-debug-run";
const DEFAULT_CROP_PADDING_PIXELS = 1;
const DEFAULT_OCR_WORKER_URL = "http://127.0.0.1:8765/ocr";
const DEFAULT_OCR_WORKER_TIMEOUT_MS = 30_000;
const DEFAULT_CROP_DUMP_DIR = "tmp/real-photo-runs/crops";
const TEXT_PREVIEW_MAX_LENGTH = 160;
const DIAGNOSTICS_MAX_DEPTH = 4;
const DIAGNOSTICS_MAX_KEYS = 24;
const DIAGNOSTICS_MAX_STRING_LENGTH = 240;
const DIAGNOSTICS_MAX_ARRAY_LENGTH = 12;

export function parseDetectorOnlyDebugArgs(argv: string[]): DetectorOnlyDebugCliParseResult {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const equalsIndex = token.indexOf("=");
    if (equalsIndex >= 0) {
      flags.set(token.slice(0, equalsIndex), token.slice(equalsIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(token, next);
      index += 1;
    } else {
      flags.set(token, true);
    }
  }

  const imagePath = positionals[0] ?? stringFlag(flags, "--image");
  if (!imagePath) return { ok: false, error: usage("image path is required") };

  const week = parseWeek(stringFlag(flags, "--week") ?? "1");
  if (!week) return { ok: false, error: usage("--week must be 1 or 2") };

  const cropPaddingPixels = parseNonNegativeInteger(
    stringFlag(flags, "--crop-padding") ?? String(DEFAULT_CROP_PADDING_PIXELS),
  );
  if (cropPaddingPixels === null) {
    return { ok: false, error: usage("--crop-padding must be a non-negative integer") };
  }

  const ocrMode = parseOcrMode(stringFlag(flags, "--ocr-mode") ?? "unsupported-noop");
  if (!ocrMode) {
    return { ok: false, error: usage("--ocr-mode must be unsupported-noop, mock-worker, or rapidocr-worker") };
  }

  const mockOcrConfidence = parseNullableUnitFloat(stringFlag(flags, "--mock-ocr-confidence"));
  if (mockOcrConfidence === false) {
    return { ok: false, error: usage("--mock-ocr-confidence must be a number from 0 to 1") };
  }

  const ocrWorkerTimeoutMs = parseNullablePositiveInteger(stringFlag(flags, "--ocr-worker-timeout-ms"));
  if (ocrWorkerTimeoutMs === false) {
    return { ok: false, error: usage("--ocr-worker-timeout-ms must be a positive integer") };
  }

  const mockOcrText = stringFlag(flags, "--mock-ocr-text");
  const extractProductText = flags.has("--extract-product-text")
    || flags.has("--with-product-text")
    || flags.has("--product-text")
    || flags.has("--product");
  const parsePrice = flags.has("--parse-price")
    || flags.has("--with-price")
    || flags.has("--price")
    || extractProductText;
  const withOcr = flags.has("--with-ocr")
    || flags.has("--ocr")
    || ocrMode === "mock-worker"
    || ocrMode === "rapidocr-worker"
    || Boolean(mockOcrText)
    || parsePrice
    || extractProductText;

  return {
    ok: true,
    options: {
      imagePath,
      companyId: stringFlag(flags, "--company-id") ?? DEFAULT_COMPANY_ID,
      storeId: stringFlag(flags, "--store-id") ?? DEFAULT_STORE_ID,
      week,
      runId: stringFlag(flags, "--run-id") ?? DEFAULT_RUN_ID,
      capturedDate: stringFlag(flags, "--captured-date") ?? new Date().toISOString().slice(0, 10),
      contentType: stringFlag(flags, "--content-type") ?? inferContentType(imagePath),
      cropExtension: stringFlag(flags, "--crop-extension") ?? inferCropExtension(imagePath),
      cropPaddingPixels,
      withOcr,
      ocrMode,
      ocrWorkerUrl: stringFlag(flags, "--ocr-worker-url") ?? stringFromEnv("PRICEVISION_OCR_WORKER_URL") ?? DEFAULT_OCR_WORKER_URL,
      ocrWorkerTimeoutMs: ocrWorkerTimeoutMs === null ? DEFAULT_OCR_WORKER_TIMEOUT_MS : ocrWorkerTimeoutMs,
      mockOcrText,
      mockOcrConfidence: mockOcrConfidence === null ? null : mockOcrConfidence,
      parsePrice,
      extractProductText,
      dumpCrops: flags.has("--dump-crops"),
      cropDumpDir: stringFlag(flags, "--crop-dump-dir") ?? DEFAULT_CROP_DUMP_DIR,
      pretty: !flags.has("--compact"),
    },
  };
}

export async function runDetectorOnlyDebug(options: DetectorOnlyDebugCliOptions): Promise<string> {
  const bytes = await readFile(options.imagePath);
  const response = options.withOcr
    ? await runDetectorOnlyDebugWithOcr(options, bytes)
    : await runDetectorOnlyDebugWithoutOcr(options, bytes);

  return JSON.stringify(response, null, options.pretty ? 2 : 0);
}

async function runDetectorOnlyDebugWithoutOcr(
  options: DetectorOnlyDebugCliOptions,
  bytes: Uint8Array,
): Promise<DetectorOnlyApiResponse> {
  return handleDetectorOnlyApiRequest({
    companyId: options.companyId,
    storeId: options.storeId,
    week: options.week,
    runId: options.runId,
    capturedDate: options.capturedDate,
    photo: {
      bytes: new Uint8Array(bytes),
      filename: path.basename(options.imagePath),
      contentType: options.contentType,
      storagePath: options.imagePath,
    },
    evidence: {
      cropExtension: options.cropExtension,
      cropPadding: { pixels: options.cropPaddingPixels },
    },
  });
}

async function runDetectorOnlyDebugWithOcr(
  options: DetectorOnlyDebugCliOptions,
  bytes: Uint8Array,
): Promise<DetectorOnlyDebugOcrResponse> {
  const processor = createSharpHeuristicDetectorOnlyProcessor();
  const processingResult = await processor.process({
    context: buildContext(options),
    image: {
      bytes: new Uint8Array(bytes),
      filename: path.basename(options.imagePath),
      contentType: options.contentType,
      storagePath: options.imagePath,
    },
    evidence: {
      cropExtension: options.cropExtension,
      cropPadding: { pixels: options.cropPaddingPixels },
    },
  });

  const ocrRun = await runLocalOcrForDraftItems({
    run: processingResult.run,
    decodedImage: processingResult.detectorRun.pipeline.decodedImage,
    items: processingResult.drafts.map((draft) => ({
      draft,
      detection: evidenceDraftToDetection(draft),
    })),
    ocr: createDebugOcrEngine(options),
    ocrCropPreprocess: {
      dumpCrops: options.dumpCrops,
      cropDumpDir: options.cropDumpDir,
      sourceImageStem: path.parse(options.imagePath).name,
    },
  });
  const ocrMerged = mergeLocalOcrRunIntoEvidenceDrafts({
    drafts: processingResult.drafts,
    ocrRun,
  });

  let drafts = ocrMerged.drafts;
  let price: DetectorOnlyDebugPriceSection | undefined;
  let productText: DetectorOnlyDebugProductTextSection | undefined;
  let parsedItems: Array<{ itemId: string; parsedPrice: PriceParserResult | null }> = [];

  if (options.parsePrice || options.extractProductText) {
    parsedItems = await parsePricesForOcrRun(processingResult.run, ocrRun);
    const priceMerged = mergeParsedPricesIntoEvidenceDrafts({
      drafts,
      parsedItems,
    });
    drafts = priceMerged.drafts;
    price = {
      parser: "ru-price-parser-heuristic-v1",
      metrics: priceMerged.metrics,
      parsed: parsedItems.map((item) => ({
        itemId: item.itemId,
        priceMinor: item.parsedPrice?.priceMinor ?? null,
        oldPriceMinor: item.parsedPrice?.oldPriceMinor ?? null,
        promoPriceMinor: item.parsedPrice?.promoPriceMinor ?? null,
        confidence: typeof item.parsedPrice?.confidence === "number" ? item.parsedPrice.confidence : null,
        currency: item.parsedPrice?.currency ?? null,
      })),
    };
  }

  if (options.extractProductText) {
    const productTextItems = await extractProductTextsForOcrRun(processingResult.run, ocrRun, parsedItems);
    const productTextMerged = mergeProductTextsIntoEvidenceDrafts({
      drafts,
      productTextItems,
    });
    drafts = productTextMerged.drafts;
    productText = {
      extractor: "ru-product-text-extractor-heuristic-v1",
      metrics: productTextMerged.metrics,
      extracted: productTextItems.map((item) => ({
        itemId: item.itemId,
        rawName: item.productText?.rawName ?? null,
        normalizedProductText: item.productText?.normalizedProductText ?? null,
      })),
    };
  }

  const result = withMergedDrafts(processingResult, drafts);

  return {
    ok: true,
    statusCode: 200,
    report: buildDetectorOnlyRunReport(result),
    ocr: buildDebugOcrSection(options, ocrRun, ocrMerged.metrics),
    ...(price ? { price } : {}),
    ...(productText ? { productText } : {}),
  };
}

function buildDebugOcrSection(
  options: DetectorOnlyDebugCliOptions,
  ocrRun: LocalOcrDraftRunResult,
  metrics: OcrEvidenceMergeMetrics,
): DetectorOnlyDebugOcrSection {
  return {
    mode: options.ocrMode,
    metrics,
    skipped: ocrRun.skipped.map((item) => ({
      itemId: item.itemId,
      detectionId: item.detectionId,
      reason: item.reason,
      errorMessage: item.errorMessage,
      diagnostics: sanitizeDiagnostics(item.diagnostics),
    })),
    items: ocrRun.items.map((item) => ({
      itemId: item.itemId,
      detectionId: item.detectionId,
      provider: item.ocr.provider,
      model: item.ocr.model,
      status: resolveOcrItemStatus(item.ocr),
      textLength: item.ocr.text.length,
      textPreview: textPreview(item.ocr.text),
      confidence: typeof item.ocr.confidence === "number" ? item.ocr.confidence : null,
      blockCount: item.ocr.blocks.length,
      diagnostics: sanitizeDiagnostics(item.ocr.diagnostics),
      cropDiagnostics: sanitizeDiagnostics(item.cropImage.diagnostics.cropDiagnostics),
    })),
    diagnostics: {
      workerUrl: options.ocrMode === "rapidocr-worker" ? options.ocrWorkerUrl : null,
      timeoutMs: options.ocrMode === "rapidocr-worker" ? options.ocrWorkerTimeoutMs : null,
      dumpCrops: options.dumpCrops,
      cropDumpDir: options.dumpCrops ? options.cropDumpDir : null,
    },
  };
}

async function parsePricesForOcrRun(
  run: PriceCaptureRunContext,
  ocrRun: LocalOcrDraftRunResult,
): Promise<Array<{ itemId: string; parsedPrice: PriceParserResult | null }>> {
  const parser = createRussianPriceParser();
  const parsed: Array<{ itemId: string; parsedPrice: PriceParserResult | null }> = [];

  for (const item of ocrRun.items) {
    const parsedPrice = await parser.parse({
      run,
      detection: item.detection,
      ocr: item.ocr,
    });
    parsed.push({
      itemId: item.itemId,
      parsedPrice,
    });
  }

  return parsed;
}

async function extractProductTextsForOcrRun(
  run: PriceCaptureRunContext,
  ocrRun: LocalOcrDraftRunResult,
  parsedItems: Array<{ itemId: string; parsedPrice: PriceParserResult | null }>,
): Promise<Array<{ itemId: string; productText: ProductTextExtractorResult }>> {
  const extractor = createLocalProductTextExtractor();
  const parsedByItemId = new Map(parsedItems.map((item) => [item.itemId, item.parsedPrice]));
  const extracted: Array<{ itemId: string; productText: ProductTextExtractorResult }> = [];

  for (const item of ocrRun.items) {
    const productText = await extractor.extract({
      run,
      detection: item.detection,
      ocr: item.ocr,
      parsedPrice: parsedByItemId.get(item.itemId) ?? null,
    });
    extracted.push({
      itemId: item.itemId,
      productText,
    });
  }

  return extracted;
}

function createDebugOcrEngine(options: DetectorOnlyDebugCliOptions): LocalOcrEngine {
  if (options.ocrMode === "mock-worker") {
    const client = createMockExternalOcrWorkerClient({
      text: options.mockOcrText ?? "MOCK OCR 99 90",
      confidence: options.mockOcrConfidence ?? 0.9,
      diagnostics: { source: "detector-only-debug" },
    });

    return createExternalOcrWorkerEngine({ client });
  }

  if (options.ocrMode === "rapidocr-worker") {
    const client = createHttpOcrWorkerClient({
      url: options.ocrWorkerUrl ?? DEFAULT_OCR_WORKER_URL,
      timeoutMs: options.ocrWorkerTimeoutMs ?? DEFAULT_OCR_WORKER_TIMEOUT_MS,
    });

    return createExternalOcrWorkerEngine({ client });
  }

  return createUnsupportedLocalOcrEngine({ diagnostics: { source: "detector-only-debug" } });
}

function buildContext(options: DetectorOnlyDebugCliOptions): PriceCaptureRunContext {
  return {
    companyId: options.companyId,
    storeId: options.storeId,
    week: options.week,
    runId: options.runId,
    capturedDate: options.capturedDate,
    photoFilename: path.basename(options.imagePath),
    photoStoragePath: options.imagePath,
  };
}

function withMergedDrafts(
  result: DetectorOnlyProcessingResult,
  drafts: EvidenceDraft[],
): DetectorOnlyProcessingResult {
  return {
    ...result,
    drafts,
    evidence: {
      ...result.evidence,
      drafts,
    },
  };
}

function evidenceDraftToDetection(draft: EvidenceDraft): PriceTagDetection {
  return {
    id: draft.itemId,
    bbox: draft.row.bbox,
    confidence: draft.row.detector_confidence,
    provider: draft.row.detector_provider,
    model: draft.row.detector_model,
    label: "price_tag",
  };
}

function resolveOcrItemStatus(ocr: LocalOcrDraftRunResult["items"][number]["ocr"]): DetectorOnlyDebugOcrItemStatus {
  const reason = typeof ocr.diagnostics?.reason === "string" ? ocr.diagnostics.reason : null;
  if (reason === "external_ocr_worker_failed") return "worker_error";
  if (reason === "unsupported_local_ocr") return "unsupported";
  if (ocr.isEmpty) return "empty";
  return "text";
}

function textPreview(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= TEXT_PREVIEW_MAX_LENGTH) return normalized;
  return `${normalized.slice(0, TEXT_PREVIEW_MAX_LENGTH - 1).trim()}…`;
}

function sanitizeDiagnostics(value: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeDiagnosticValue(value, 0);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return null;
  return sanitized as Record<string, unknown>;
}

function sanitizeDiagnosticValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return truncateDiagnosticString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= DIAGNOSTICS_MAX_DEPTH) return `[array:${value.length}]`;
    return value.slice(0, DIAGNOSTICS_MAX_ARRAY_LENGTH).map((item) => sanitizeDiagnosticValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= DIAGNOSTICS_MAX_DEPTH) return "[object]";
    const output: Record<string, unknown> = {};
    let count = 0;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase().includes("bytes") || key.toLowerCase().includes("base64")) {
        output[key] = "[redacted]";
        continue;
      }
      output[key] = sanitizeDiagnosticValue(nested, depth + 1);
      count += 1;
      if (count >= DIAGNOSTICS_MAX_KEYS) break;
    }
    return output;
  }
  return String(value);
}

function truncateDiagnosticString(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= DIAGNOSTICS_MAX_STRING_LENGTH) return normalized;
  return `${normalized.slice(0, DIAGNOSTICS_MAX_STRING_LENGTH - 1).trim()}…`;
}

async function main(): Promise<void> {
  const parsed = parseDetectorOnlyDebugArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exitCode = 1;
    return;
  }

  try {
    const json = await runDetectorOnlyDebug(parsed.options);
    console.log(json);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Detector-only debug script failed");
    process.exitCode = 1;
  }
}

export function inferContentType(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
}

function inferCropExtension(filePath: string): string | null {
  const extension = path.extname(filePath).replace(/^\.+/, "").toLowerCase();
  return extension || null;
}

function stringFlag(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringFromEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseWeek(value: string): 1 | 2 | null {
  if (value === "1") return 1;
  if (value === "2") return 2;
  return null;
}

function parseOcrMode(value: string): DetectorOnlyDebugOcrMode | null {
  if (value === "unsupported-noop" || value === "noop") return "unsupported-noop";
  if (value === "mock-worker" || value === "mock") return "mock-worker";
  if (value === "rapidocr-worker" || value === "rapidocr" || value === "http-worker") return "rapidocr-worker";
  return null;
}

function parseNonNegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function parseNullablePositiveInteger(value: string | null): number | null | false {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : false;
}

function parseNullableUnitFloat(value: string | null): number | null | false {
  if (value === null) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return false;
  return parsed;
}

function usage(reason: string): string {
  return [
    `Error: ${reason}`,
    "",
    "Usage:",
    "  npm run debug:detector-only -- ./photo.jpg [options]",
    "",
    "Options:",
    "  --company-id <id>                 Default: local-debug-company",
    "  --store-id <id>                   Default: local-debug-store",
    "  --week <1|2>                      Default: 1",
    "  --run-id <id>                     Default: local-debug-run",
    "  --captured-date <date>            Default: today in YYYY-MM-DD",
    "  --content-type <mime>             Default: inferred from extension",
    "  --crop-extension <ext>            Default: inferred from extension",
    "  --crop-padding <pixels>           Default: 1",
    "  --with-ocr                       Run OCR over extracted crops and include OCR section",
    "  --ocr-mode <mode>                 unsupported-noop | mock-worker | rapidocr-worker",
    "  --ocr-worker-url <url>            Default: PRICEVISION_OCR_WORKER_URL or http://127.0.0.1:8765/ocr",
    "  --ocr-worker-timeout-ms <ms>      Default: 30000",
    "  --mock-ocr-text <text>            Text returned by mock-worker OCR mode",
    "  --mock-ocr-confidence <0..1>      Confidence returned by mock-worker OCR mode",
    "  --parse-price                     Parse price from OCR text and include price section",
    "  --extract-product-text            Extract product text from OCR text and include productText section",
    "  --dump-crops                      Save original and OCR input crop PNG files in debug mode",
    "  --crop-dump-dir <path>            Default: tmp/real-photo-runs/crops",
    "  --compact                         Print compact JSON",
  ].join("\n");
}

if (require.main === module) {
  void main();
}
