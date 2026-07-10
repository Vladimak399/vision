import type { ParsedPriceCandidate } from "./evidence-contract";
import type { PipelineProviderInfo, PriceParser, PriceParserInput, PriceParserResult } from "./local-pipeline";

export const RUSSIAN_PRICE_PARSER_PROVIDER: PipelineProviderInfo = {
  provider: "local",
  model: "ru-price-parser-heuristic-v1",
  version: "PV-04-02",
};

export type LocalPriceParserCandidateKind = "regular" | "old" | "promo";

export type LocalPriceParserCandidate = {
  text: string;
  priceMinor: number;
  currency: string;
  confidence: number;
  kind: LocalPriceParserCandidateKind;
  start: number;
  end: number;
  contextBefore: string;
  contextAfter: string;
};

export type LocalPriceParserResult = PriceParserResult & {
  provider: string;
  model: string;
  candidates: LocalPriceParserCandidate[];
  isEmpty: false;
};

export type LocalPriceParserEmptyResult = {
  priceMinor: null;
  oldPriceMinor: null;
  promoPriceMinor: null;
  currency: "RUB";
  confidence: null;
  provider: string;
  model: string;
  candidates: [];
  isEmpty: true;
  diagnostics?: Record<string, unknown>;
};

export type LocalPriceParserOutput = LocalPriceParserResult | LocalPriceParserEmptyResult;

export type RussianPriceParserOptions = {
  provider?: PipelineProviderInfo;
  minRub?: number;
  maxRub?: number;
};

const DEFAULT_MIN_RUB = 1;
const DEFAULT_MAX_RUB = 999_999;
const DEFAULT_CURRENCY = "RUB";

const PRICE_RE = /(?<!\d)(\d{1,3}(?:[\s\u00A0]\d{3})+|\d{1,6})(?:\s*(?:[,.:-]|руб\.?|р\.?|₽)?\s*(\d{1,2}))?(?!\d)/giu;
const NON_PRICE_AFTER_RE = /^\s*(?:%|проц|г\b|гр\b|кг\b|мл\b|л\b|шт\b|pcs\b)/iu;
const OLD_PRICE_RE = /(старая|стар\.?|было|обычная|обычн\.?|зачерк|перечерк)/iu;
const PROMO_PRICE_RE = /(новая|нов\.?|акц|акция|скид|скидка|спец|sale|promo|промо)/iu;
const CURRENCY_RE = /(₽|руб\.?|р\.?)$/iu;

export function createRussianPriceParser(options: RussianPriceParserOptions = {}): PriceParser {
  return new RussianPriceParser(options);
}

export class RussianPriceParser implements PriceParser {
  readonly provider: PipelineProviderInfo;
  private readonly minRub: number;
  private readonly maxRub: number;

  constructor(options: RussianPriceParserOptions = {}) {
    this.provider = options.provider ?? RUSSIAN_PRICE_PARSER_PROVIDER;
    this.minRub = normalizeRubLimit(options.minRub, DEFAULT_MIN_RUB);
    this.maxRub = normalizeRubLimit(options.maxRub, DEFAULT_MAX_RUB);
  }

  async parse(input: PriceParserInput): Promise<PriceParserResult | null> {
    const result = parseRussianPriceText(input.ocr?.text ?? "", {
      provider: this.provider,
      minRub: this.minRub,
      maxRub: this.maxRub,
    });

    return result.isEmpty ? null : result;
  }
}

export function parseRussianPriceText(
  text: string | null | undefined,
  options: RussianPriceParserOptions = {},
): LocalPriceParserOutput {
  const provider = options.provider ?? RUSSIAN_PRICE_PARSER_PROVIDER;
  const normalizedText = normalizePriceText(text);
  const minRub = normalizeRubLimit(options.minRub, DEFAULT_MIN_RUB);
  const maxRub = normalizeRubLimit(options.maxRub, DEFAULT_MAX_RUB);
  const candidates = findPriceCandidates(normalizedText, minRub, maxRub);

  if (candidates.length === 0) {
    return {
      priceMinor: null,
      oldPriceMinor: null,
      promoPriceMinor: null,
      currency: DEFAULT_CURRENCY,
      confidence: null,
      provider: normalizeProviderField(provider.provider, "local"),
      model: normalizeProviderField(provider.model, "unknown-price-parser"),
      candidates: [],
      isEmpty: true,
      diagnostics: {
        reason: normalizedText ? "no_price_candidate" : "empty_text",
        inputLength: normalizedText.length,
      },
    };
  }

  const selected = selectPriceCandidate(candidates);
  const oldPrice = selectOldPriceCandidate(candidates, selected);
  const promoPrice = selected.kind === "promo" ? selected : selectPromoPriceCandidate(candidates, selected);

  return {
    priceMinor: selected.priceMinor,
    oldPriceMinor: oldPrice?.priceMinor ?? null,
    promoPriceMinor: promoPrice?.priceMinor ?? null,
    currency: DEFAULT_CURRENCY,
    confidence: selected.confidence,
    provider: normalizeProviderField(provider.provider, "local"),
    model: normalizeProviderField(provider.model, "unknown-price-parser"),
    candidates,
    isEmpty: false,
    diagnostics: {
      candidateCount: candidates.length,
      selectedText: selected.text,
      selectedKind: selected.kind,
      oldPriceText: oldPrice?.text ?? null,
      promoPriceText: promoPrice?.text ?? null,
    },
  };
}

export function normalizePriceText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[\t\r]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function findPriceCandidates(text: string, minRub: number, maxRub: number): LocalPriceParserCandidate[] {
  const candidates: LocalPriceParserCandidate[] = [];
  PRICE_RE.lastIndex = 0;

  for (const match of text.matchAll(PRICE_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const end = start + raw.length;
    const rubText = match[1];
    const kopText = match[2] ?? null;
    const contextBefore = text.slice(Math.max(0, start - 32), start);
    const contextAfter = text.slice(end, Math.min(text.length, end + 32));

    if (NON_PRICE_AFTER_RE.test(contextAfter)) continue;

    const rub = parseRubles(rubText);
    const kop = parseKopecks(kopText);
    if (rub === null || kop === null) continue;
    if (rub < minRub || rub > maxRub) continue;

    const candidate: LocalPriceParserCandidate = {
      text: raw.trim(),
      priceMinor: rub * 100 + kop,
      currency: DEFAULT_CURRENCY,
      confidence: scoreCandidate(raw, kopText, contextBefore, contextAfter),
      kind: classifyCandidate(contextBefore, contextAfter),
      start,
      end,
      contextBefore: contextBefore.trim(),
      contextAfter: contextAfter.trim(),
    };

    candidates.push(candidate);
  }

  return candidates
    .sort((left, right) => right.confidence - left.confidence || right.priceMinor - left.priceMinor)
    .slice(0, 12);
}

function parseRubles(value: string): number | null {
  const normalized = value.replace(/[\s\u00A0]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseKopecks(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^\d{1,2}$/.test(value)) return null;
  return Number.parseInt(value.padEnd(2, "0"), 10);
}

function classifyCandidate(contextBefore: string, contextAfter: string): LocalPriceParserCandidateKind {
  const context = `${contextBefore} ${contextAfter}`;
  if (OLD_PRICE_RE.test(context)) return "old";
  if (PROMO_PRICE_RE.test(context)) return "promo";
  return "regular";
}

function scoreCandidate(raw: string, kopText: string | null, contextBefore: string, contextAfter: string): number {
  let score = 0.52;
  const context = `${contextBefore} ${contextAfter}`;

  if (kopText !== null) score += 0.18;
  if (CURRENCY_RE.test(raw.trim()) || /(₽|руб\.?|р\.?)\s*$/iu.test(contextBefore) || /^\s*(₽|руб\.?|р\.?)\b/iu.test(contextAfter)) score += 0.12;
  if (/(цена|итого|стоим|руб|₽)/iu.test(context)) score += 0.08;
  if (PROMO_PRICE_RE.test(context)) score += 0.06;
  if (OLD_PRICE_RE.test(context)) score -= 0.08;
  if (/^\d{1,2}$/.test(raw.trim())) score -= 0.1;

  return round4(Math.min(Math.max(score, 0), 1));
}

function selectPriceCandidate(candidates: LocalPriceParserCandidate[]): LocalPriceParserCandidate {
  const nonOld = candidates.filter((candidate) => candidate.kind !== "old");
  return nonOld[0] ?? candidates[0];
}

function selectOldPriceCandidate(
  candidates: LocalPriceParserCandidate[],
  selected: LocalPriceParserCandidate,
): LocalPriceParserCandidate | null {
  return candidates.find((candidate) => candidate.kind === "old" && candidate.priceMinor !== selected.priceMinor) ?? null;
}

function selectPromoPriceCandidate(
  candidates: LocalPriceParserCandidate[],
  selected: LocalPriceParserCandidate,
): LocalPriceParserCandidate | null {
  return candidates.find((candidate) => candidate.kind === "promo" && candidate.priceMinor === selected.priceMinor) ?? null;
}

function normalizeRubLimit(value: number | null | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function normalizeProviderField(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function parsedPriceToEvidenceCandidate(parsed: PriceParserResult | null): ParsedPriceCandidate | null {
  if (!parsed) return null;
  return {
    priceMinor: toNullableInteger(parsed.priceMinor),
    oldPriceMinor: toNullableInteger(parsed.oldPriceMinor),
    promoPriceMinor: toNullableInteger(parsed.promoPriceMinor),
    currency: parsed.currency ?? DEFAULT_CURRENCY,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
  };
}

function toNullableInteger(value?: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}
