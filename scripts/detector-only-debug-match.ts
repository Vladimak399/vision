import {
  parseDetectorOnlyDebugArgs,
  runDetectorOnlyDebug,
  type DetectorOnlyDebugCliOptions,
} from "./detector-only-debug";
import {
  runDebugProductMatching,
  type DebugProductMatchResult,
} from "../server/price-capture/debug-product-match-runner";
import type {
  ParsedPriceCandidate,
  PriceCaptureRunContext,
  ProductTextCandidate,
} from "../server/price-capture/evidence-contract";

export type DetectorOnlyDebugMatchCliParseResult =
  | { ok: true; argv: string[]; matchProduct: boolean }
  | { ok: false; error: string };

export type DetectorOnlyDebugMatchResponse = Record<string, unknown> & {
  match: DebugProductMatchResult;
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
  product?: {
    rawName?: string | null;
    normalizedProductText?: string | null;
    productVisibleText?: string | null;
    brand?: string | null;
    sizeText?: string | null;
    priceMinor?: number | null;
    oldPriceMinor?: number | null;
    promoPriceMinor?: number | null;
    parsedPriceConfidence?: number | null;
    currency?: string | null;
  };
};

const MATCH_FLAGS = new Set(["--match-product", "--with-match", "--match"]);

export function parseDetectorOnlyDebugMatchArgs(argv: string[]): DetectorOnlyDebugMatchCliParseResult {
  const stripped: string[] = [];
  let matchProduct = false;

  for (const token of argv) {
    if (MATCH_FLAGS.has(token)) {
      matchProduct = true;
      continue;
    }
    stripped.push(token);
  }

  return { ok: true, argv: stripped, matchProduct };
}

export async function runDetectorOnlyDebugMatchFromArgs(argv: string[]): Promise<string> {
  const matchParsed = parseDetectorOnlyDebugMatchArgs(argv);
  if (!matchParsed.ok) throw new Error(matchParsed.error);

  const parsed = parseDetectorOnlyDebugArgs(matchParsed.argv);
  if (!parsed.ok) throw new Error(parsed.error);

  if (!matchParsed.matchProduct) return runDetectorOnlyDebug(parsed.options);
  return runDetectorOnlyDebugWithMatch(parsed.options);
}

export async function runDetectorOnlyDebugWithMatch(options: DetectorOnlyDebugCliOptions): Promise<string> {
  const optionsWithProductText: DetectorOnlyDebugCliOptions = {
    ...options,
    withOcr: true,
    parsePrice: true,
    extractProductText: true,
  };
  const baseJson = await runDetectorOnlyDebug(optionsWithProductText);
  const baseResponse = JSON.parse(baseJson) as { report?: { run?: DetectorOnlyReportRun; drafts?: DetectorOnlyReportDraft[] } } & Record<string, unknown>;
  const report = baseResponse.report;

  if (!report?.run || !Array.isArray(report.drafts)) {
    throw new Error("Detector-only debug response does not contain report.run/report.drafts for matching.");
  }

  const match = await runDebugProductMatching({
    run: reportRunToContext(report.run),
    items: report.drafts.map(reportDraftToMatchItem),
  });

  return JSON.stringify({ ...baseResponse, match } satisfies DetectorOnlyDebugMatchResponse, null, options.pretty ? 2 : 0);
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

export function reportDraftToMatchItem(draft: DetectorOnlyReportDraft): {
  itemId: string;
  productText: ProductTextCandidate;
  parsedPrice: ParsedPriceCandidate | null;
} {
  const product = draft.product ?? {};
  return {
    itemId: draft.itemId,
    productText: {
      rawName: product.rawName ?? null,
      normalizedProductText: product.normalizedProductText ?? null,
      productVisibleText: product.productVisibleText ?? null,
      brand: product.brand ?? null,
      sizeText: product.sizeText ?? null,
    },
    parsedPrice: priceFromReportProduct(product),
  };
}

function priceFromReportProduct(product: NonNullable<DetectorOnlyReportDraft["product"]>): ParsedPriceCandidate | null {
  if (
    product.priceMinor === null
    && product.oldPriceMinor === null
    && product.promoPriceMinor === null
    && product.parsedPriceConfidence === null
  ) {
    return null;
  }

  return {
    priceMinor: product.priceMinor ?? null,
    oldPriceMinor: product.oldPriceMinor ?? null,
    promoPriceMinor: product.promoPriceMinor ?? null,
    confidence: product.parsedPriceConfidence ?? null,
    currency: product.currency ?? null,
  };
}

async function main(): Promise<void> {
  try {
    const json = await runDetectorOnlyDebugMatchFromArgs(process.argv.slice(2));
    console.log(json);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Detector-only debug match script failed");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main();
}
