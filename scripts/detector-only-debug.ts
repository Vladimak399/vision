import { readFile } from "node:fs/promises";
import path from "node:path";

import { handleDetectorOnlyApiRequest, type DetectorOnlyApiResponse } from "../server/price-capture/detector-only-api-boundary";
import { createSharpHeuristicDetectorOnlyProcessor, type DetectorOnlyProcessingResult } from "../server/price-capture/detector-only-orchestrator";
import { buildDetectorOnlyRunReport, type DetectorOnlyRunReportDto } from "../server/price-capture/detector-only-report";
import type { EvidenceDraft, PriceCaptureRunContext } from "../server/price-capture/evidence-contract";
import { createExternalOcrWorkerEngine, createMockExternalOcrWorkerClient } from "../server/price-capture/external-ocr-worker";
import { createUnsupportedLocalOcrEngine, type LocalOcrEngine } from "../server/price-capture/local-ocr";
import type { PriceTagDetection } from "../server/price-capture/local-pipeline";
import { mergeLocalOcrRunIntoEvidenceDrafts, type OcrEvidenceMergeMetrics } from "../server/price-capture/ocr-evidence";
import { runLocalOcrForDraftItems, type LocalOcrDraftRunResult } from "../server/price-capture/ocr-crop";

export type DetectorOnlyDebugOcrMode = "unsupported-noop" | "mock-worker";

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
  mockOcrText: string | null;
  mockOcrConfidence: number | null;
  pretty: boolean;
};

export type DetectorOnlyDebugCliParseResult =
  | { ok: true; options: DetectorOnlyDebugCliOptions }
  | { ok: false; error: string };

export type DetectorOnlyDebugOcrSection = {
  mode: DetectorOnlyDebugOcrMode;
  metrics: OcrEvidenceMergeMetrics;
  skipped: LocalOcrDraftRunResult["skipped"];
};

export type DetectorOnlyDebugOcrResponse = {
  ok: true;
  statusCode: 200;
  report: DetectorOnlyRunReportDto;
  ocr: DetectorOnlyDebugOcrSection;
};

export type DetectorOnlyDebugResponse = DetectorOnlyApiResponse | DetectorOnlyDebugOcrResponse;

const DEFAULT_COMPANY_ID = "local-debug-company";
const DEFAULT_STORE_ID = "local-debug-store";
const DEFAULT_RUN_ID = "local-debug-run";
const DEFAULT_CROP_PADDING_PIXELS = 1;

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
  if (!ocrMode) return { ok: false, error: usage("--ocr-mode must be unsupported-noop or mock-worker") };

  const mockOcrConfidence = parseNullableUnitFloat(stringFlag(flags, "--mock-ocr-confidence"));
  if (mockOcrConfidence === false) {
    return { ok: false, error: usage("--mock-ocr-confidence must be a number from 0 to 1") };
  }

  const mockOcrText = stringFlag(flags, "--mock-ocr-text");
  const withOcr = flags.has("--with-ocr") || flags.has("--ocr") || ocrMode === "mock-worker" || Boolean(mockOcrText);

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
      mockOcrText,
      mockOcrConfidence: mockOcrConfidence === null ? null : mockOcrConfidence,
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
  });
  const merged = mergeLocalOcrRunIntoEvidenceDrafts({
    drafts: processingResult.drafts,
    ocrRun,
  });
  const resultWithOcr = withMergedDrafts(processingResult, merged.drafts);

  return {
    ok: true,
    statusCode: 200,
    report: buildDetectorOnlyRunReport(resultWithOcr),
    ocr: {
      mode: options.ocrMode,
      metrics: merged.metrics,
      skipped: ocrRun.skipped,
    },
  };
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

function parseWeek(value: string): 1 | 2 | null {
  if (value === "1") return 1;
  if (value === "2") return 2;
  return null;
}

function parseOcrMode(value: string): DetectorOnlyDebugOcrMode | null {
  if (value === "unsupported-noop" || value === "noop") return "unsupported-noop";
  if (value === "mock-worker" || value === "mock") return "mock-worker";
  return null;
}

function parseNonNegativeInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
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
    "  --company-id <id>             Default: local-debug-company",
    "  --store-id <id>               Default: local-debug-store",
    "  --week <1|2>                  Default: 1",
    "  --run-id <id>                 Default: local-debug-run",
    "  --captured-date <date>        Default: today in YYYY-MM-DD",
    "  --content-type <mime>         Default: inferred from extension",
    "  --crop-extension <ext>        Default: inferred from extension",
    "  --crop-padding <pixels>       Default: 1",
    "  --with-ocr                   Run OCR over extracted crops and include OCR section",
    "  --ocr-mode <mode>             unsupported-noop | mock-worker",
    "  --mock-ocr-text <text>        Text returned by mock-worker OCR mode",
    "  --mock-ocr-confidence <0..1>  Confidence returned by mock-worker OCR mode",
    "  --compact                     Print compact JSON",
  ].join("\n");
}

if (require.main === module) {
  void main();
}
