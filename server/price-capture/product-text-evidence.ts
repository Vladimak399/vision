import type { EvidenceDraft, ProductTextCandidate } from "./evidence-contract";
import type { ProductTextExtractorResult } from "./local-pipeline";

export type ProductTextEvidenceItem = {
  itemId: string;
  productText: ProductTextExtractorResult | ProductTextCandidate | null;
};

export type ProductTextEvidenceMergeOptions = {
  updateRawName?: boolean;
  fillPriceTagText?: boolean;
};

export type ProductTextEvidenceMergeMetrics = {
  inputDraftCount: number;
  productTextItemCount: number;
  mergedDraftCount: number;
  namedDraftCount: number;
  normalizedDraftCount: number;
};

export type ProductTextEvidenceMergeResult = {
  drafts: EvidenceDraft[];
  metrics: ProductTextEvidenceMergeMetrics;
};

const DEFAULT_OPTIONS: Required<ProductTextEvidenceMergeOptions> = {
  updateRawName: true,
  fillPriceTagText: true,
};

export function mergeProductTextIntoEvidenceDraft(
  draft: EvidenceDraft,
  productText: ProductTextExtractorResult | ProductTextCandidate | null,
  options: ProductTextEvidenceMergeOptions = {},
): EvidenceDraft {
  if (!productText) return draft;

  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const row = { ...draft.row };
  const rawName = emptyToNull(productText.rawName);
  const normalizedProductText = emptyToNull(productText.normalizedProductText);

  if (rawName && (resolved.updateRawName || isUnknownRawName(row.raw_name))) {
    row.raw_name = rawName;
  }

  row.brand = emptyToNull(productText.brand) ?? row.brand;
  row.size_text = emptyToNull(productText.sizeText) ?? row.size_text;
  row.product_visible_text = emptyToNull(productText.productVisibleText) ?? row.product_visible_text;
  row.normalized_product_text = normalizedProductText ?? row.normalized_product_text;

  if (resolved.fillPriceTagText && !emptyToNull(row.price_tag_text)) {
    row.price_tag_text = emptyToNull(productText.priceTagText) ?? row.price_tag_text;
  }

  return {
    ...draft,
    row,
  };
}

export function mergeProductTextsIntoEvidenceDrafts(
  input: {
    drafts: EvidenceDraft[];
    productTextItems: ProductTextEvidenceItem[];
    options?: ProductTextEvidenceMergeOptions;
  },
): ProductTextEvidenceMergeResult {
  const productTextByItemId = new Map(input.productTextItems.map((item) => [item.itemId, item.productText]));
  let mergedDraftCount = 0;

  const drafts = input.drafts.map((draft) => {
    if (!productTextByItemId.has(draft.itemId)) return draft;
    const productText = productTextByItemId.get(draft.itemId) ?? null;
    if (!productText) return draft;
    mergedDraftCount += 1;
    return mergeProductTextIntoEvidenceDraft(draft, productText, input.options);
  });

  return {
    drafts,
    metrics: {
      inputDraftCount: input.drafts.length,
      productTextItemCount: input.productTextItems.length,
      mergedDraftCount,
      namedDraftCount: drafts.filter((draft) => !isUnknownRawName(draft.row.raw_name)).length,
      normalizedDraftCount: drafts.filter((draft) => Boolean(emptyToNull(draft.row.normalized_product_text))).length,
    },
  };
}

function isUnknownRawName(value: string | null | undefined): boolean {
  const normalized = emptyToNull(value)?.toLowerCase();
  return !normalized || normalized === "unknown";
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
