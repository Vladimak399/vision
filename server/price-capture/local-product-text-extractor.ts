import type { ProductTextCandidate } from "./evidence-contract";
import type {
  PipelineProviderInfo,
  ProductTextExtractor,
  ProductTextExtractorInput,
  ProductTextExtractorResult,
} from "./local-pipeline";

export const LOCAL_PRODUCT_TEXT_EXTRACTOR_PROVIDER: PipelineProviderInfo = {
  provider: "local",
  model: "ru-product-text-extractor-heuristic-v1",
  version: "PV-04-08",
};

export type ProductTextNoiseRemovalResult = {
  originalText: string;
  cleanedText: string;
  removedLineCount: number;
  keptLineCount: number;
  removedFragments: string[];
};

export type LocalProductTextExtractorResult = ProductTextExtractorResult & {
  provider: string;
  model: string;
  isEmpty: boolean;
  noise: ProductTextNoiseRemovalResult;
};

export type LocalProductTextExtractorOptions = {
  provider?: PipelineProviderInfo;
  maxRawNameLength?: number;
};

const DEFAULT_MAX_RAW_NAME_LENGTH = 180;
const PRICE_LABEL_RE = /\b(цена|стоим(?:ость)?|руб(?:\.|лей|ля|ль)?|р\.?|₽|акц(?:ия)?|скид(?:ка)?|старая|стар\.?|новая|нов\.?|было|обычная|обычн\.?)\b/iu;
const PRICE_ONLY_RE = /^[\s\d.,:;\-–—₽рруб]+$/iu;
const UNIT_ONLY_RE = /^\s*\d+(?:[,.]\d+)?\s*(?:г|гр|кг|мл|л|шт|pcs)\.?\s*$/iu;
const LETTER_RE = /[\p{L}]/u;
const MULTISPACE_RE = /[ \t]{2,}/g;

export function createLocalProductTextExtractor(
  options: LocalProductTextExtractorOptions = {},
): ProductTextExtractor {
  return new LocalProductTextExtractor(options);
}

export class LocalProductTextExtractor implements ProductTextExtractor {
  readonly provider: PipelineProviderInfo;
  private readonly maxRawNameLength: number;

  constructor(options: LocalProductTextExtractorOptions = {}) {
    this.provider = options.provider ?? LOCAL_PRODUCT_TEXT_EXTRACTOR_PROVIDER;
    this.maxRawNameLength = normalizeMaxLength(options.maxRawNameLength, DEFAULT_MAX_RAW_NAME_LENGTH);
  }

  async extract(input: ProductTextExtractorInput): Promise<ProductTextExtractorResult> {
    return extractProductTextFromOcr(input, {
      provider: this.provider,
      maxRawNameLength: this.maxRawNameLength,
    });
  }
}

export function extractProductTextFromOcr(
  input: ProductTextExtractorInput,
  options: LocalProductTextExtractorOptions = {},
): LocalProductTextExtractorResult {
  const provider = options.provider ?? LOCAL_PRODUCT_TEXT_EXTRACTOR_PROVIDER;
  const maxRawNameLength = normalizeMaxLength(options.maxRawNameLength, DEFAULT_MAX_RAW_NAME_LENGTH);
  const ocrText = normalizeOcrText(input.ocr?.text);
  const noise = removeParsedPriceNoise(ocrText, input.parsedPrice);
  const rawName = truncateText(emptyToNull(noise.cleanedText), maxRawNameLength);
  const normalizedProductText = normalizeProductText(rawName);

  return {
    rawName,
    brand: null,
    sizeText: null,
    priceTagText: emptyToNull(ocrText),
    productVisibleText: rawName,
    normalizedProductText,
    diagnostics: {
      source: "ocr_text",
      inputLength: ocrText.length,
      removedLineCount: noise.removedLineCount,
      keptLineCount: noise.keptLineCount,
      removedFragments: noise.removedFragments,
    },
    provider: normalizeProviderField(provider.provider, "local"),
    model: normalizeProviderField(provider.model, "unknown-product-text-extractor"),
    isEmpty: rawName === null,
    noise,
  };
}

export function removeParsedPriceNoise(
  text: string | null | undefined,
  parsedPrice: ProductTextExtractorInput["parsedPrice"] | null,
): ProductTextNoiseRemovalResult {
  const originalText = normalizeOcrText(text);
  const priceFragments = extractPriceFragments(parsedPrice);
  const keptLines: string[] = [];
  const removedFragments: string[] = [];
  let removedLineCount = 0;

  for (const rawLine of originalText.split(/\n/g)) {
    const line = normalizeLine(rawLine);
    if (!line) continue;

    if (shouldDropLine(line, priceFragments)) {
      removedLineCount += 1;
      removedFragments.push(line);
      continue;
    }

    const cleanedLine = cleanPriceFragmentsFromLine(line, priceFragments);
    if (!cleanedLine || shouldDropLine(cleanedLine, [])) {
      removedLineCount += 1;
      removedFragments.push(line);
      continue;
    }

    keptLines.push(cleanedLine);
  }

  return {
    originalText,
    cleanedText: dedupeLines(keptLines).join("\n"),
    removedLineCount,
    keptLineCount: keptLines.length,
    removedFragments,
  };
}

export function normalizeProductText(value: string | null | undefined): string | null {
  const normalized = normalizeLine(value)
    .toLowerCase()
    .replace(/["'`´«»“”]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(MULTISPACE_RE, " ")
    .trim();

  return normalized || null;
}

function shouldDropLine(line: string, priceFragments: string[]): boolean {
  if (!LETTER_RE.test(line) && PRICE_ONLY_RE.test(line)) return true;
  if (UNIT_ONLY_RE.test(line)) return true;

  const normalizedLine = normalizeForMatch(line);
  if (priceFragments.some((fragment) => normalizedLine === normalizeForMatch(fragment))) return true;

  const hasPriceFragment = priceFragments.some((fragment) => normalizedLine.includes(normalizeForMatch(fragment)));
  const hasPriceLabel = PRICE_LABEL_RE.test(line);
  const digitCount = (line.match(/\d/g) ?? []).length;

  if (hasPriceFragment && hasPriceLabel) return true;
  if (hasPriceLabel && digitCount >= 2 && line.length <= 40) return true;

  return false;
}

function cleanPriceFragmentsFromLine(line: string, priceFragments: string[]): string {
  let cleaned = line;

  for (const fragment of priceFragments) {
    if (!fragment) continue;
    cleaned = replaceAllLoose(cleaned, fragment, " ");
  }

  cleaned = cleaned
    .replace(/\b(цена|стоимость|руб(?:\.|лей|ля|ль)?|р\.?|₽|акция|акц|скидка|скид|старая|стар\.?|новая|нов\.?|было|обычная|обычн\.?)\b/giu, " ")
    .replace(/[₽]/g, " ")
    .replace(/\s*[.,:;\-–—]+\s*$/g, "")
    .replace(MULTISPACE_RE, " ")
    .trim();

  return cleaned;
}

function extractPriceFragments(parsedPrice: ProductTextExtractorInput["parsedPrice"] | null): string[] {
  const diagnostics = parsedPrice?.diagnostics;
  const fragments = [
    stringFromDiagnostics(diagnostics, "selectedText"),
    stringFromDiagnostics(diagnostics, "oldPriceText"),
    stringFromDiagnostics(diagnostics, "promoPriceText"),
  ];

  return Array.from(new Set(fragments.map((value) => normalizeLine(value)).filter(Boolean)));
}

function stringFromDiagnostics(diagnostics: Record<string, unknown> | undefined, key: string): string | null {
  const value = diagnostics?.[key];
  return typeof value === "string" ? value : null;
}

function replaceAllLoose(input: string, needle: string, replacement: string): string {
  const escaped = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return input;
  return input.replace(new RegExp(escaped.replace(/\s+/g, "\\s+"), "giu"), replacement);
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const line of lines) {
    const key = normalizeForMatch(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }

  return deduped;
}

function normalizeOcrText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/[\t\r]+/g, " ")
    .split(/\n/g)
    .map(normalizeLine)
    .filter(Boolean)
    .join("\n");
}

function normalizeLine(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(MULTISPACE_RE, " ").trim();
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function truncateText(value: string | null, maxLength: number): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trim() || null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeMaxLength(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(20, Math.trunc(value));
}

function normalizeProviderField(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}
