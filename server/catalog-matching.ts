export type RecognizedMatchInput = { rawName: string | null; brand?: string | null; sizeText?: string | null; priceTagText?: string | null; productVisibleText?: string | null };
export type CatalogMatchProduct = { id: string; name: string; brand: string | null; size_text: string | null; is_active?: boolean | null };
export type CatalogMatchCandidate = { product: CatalogMatchProduct; score: number; reasons: string[] };

type F = {
  text: string;
  tokens: string[];
  set: Set<string>;
  brand: string | null;
  size: string | null;
  family: string | null;
  packageType: string | null;
  variants: string[];
  strongTokens: string[];
};

const stop = new Set(["и", "в", "на", "для", "с", "со", "без", "из", "от", "руб", "цена", "шт", "товар", "акция", "скидка"]);
const brands: Record<string,string> = { "бабкины":"babkiny", "бабкин":"babkiny", "яшкино":"yashkino", "милка":"milka", "milka":"milka", "нескафе":"nescafe", "nescafe":"nescafe", "джинн":"djinn", "gin":"djinn", "мартин":"martin", "мартина":"martin" };
const aliases: Record<string,string> = {
  "семечки":"семечка", "семечек":"семечка", "семена":"семечка", "вафли":"вафля", "вафельные":"вафля", "трубочки":"трубочка", "полосатые":"полосатый", "полосатых":"полосатый", "классические":"классический", "жареные":"жареный", "жаренные":"жареный", "соленые":"соленый", "солёные":"соленый", "солью":"соль", "морская":"морской", "очищенные":"очищенный", "тыквы":"тыква", "тыквенные":"тыква",
  "пак":"пакет", "пакете":"пакет", "пакетик":"пакет", "бут":"бутылка", "бутылке":"бутылка", "пэт":"бутылка", "стекло":"бутылка", "банка":"банка", "банке":"банка", "коробка":"коробка", "кор":"коробка", "дойпак":"дой-пак", "дой":"дой-пак"
};
const families = new Set(["семечка", "вафля", "трубочка", "кофе", "чай", "печенье", "конфета", "соус", "лапша", "мыло", "гель", "молоко", "йогурт", "сок", "вода"]);
const low = new Set(["классический", "жареный", "соленый", "соль", "морской"]);
const packageTypes = new Set(["пакет", "бутылка", "банка", "коробка", "дой-пак"]);
const variantHints = new Set(["полосатый", "тыква", "очищенный", "клубника", "клубник", "ваниль", "ванил", "молочный", "молочн", "лимон", "яблоко", "апельсин", "мята", "лаванда"]);
const MIN_SUGGESTION_SCORE = 0.52;

export function getCatalogMatchCandidates(recognized: RecognizedMatchInput, products: CatalogMatchProduct[], options: { limit?: number } = {}) {
  const rf = makeFeatures([recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText].filter(Boolean).join(" "));
  if (!rf.tokens.length || rf.strongTokens.length < 2) return [];
  const candidates = products
    .filter((p) => p.is_active !== false)
    .map((p) => score(p, rf))
    .filter((c) => c.score >= MIN_SUGGESTION_SCORE)
    .sort((a,b) => b.score - a.score)
    .slice(0, Math.max(options.limit ?? 5, 12));
  return markAmbiguous(candidates, rf).sort((a,b) => b.score - a.score).slice(0, options.limit ?? 5);
}

export function buildCatalogMatchKey(recognized: RecognizedMatchInput) {
  const tokens = tokenizeForMatch([recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText].filter(Boolean).join(" ")).filter((t) => !low.has(t)).sort();
  const size = normalizeSize(recognized.sizeText ?? recognized.rawName ?? recognized.priceTagText ?? "");
  return tokens.length >= 2 ? [tokens.slice(0, 10).join(" "), size].filter(Boolean).join(" |") : "";
}

function score(product: CatalogMatchProduct, rf: F): CatalogMatchCandidate {
  const pf = makeFeatures([product.name, product.brand, product.size_text].filter(Boolean).join(" "));
  const reasons: string[] = [];
  let matched = 0, total = 0;
  for (const t of rf.tokens) {
    const w = tokenWeight(t);
    total += w;
    if (pf.set.has(t)) matched += w;
  }
  let s = total ? (matched / total) * 0.58 : 0;
  const matchedStrong = rf.strongTokens.filter((t) => pf.set.has(t));
  if (matchedStrong.length < 2) { s -= 0.35; reasons.push("too_few_identity_tokens"); }
  if (rf.brand) {
    if (pf.brand && rf.brand === pf.brand) { s += 0.17; reasons.push("brand"); }
    else { s -= 0.20; reasons.push("brand_missing_or_mismatch_review"); }
  }
  if (rf.family && pf.family && rf.family === pf.family) { s += 0.13; reasons.push("product_family"); }
  if (rf.size && pf.size && rf.size === pf.size) { s += 0.14; reasons.push("size"); }
  else if (rf.size && pf.size && rf.size !== pf.size) { s -= 0.28; reasons.push("size_mismatch_review"); }
  else if (!rf.size && pf.size) { s -= 0.04; reasons.push("missing_size_review"); }
  if (rf.packageType && pf.packageType && rf.packageType === pf.packageType) { s += 0.05; reasons.push("package"); }
  else if (rf.packageType && pf.packageType && rf.packageType !== pf.packageType) { s -= 0.12; reasons.push("package_mismatch_review"); }
  const commonVariants = rf.variants.filter((v) => pf.set.has(v));
  if (commonVariants.length) { s += Math.min(0.08, commonVariants.length * 0.04); reasons.push("variant_or_flavor"); }
  if (rf.variants.length && rf.brand === pf.brand && baseFamily(rf.family) === baseFamily(pf.family) && commonVariants.length === 0) reasons.push("different_variant_same_base_review");
  if (matched > 0) reasons.push("name_tokens");
  return { product, score: Math.round(Math.max(0, Math.min(s, 0.99)) * 10000) / 10000, reasons: Array.from(new Set(reasons)) };
}

function tokenWeight(t: string) { return low.has(t) ? 0.35 : families.has(t) || Object.values(brands).includes(t) ? 1.35 : packageTypes.has(t) ? 0.8 : variantHints.has(t) ? 0.7 : 1; }
function baseFamily(family: string | null) { return family?.split(":").slice(0, 2).join(":") ?? null; }

function markAmbiguous(candidates: CatalogMatchCandidate[], rf: F) {
  if (rf.size) return candidates;
  const sizes = new Map<string, Set<string>>();
  for (const c of candidates) { const f = makeFeatures(c.product.name); const base = baseFamily(f.family); if (!base || !f.size || c.score < 0.45) continue; const set = sizes.get(base) ?? new Set<string>(); set.add(f.size); sizes.set(base, set); }
  return candidates.map((c) => { const f = makeFeatures(c.product.name); const base = baseFamily(f.family); return base && (sizes.get(base)?.size ?? 0) > 1 ? { ...c, reasons: Array.from(new Set([...c.reasons, "multiple_catalog_sizes_review"])) } : c; });
}

function makeFeatures(text: string): F {
  const tokens = tokenizeForMatch(text); const set = new Set(tokens); const brand = tokens.find((t) => Object.values(brands).includes(t)) ?? null; const fam = Array.from(families).find((t) => set.has(t)) ?? null; const variants = Array.from(variantHints).filter((t) => set.has(t)); const packageType = Array.from(packageTypes).find((t) => set.has(t)) ?? null; const strongTokens = tokens.filter((t) => !low.has(t) && !packageTypes.has(t));
  return { text, tokens, set, brand, size: normalizeSize(text), family: brand && fam ? [brand, fam, ...variants].join(":") : fam, packageType, variants, strongTokens };
}
export function normalizeText(v: string) { return v.toLowerCase().replace(/[ё]/g, "е").replace(/[^a-zа-я0-9.,]+/gi, " ").replace(/\s+/g, " ").trim(); }
export function tokenizeForMatch(v: string) { return Array.from(new Set(normalizeText(v).split(" ").flatMap(splitSizeToken).map((t) => brands[t] ?? aliases[t] ?? stem(t)).filter((t) => t.length > 1 && !/^\d+$/.test(t) && !stop.has(t)))); }
function splitSizeToken(t: string) { const m = t.match(/^(\d+(?:[.,]\d+)?)(кг|kg|г|гр|g|л|l|мл|ml|шт)$/i); return m ? [m[1], m[2]] : [t]; }
export function normalizeSize(v: string) { const m = v.toLowerCase().replace(/[ё]/g, "е").match(/(\d+(?:[.,]\d+)?)\s*(кг|kg|г|гр|g|л|l|мл|ml|шт)/i); if (!m) return null; const n = Number(m[1].replace(",", ".")); const u = m[2].toLowerCase(); if (!Number.isFinite(n)) return null; if (u === "кг" || u === "kg") return `${Math.round(n * 1000)}g`; if (["г", "гр", "g"].includes(u)) return `${Math.round(n)}g`; if (u === "л" || u === "l") return `${Math.round(n * 1000)}ml`; if (u === "мл" || u === "ml") return `${Math.round(n)}ml`; return `${Math.round(n)}pc`; }
function stem(t: string) { return /^[а-я]+$/.test(t) && t.length > 4 ? t.replace(/(ыми|ими|ого|его|ому|ему|ая|яя|ое|ее|ые|ие|ый|ий|ой|ей|ов|ев|ам|ям|ах|ях|а|я|ы|и|е|у|ю)$/u, "") : t; }
