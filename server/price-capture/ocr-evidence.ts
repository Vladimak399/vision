import type { EvidenceDraft } from "./evidence-contract";
import type { LocalOcrResult } from "./local-ocr";
import type { LocalOcrDraftRunResult } from "./ocr-crop";

export type OcrEvidenceMergeOptions = {
  /** Replace raw_name="unknown" with OCR text when OCR has readable text. */
  updateUnknownRawName?: boolean;
  /** Fill price_tag_text from OCR text when it is currently empty. */
  fillPriceTagText?: boolean;
};

export type OcrEvidenceMergeMetrics = {
  inputDraftCount: number;
  mergedDraftCount: number;
  ocrProcessedCount: number;
  ocrTextResultCount: number;
  ocrEmptyResultCount: number;
  ocrSkippedCount: number;
  ocrFailedCount: number;
};

export type OcrEvidenceMergeResult = {
  drafts: EvidenceDraft[];
  metrics: OcrEvidenceMergeMetrics;
};

const DEFAULT_OPTIONS: Required<OcrEvidenceMergeOptions> = {
  updateUnknownRawName: true,
  fillPriceTagText: true,
};

export function mergeOcrResultIntoEvidenceDraft(
  draft: EvidenceDraft,
  ocr: LocalOcrResult,
  options: OcrEvidenceMergeOptions = {},
): EvidenceDraft {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const ocrText = emptyToNull(ocr.text);
  const row = { ...draft.row };

  row.ocr_provider = emptyToNull(ocr.provider);
  row.ocr_model = emptyToNull(ocr.model);
  row.ocr_text = ocrText;
  row.ocr_confidence = clampNullableConfidence(ocr.confidence);

  if (ocrText && resolved.updateUnknownRawName && isUnknownRawName(row.raw_name)) {
    row.raw_name = ocrText;
  }

  if (ocrText && resolved.fillPriceTagText && !emptyToNull(row.price_tag_text)) {
    row.price_tag_text = ocrText;
  }

  return {
    ...draft,
    row,
  };
}

export function mergeLocalOcrRunIntoEvidenceDrafts(
  input: {
    drafts: EvidenceDraft[];
    ocrRun: LocalOcrDraftRunResult;
    options?: OcrEvidenceMergeOptions;
  },
): OcrEvidenceMergeResult {
  const ocrByItemId = new Map(input.ocrRun.items.map((item) => [item.itemId, item.ocr]));
  let mergedDraftCount = 0;

  const drafts = input.drafts.map((draft) => {
    const ocr = ocrByItemId.get(draft.itemId);
    if (!ocr) return draft;
    mergedDraftCount += 1;
    return mergeOcrResultIntoEvidenceDraft(draft, ocr, input.options);
  });

  return {
    drafts,
    metrics: {
      inputDraftCount: input.drafts.length,
      mergedDraftCount,
      ocrProcessedCount: input.ocrRun.metrics.processedCount,
      ocrTextResultCount: input.ocrRun.metrics.textResultCount,
      ocrEmptyResultCount: input.ocrRun.metrics.emptyResultCount,
      ocrSkippedCount: input.ocrRun.metrics.skippedCount,
      ocrFailedCount: input.ocrRun.metrics.failedCount,
    },
  };
}

function isUnknownRawName(value: string | null | undefined): boolean {
  const normalized = emptyToNull(value)?.toLowerCase();
  return !normalized || normalized === "unknown";
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
