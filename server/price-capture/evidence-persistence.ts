import type { EvidenceDraft } from "./evidence-contract";
import type { EvidenceWriter, EvidenceWriterInput, EvidenceWriteResult, ProductMatcherResult } from "./local-pipeline";

export const COMPETITOR_SHELF_ITEMS_TABLE = "competitor_shelf_items" as const;
export const EVIDENCE_PERSISTENCE_MODE = "dry_run" as const;

export type CompetitorShelfItemInsertPayload = EvidenceDraft["row"] & {
  catalog_product_id: string | null;
  match_confidence: number | null;
  match_reason: string | null;
  matched_at: string | null;
};

export type EvidencePersistenceMatchItem = {
  itemId: string;
  match: ProductMatcherResult | null;
};

export type EvidencePersistenceDryRunItem = {
  itemId: string;
  operation: "insert";
  table: typeof COMPETITOR_SHELF_ITEMS_TABLE;
  writeEnabled: false;
  cropStoragePath: string;
  rawName: string;
  priceMinor: number | null;
  catalogProductId: string | null;
  matchConfidence: number | null;
  reviewRequired: boolean;
  reviewReason: string;
  payload: CompetitorShelfItemInsertPayload;
};

export type EvidencePersistenceDryRunMetrics = {
  inputDraftCount: number;
  insertPayloadCount: number;
  matchedCount: number;
  needsReviewCount: number;
  unmatchedCount: number;
  pricedCount: number;
  ocrTextCount: number;
  aiUsedCount: number;
};

export type EvidencePersistenceDryRunReport = {
  mode: typeof EVIDENCE_PERSISTENCE_MODE;
  table: typeof COMPETITOR_SHELF_ITEMS_TABLE;
  writeEnabled: false;
  metrics: EvidencePersistenceDryRunMetrics;
  items: EvidencePersistenceDryRunItem[];
};

export type EvidencePersistenceWriteGuard = {
  writeEnabled: false;
  reason: "persistence_dry_run_only";
  message: string;
};

export type BuildEvidencePersistenceDryRunReportInput = {
  drafts: EvidenceDraft[];
  matches?: EvidencePersistenceMatchItem[];
  matchedAt?: string | null;
};

export function buildCompetitorShelfItemInsertPayload(input: {
  draft: EvidenceDraft;
  match?: ProductMatcherResult | null;
  matchedAt?: string | null;
}): CompetitorShelfItemInsertPayload {
  const match = input.match ?? null;
  const selectedCatalogProductId = normalizeId(match?.selectedCatalogProductId);
  const matchConfidence = clampNullableConfidence(match?.matchConfidence);
  const matchReason = emptyToNull(match?.matchReason);
  const autoMatched = Boolean(selectedCatalogProductId && match?.reviewRequired === false);

  return {
    ...input.draft.row,
    catalog_product_id: selectedCatalogProductId,
    match_confidence: matchConfidence,
    match_reason: matchReason,
    matched_at: autoMatched ? emptyToNull(input.matchedAt) : null,
    review_reason: resolveReviewReason(input.draft.row.review_reason, match),
  };
}

export function buildEvidencePersistenceDryRunReport(
  input: BuildEvidencePersistenceDryRunReportInput,
): EvidencePersistenceDryRunReport {
  const matchByItemId = new Map((input.matches ?? []).map((item) => [item.itemId, item.match]));
  const items = input.drafts.map((draft) => {
    const match = matchByItemId.has(draft.itemId) ? matchByItemId.get(draft.itemId) ?? null : null;
    const payload = buildCompetitorShelfItemInsertPayload({
      draft,
      match,
      matchedAt: input.matchedAt ?? null,
    });

    return buildDryRunItem({ draft, match, payload });
  });

  return {
    mode: EVIDENCE_PERSISTENCE_MODE,
    table: COMPETITOR_SHELF_ITEMS_TABLE,
    writeEnabled: false,
    metrics: buildDryRunMetrics(input.drafts, items),
    items,
  };
}

export function createDryRunEvidenceWriter(): EvidenceWriter {
  return new DryRunEvidenceWriter();
}

export class DryRunEvidenceWriter implements EvidenceWriter {
  async write(input: EvidenceWriterInput): Promise<EvidenceWriteResult> {
    const payload = buildCompetitorShelfItemInsertPayload({
      draft: input.draft,
      match: input.match,
    });

    return {
      itemId: input.draft.itemId,
      rowId: null,
      cropStoragePath: payload.crop_storage_path,
      reviewRequired: input.match?.reviewRequired ?? true,
    };
  }
}

export function getEvidencePersistenceWriteGuard(): EvidencePersistenceWriteGuard {
  return {
    writeEnabled: false,
    reason: "persistence_dry_run_only",
    message: "Evidence persistence is intentionally disabled. Use dry-run payloads until Supabase write permissions, storage policy, and review flow are explicitly wired.",
  };
}

function buildDryRunItem(input: {
  draft: EvidenceDraft;
  match: ProductMatcherResult | null;
  payload: CompetitorShelfItemInsertPayload;
}): EvidencePersistenceDryRunItem {
  const reviewRequired = input.match?.reviewRequired ?? true;

  return {
    itemId: input.draft.itemId,
    operation: "insert",
    table: COMPETITOR_SHELF_ITEMS_TABLE,
    writeEnabled: false,
    cropStoragePath: input.payload.crop_storage_path,
    rawName: input.payload.raw_name,
    priceMinor: input.payload.price_minor,
    catalogProductId: input.payload.catalog_product_id,
    matchConfidence: input.payload.match_confidence,
    reviewRequired,
    reviewReason: input.payload.review_reason,
    payload: input.payload,
  };
}

function buildDryRunMetrics(
  drafts: EvidenceDraft[],
  items: EvidencePersistenceDryRunItem[],
): EvidencePersistenceDryRunMetrics {
  const matchedCount = items.filter((item) => item.catalogProductId !== null && !item.reviewRequired).length;
  const needsReviewCount = items.filter((item) => item.reviewRequired).length;

  return {
    inputDraftCount: drafts.length,
    insertPayloadCount: items.length,
    matchedCount,
    needsReviewCount,
    unmatchedCount: Math.max(0, items.length - matchedCount),
    pricedCount: drafts.filter((draft) => draft.row.price_minor !== null).length,
    ocrTextCount: drafts.filter((draft) => Boolean(emptyToNull(draft.row.ocr_text))).length,
    aiUsedCount: drafts.filter((draft) => draft.row.ai_used).length,
  };
}

function resolveReviewReason(defaultReason: string, match: ProductMatcherResult | null): string {
  if (!match) return defaultReason;
  if (match.reviewRequired) return emptyToNull(match.matchReason) ?? defaultReason;
  return "auto_matched";
}

function normalizeId(value?: string | null): string | null {
  const normalized = emptyToNull(value);
  if (!normalized) return null;
  return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
}

function emptyToNull(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function clampNullableConfidence(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(Math.max(value, 0), 1) * 10000) / 10000;
}
