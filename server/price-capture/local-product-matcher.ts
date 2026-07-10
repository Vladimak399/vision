import {
  buildCatalogMatchKey,
  getCatalogMatchCandidates,
  type CatalogMatchCandidate,
  type CatalogMatchProduct,
  type RecognizedMatchInput,
} from "../catalog-matching";
import type { EvidenceDraft, ParsedPriceCandidate, ProductTextCandidate, PriceCaptureRunContext } from "./evidence-contract";
import type { PriceParserResult, ProductMatcher, ProductMatcherInput, ProductMatcherResult, ProductTextExtractorResult } from "./local-pipeline";

export const LOCAL_CATALOG_MATCHER_PROVIDER = {
  provider: "local",
  model: "catalog-fuzzy-matcher-v1",
  version: "PV-06-01",
} as const;

export type LocalProductMatcherOptions = {
  candidateLimit?: number;
  autoSelectThreshold?: number;
  reviewThreshold?: number;
  ambiguityDelta?: number;
};

export type LocalCatalogCandidateDto = {
  catalogProductId: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  score: number;
  reasons: string[];
};

export type LocalProductMatchDebugItem = {
  itemId: string;
  rawName: string | null;
  normalizedProductText: string | null;
  matchKey: string | null;
  selectedCatalogProductId: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
  reviewRequired: boolean;
  candidates: LocalCatalogCandidateDto[];
};

export type LocalProductMatchDebugMetrics = {
  inputDraftCount: number;
  catalogSize: number;
  matchedCount: number;
  selectedCount: number;
  needsReviewCount: number;
  noCandidateCount: number;
};

export type LocalProductMatchDebugResult = {
  provider: typeof LOCAL_CATALOG_MATCHER_PROVIDER;
  metrics: LocalProductMatchDebugMetrics;
  items: LocalProductMatchDebugItem[];
};

export type ProductMatchDraftItem = {
  itemId: string;
  draft: EvidenceDraft;
  productText?: ProductTextExtractorResult | ProductTextCandidate | null;
  parsedPrice?: PriceParserResult | ParsedPriceCandidate | null;
};

const DEFAULT_OPTIONS: Required<LocalProductMatcherOptions> = {
  candidateLimit: 5,
  autoSelectThreshold: 0.82,
  reviewThreshold: 0.7,
  ambiguityDelta: 0.04,
};

export function createLocalCatalogProductMatcher(options: LocalProductMatcherOptions = {}): ProductMatcher {
  return new LocalCatalogProductMatcher(options);
}

export class LocalCatalogProductMatcher implements ProductMatcher {
  private readonly options: Required<LocalProductMatcherOptions>;

  constructor(options: LocalProductMatcherOptions = {}) {
    this.options = normalizeOptions(options);
  }

  async match(input: ProductMatcherInput): Promise<ProductMatcherResult> {
    const recognized = productTextToRecognizedMatchInput(input.productText);
    const candidates = getCatalogMatchCandidates(recognized, input.catalog, { limit: this.options.candidateLimit });
    return buildProductMatcherResult(candidates, this.options);
  }
}

export function productTextToRecognizedMatchInput(productText: ProductTextCandidate | null): RecognizedMatchInput {
  return {
    rawName: emptyToNull(productText?.rawName) ?? emptyToNull(productText?.normalizedProductText),
    brand: emptyToNull(productText?.brand),
    sizeText: emptyToNull(productText?.sizeText),
    priceTagText: emptyToNull(productText?.priceTagText),
    productVisibleText: emptyToNull(productText?.productVisibleText),
  };
}

export function evidenceDraftToProductTextCandidate(draft: EvidenceDraft): ProductTextCandidate {
  return {
    rawName: draft.row.raw_name,
    brand: draft.row.brand,
    sizeText: draft.row.size_text,
    priceTagText: draft.row.price_tag_text,
    productVisibleText: draft.row.product_visible_text,
    normalizedProductText: draft.row.normalized_product_text,
  };
}

export function evidenceDraftToParsedPriceCandidate(draft: EvidenceDraft): ParsedPriceCandidate | null {
  if (
    draft.row.price_minor === null
    && draft.row.old_price_minor === null
    && draft.row.promo_price_minor === null
    && draft.row.parsed_price_confidence === null
  ) {
    return null;
  }

  return {
    priceMinor: draft.row.price_minor,
    oldPriceMinor: draft.row.old_price_minor,
    promoPriceMinor: draft.row.promo_price_minor,
    currency: draft.row.currency,
    confidence: draft.row.parsed_price_confidence,
  };
}

export function buildProductMatcherInputFromEvidenceDraft(input: {
  run: PriceCaptureRunContext;
  draft: EvidenceDraft;
  catalog: CatalogMatchProduct[];
  productText?: ProductTextExtractorResult | ProductTextCandidate | null;
  parsedPrice?: PriceParserResult | ParsedPriceCandidate | null;
}): ProductMatcherInput {
  return {
    run: input.run,
    productText: input.productText ?? evidenceDraftToProductTextCandidate(input.draft),
    parsedPrice: input.parsedPrice ?? evidenceDraftToParsedPriceCandidate(input.draft),
    catalog: input.catalog,
  };
}

export async function runLocalProductMatcherForDraftItems(input: {
  run: PriceCaptureRunContext;
  drafts: EvidenceDraft[];
  catalog: CatalogMatchProduct[];
  productTextItems?: Array<{ itemId: string; productText: ProductTextExtractorResult | ProductTextCandidate | null }>;
  parsedItems?: Array<{ itemId: string; parsedPrice: PriceParserResult | ParsedPriceCandidate | null }>;
  matcher?: ProductMatcher;
}): Promise<LocalProductMatchDebugResult> {
  const matcher = input.matcher ?? createLocalCatalogProductMatcher();
  const productTextByItemId = new Map((input.productTextItems ?? []).map((item) => [item.itemId, item.productText]));
  const parsedPriceByItemId = new Map((input.parsedItems ?? []).map((item) => [item.itemId, item.parsedPrice]));
  const items: LocalProductMatchDebugItem[] = [];

  for (const draft of input.drafts) {
    const productText = productTextByItemId.has(draft.itemId)
      ? productTextByItemId.get(draft.itemId) ?? null
      : evidenceDraftToProductTextCandidate(draft);
    const parsedPrice = parsedPriceByItemId.has(draft.itemId)
      ? parsedPriceByItemId.get(draft.itemId) ?? null
      : evidenceDraftToParsedPriceCandidate(draft);
    const matchInput = buildProductMatcherInputFromEvidenceDraft({
      run: input.run,
      draft,
      catalog: input.catalog,
      productText,
      parsedPrice,
    });
    const match = await matcher.match(matchInput);
    items.push(productMatchToDebugItem({
      itemId: draft.itemId,
      productText: matchInput.productText,
      match,
    }));
  }

  return buildLocalProductMatchDebugResult({
    catalogSize: input.catalog.filter((product) => product.is_active !== false).length,
    inputDraftCount: input.drafts.length,
    items,
  });
}

export function buildProductMatcherResult(
  candidates: CatalogMatchCandidate[],
  options: LocalProductMatcherOptions = {},
): ProductMatcherResult {
  const resolved = normalizeOptions(options);
  const top = candidates[0] ?? null;
  const second = candidates[1] ?? null;

  if (!top) {
    return {
      candidates: [],
      selectedCatalogProductId: null,
      matchConfidence: null,
      matchReason: "no_candidates",
      reviewRequired: true,
    };
  }

  const reviewReason = resolveReviewReason(top, second, resolved);
  const selectedCatalogProductId = top.score >= resolved.autoSelectThreshold && reviewReason === null
    ? top.product.id
    : null;

  return {
    candidates,
    selectedCatalogProductId,
    matchConfidence: clampConfidence(top.score),
    matchReason: [reviewReason, ...top.reasons].filter(Boolean).join("|") || "candidate",
    reviewRequired: selectedCatalogProductId === null,
  };
}

export function productMatchToDebugItem(input: {
  itemId: string;
  productText: ProductTextCandidate;
  match: ProductMatcherResult;
}): LocalProductMatchDebugItem {
  const recognized = productTextToRecognizedMatchInput(input.productText);
  return {
    itemId: input.itemId,
    rawName: emptyToNull(input.productText.rawName),
    normalizedProductText: emptyToNull(input.productText.normalizedProductText),
    matchKey: emptyToNull(buildCatalogMatchKey(recognized)),
    selectedCatalogProductId: input.match.selectedCatalogProductId,
    matchConfidence: input.match.matchConfidence,
    matchReason: input.match.matchReason,
    reviewRequired: input.match.reviewRequired,
    candidates: input.match.candidates.map(catalogMatchCandidateToDto),
  };
}

export function catalogMatchCandidateToDto(candidate: CatalogMatchCandidate): LocalCatalogCandidateDto {
  return {
    catalogProductId: candidate.product.id,
    name: candidate.product.name,
    brand: candidate.product.brand,
    sizeText: candidate.product.size_text,
    score: clampConfidence(candidate.score),
    reasons: candidate.reasons,
  };
}

export function buildLocalProductMatchDebugResult(input: {
  inputDraftCount: number;
  catalogSize: number;
  items: LocalProductMatchDebugItem[];
}): LocalProductMatchDebugResult {
  return {
    provider: LOCAL_CATALOG_MATCHER_PROVIDER,
    metrics: {
      inputDraftCount: input.inputDraftCount,
      catalogSize: input.catalogSize,
      matchedCount: input.items.filter((item) => item.candidates.length > 0).length,
      selectedCount: input.items.filter((item) => item.selectedCatalogProductId !== null).length,
      needsReviewCount: input.items.filter((item) => item.reviewRequired).length,
      noCandidateCount: input.items.filter((item) => item.candidates.length === 0).length,
    },
    items: input.items,
  };
}

function resolveReviewReason(
  top: CatalogMatchCandidate,
  second: CatalogMatchCandidate | null,
  options: Required<LocalProductMatcherOptions>,
): string | null {
  if (top.score < options.reviewThreshold) return "low_confidence_review";
  if (top.reasons.some((reason) => reason.endsWith("_review") || reason.includes("review"))) {
    return "catalog_candidate_review";
  }
  if (second && Math.abs(top.score - second.score) <= options.ambiguityDelta) return "ambiguous_catalog_candidates_review";
  return null;
}

function normalizeOptions(options: LocalProductMatcherOptions): Required<LocalProductMatcherOptions> {
  return {
    candidateLimit: normalizePositiveInteger(options.candidateLimit, DEFAULT_OPTIONS.candidateLimit),
    autoSelectThreshold: normalizeUnit(options.autoSelectThreshold, DEFAULT_OPTIONS.autoSelectThreshold),
    reviewThreshold: normalizeUnit(options.reviewThreshold, DEFAULT_OPTIONS.reviewThreshold),
    ambiguityDelta: normalizeUnit(options.ambiguityDelta, DEFAULT_OPTIONS.ambiguityDelta),
  };
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

function normalizeUnit(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clampConfidence(value);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(Math.max(value, 0), 1) * 10000) / 10000;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
