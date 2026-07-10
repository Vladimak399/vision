import type { EvidenceDraft, ParsedPriceCandidate } from "./evidence-contract";
import type { PriceParserResult } from "./local-pipeline";

export type ParsedPriceEvidenceItem = {
  itemId: string;
  parsedPrice: PriceParserResult | ParsedPriceCandidate | null;
};

export type ParsedPriceEvidenceMergeMetrics = {
  inputDraftCount: number;
  parsedItemCount: number;
  mergedDraftCount: number;
  pricedDraftCount: number;
  oldPriceDraftCount: number;
  promoPriceDraftCount: number;
};

export type ParsedPriceEvidenceMergeResult = {
  drafts: EvidenceDraft[];
  metrics: ParsedPriceEvidenceMergeMetrics;
};

export function mergeParsedPriceIntoEvidenceDraft(
  draft: EvidenceDraft,
  parsedPrice: PriceParserResult | ParsedPriceCandidate | null,
): EvidenceDraft {
  if (!parsedPrice) return draft;

  const row = { ...draft.row };
  row.price_minor = toNullableInteger(parsedPrice.priceMinor);
  row.old_price_minor = toNullableInteger(parsedPrice.oldPriceMinor);
  row.promo_price_minor = toNullableInteger(parsedPrice.promoPriceMinor);
  row.currency = normalizeCurrency(parsedPrice.currency);
  row.parsed_price_confidence = clampNullableConfidence(parsedPrice.confidence);

  return {
    ...draft,
    row,
  };
}

export function mergeParsedPricesIntoEvidenceDrafts(
  input: {
    drafts: EvidenceDraft[];
    parsedItems: ParsedPriceEvidenceItem[];
  },
): ParsedPriceEvidenceMergeResult {
  const parsedByItemId = new Map(input.parsedItems.map((item) => [item.itemId, item.parsedPrice]));
  let mergedDraftCount = 0;

  const drafts = input.drafts.map((draft) => {
    if (!parsedByItemId.has(draft.itemId)) return draft;
    const parsedPrice = parsedByItemId.get(draft.itemId) ?? null;
    if (!parsedPrice) return draft;
    mergedDraftCount += 1;
    return mergeParsedPriceIntoEvidenceDraft(draft, parsedPrice);
  });

  return {
    drafts,
    metrics: {
      inputDraftCount: input.drafts.length,
      parsedItemCount: input.parsedItems.length,
      mergedDraftCount,
      pricedDraftCount: drafts.filter((draft) => draft.row.price_minor !== null).length,
      oldPriceDraftCount: drafts.filter((draft) => draft.row.old_price_minor !== null).length,
      promoPriceDraftCount: drafts.filter((draft) => draft.row.promo_price_minor !== null).length,
    },
  };
}

function normalizeCurrency(value?: string | null): string {
  const normalized = emptyToNull(value)?.toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : "RUB";
}

function toNullableInteger(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function clampNullableConfidence(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}
