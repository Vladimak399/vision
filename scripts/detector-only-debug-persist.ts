import {
  runDetectorOnlyDebugMatchFromArgs,
  type DetectorOnlyDebugMatchResponse,
} from "./detector-only-debug-match";
import {
  buildEvidencePersistenceDryRunReport,
  getEvidencePersistenceWriteGuard,
  type EvidencePersistenceDryRunReport,
  type EvidencePersistenceWriteGuard,
} from "../server/price-capture/evidence-persistence";
import type { CropBBox } from "../server/price-capture/crop-generator";
import type { EvidenceDraft, PriceCaptureRunContext } from "../server/price-capture/evidence-contract";
import type { ProductMatcherResult } from "../server/price-capture/local-pipeline";

export const EVIDENCE_PERSISTENCE_MODE_ENV = "PRICEVISION_EVIDENCE_PERSISTENCE_MODE" as const;

export type DetectorOnlyDebugPersistenceCliParseResult =
  | { ok: true; argv: string[]; dryRunPersistence: boolean }
  | { ok: false; error: string };

export type DetectorOnlyDebugPersistenceGuard = EvidencePersistenceWriteGuard & {
  envVar: typeof EVIDENCE_PERSISTENCE_MODE_ENV;
  configuredMode: string | null;
  allowedMode: "dry_run";
};

export type DetectorOnlyDebugPersistenceSection = EvidencePersistenceDryRunReport & {
  guard: DetectorOnlyDebugPersistenceGuard;
};

export type DetectorOnlyDebugPersistResponse = DetectorOnlyDebugMatchResponse & {
  persistence: DetectorOnlyDebugPersistenceSection;
};

type DetectorOnlyReportRun = {
  companyId: string;
  storeId: string;
  week: 1 | 2;
  runId: string;
  photoStoragePath?: string | null;
  photoFilename?: string | null;
  capturedDate?: string | null;
};

type DetectorOnlyReportDraft = {
  itemId: string;
  bbox: CropBBox;
  crop: {
    storagePath: string;
    width: number;
    height: number;
  };
  detector: {
    provider: string;
    model: string;
    confidence: number;
  };
  review: {
    status: string;
    reason: string;
  };
  ai: {
    used: false;
  };
  product: {
    rawName: string;
    normalizedProductText: string | null;
    productVisibleText: string | null;
    brand: string | null;
    sizeText: string | null;
    priceMinor: number | null;
    oldPriceMinor: number | null;
    promoPriceMinor: number | null;
    parsedPriceConfidence: number | null;
    currency: string;
  };
  ocr?: {
    provider: string | null;
    model: string | null;
    text: string | null;
    confidence: number | null;
  };
};

type DetectorOnlyMatchItem = {
  itemId: string;
  selectedCatalogProductId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  reviewRequired: boolean;
};

const PERSISTENCE_FLAGS = new Set([
  "--dry-run-persistence",
  "--persistence-dry-run",
  "--with-persistence",
  "--persist-dry-run",
]);

export function parseDetectorOnlyDebugPersistenceArgs(argv: string[]): DetectorOnlyDebugPersistenceCliParseResult {
  const stripped: string[] = [];
  let dryRunPersistence = false;

  for (const token of argv) {
    if (PERSISTENCE_FLAGS.has(token)) {
      dryRunPersistence = true;
      continue;
    }
    stripped.push(token);
  }

  return { ok: true, argv: stripped, dryRunPersistence };
}

export async function runDetectorOnlyDebugPersistFromArgs(argv: string[]): Promise<string> {
  const parsed = parseDetectorOnlyDebugPersistenceArgs(argv);
  if (!parsed.ok) throw new Error(parsed.error);

  if (!parsed.dryRunPersistence) return runDetectorOnlyDebugMatchFromArgs(parsed.argv);

  const matchArgv = ensureArg(parsed.argv, "--match-product");
  const baseJson = await runDetectorOnlyDebugMatchFromArgs(matchArgv);
  const pretty = !parsed.argv.includes("--compact");
  return appendPersistenceDryRunToDebugJson(baseJson, { pretty });
}

export function appendPersistenceDryRunToDebugJson(
  json: string,
  options: { pretty?: boolean; env?: Record<string, string | undefined> } = {},
): string {
  const response = JSON.parse(json) as DetectorOnlyDebugMatchResponse & {
    report?: { run?: DetectorOnlyReportRun; drafts?: DetectorOnlyReportDraft[] };
    match?: { items?: DetectorOnlyMatchItem[] };
  };
  const persistence = buildDebugPersistenceDryRunSection(response, options.env);

  return JSON.stringify({ ...response, persistence } satisfies DetectorOnlyDebugPersistResponse, null, options.pretty === false ? 0 : 2);
}

export function buildDebugPersistenceDryRunSection(
  response: {
    report?: { run?: DetectorOnlyReportRun; drafts?: DetectorOnlyReportDraft[] };
    match?: { items?: DetectorOnlyMatchItem[] };
  },
  env: Record<string, string | undefined> = process.env,
): DetectorOnlyDebugPersistenceSection {
  const run = response.report?.run;
  const drafts = response.report?.drafts;
  const matchItems = response.match?.items;

  if (!run || !Array.isArray(drafts)) {
    throw new Error("Detector-only debug response does not contain report.run/report.drafts for persistence dry-run.");
  }

  const context = reportRunToContext(run);
  const evidenceDrafts = drafts.map((draft) => reportDraftToEvidenceDraft(context, draft));
  const matches = Array.isArray(matchItems) ? matchItems.map(matchItemToPersistenceMatch) : [];
  const report = buildEvidencePersistenceDryRunReport({
    drafts: evidenceDrafts,
    matches,
    matchedAt: null,
  });

  return {
    guard: resolveDetectorOnlyPersistenceGuard(env),
    ...report,
  };
}

export function resolveDetectorOnlyPersistenceGuard(
  env: Record<string, string | undefined> = process.env,
): DetectorOnlyDebugPersistenceGuard {
  const configuredMode = emptyToNull(env[EVIDENCE_PERSISTENCE_MODE_ENV])?.toLowerCase() ?? null;
  const baseGuard = getEvidencePersistenceWriteGuard();

  return {
    ...baseGuard,
    envVar: EVIDENCE_PERSISTENCE_MODE_ENV,
    configuredMode,
    allowedMode: "dry_run",
    message: configuredMode && configuredMode !== "dry_run"
      ? `Evidence persistence write mode '${configuredMode}' is blocked. This debug wrapper only supports dry_run.`
      : baseGuard.message,
  };
}

export function reportRunToContext(run: DetectorOnlyReportRun): PriceCaptureRunContext {
  return {
    companyId: run.companyId,
    storeId: run.storeId,
    week: run.week,
    runId: run.runId,
    photoStoragePath: run.photoStoragePath ?? null,
    photoFilename: run.photoFilename ?? null,
    capturedDate: run.capturedDate ?? null,
  };
}

export function reportDraftToEvidenceDraft(run: PriceCaptureRunContext, draft: DetectorOnlyReportDraft): EvidenceDraft {
  return {
    itemId: draft.itemId,
    cropPlan: {
      bbox: draft.bbox,
      cropWidth: draft.crop.width,
      cropHeight: draft.crop.height,
      paddingPx: 0,
      wasClamped: false,
    },
    row: {
      company_id: run.companyId,
      store_id: run.storeId,
      week: run.week,
      processing_run_id: run.runId,
      raw_name: draft.product.rawName || "unknown",
      brand: draft.product.brand,
      size_text: draft.product.sizeText,
      price_minor: draft.product.priceMinor,
      old_price_minor: draft.product.oldPriceMinor,
      promo_price_minor: draft.product.promoPriceMinor,
      currency: draft.product.currency,
      price_tag_text: draft.ocr?.text ?? null,
      product_visible_text: draft.product.productVisibleText,
      confidence: draft.detector.confidence,
      photo_storage_path: run.photoStoragePath ?? null,
      photo_filename: run.photoFilename ?? null,
      captured_date: run.capturedDate ?? null,
      bbox: draft.bbox,
      crop_storage_path: draft.crop.storagePath,
      crop_width: draft.crop.width,
      crop_height: draft.crop.height,
      detector_provider: draft.detector.provider,
      detector_model: draft.detector.model,
      detector_confidence: draft.detector.confidence,
      ocr_provider: draft.ocr?.provider ?? null,
      ocr_model: draft.ocr?.model ?? null,
      ocr_text: draft.ocr?.text ?? null,
      ocr_confidence: draft.ocr?.confidence ?? null,
      parsed_price_confidence: draft.product.parsedPriceConfidence,
      normalized_product_text: draft.product.normalizedProductText,
      review_status: "pending",
      review_reason: draft.review.reason,
      ai_used: false,
    },
  };
}

export function matchItemToPersistenceMatch(item: DetectorOnlyMatchItem): {
  itemId: string;
  match: ProductMatcherResult;
} {
  return {
    itemId: item.itemId,
    match: {
      candidates: [],
      selectedCatalogProductId: item.selectedCatalogProductId,
      matchConfidence: item.matchConfidence,
      matchReason: item.matchReason,
      reviewRequired: item.reviewRequired,
    },
  };
}

function ensureArg(argv: string[], arg: string): string[] {
  return argv.includes(arg) ? argv : [...argv, arg];
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

async function main(): Promise<void> {
  try {
    const json = await runDetectorOnlyDebugPersistFromArgs(process.argv.slice(2));
    console.log(json);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Detector-only debug persistence script failed");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
