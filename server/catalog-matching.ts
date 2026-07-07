export type RecognizedMatchInput = { rawName: string | null; brand?: string | null; sizeText?: string | null; priceTagText?: string | null; productVisibleText?: string | null };
export type CatalogMatchProduct = { id: string; name: string; brand: string | null; size_text: string | null; is_active?: boolean | null };
export type CatalogMatchCandidate = { product: CatalogMatchProduct; score: number; reasons: string[] };

type F = { text: string; tokens: string[]; set: Set<string>; brand: string | null; size: string | null; baseFamily: string | null; variants: string[]; family: string | null };
const stop = new Set(["и", "в", "на", "для", "с", "со", "без", "из", "от", "руб", "цена", "шт"]);
const brands: Record<string,string> = { "бабкины":"babkiny", "бабкин":"babkiny", "яшкино":"yashkino", "милка":"milka", "нескафе":"nescafe", "джинн":"djinn", "мартин":"martin", "мартина":"martin", "нивеа":"nivea", "nivea":"nivea", "ариэль":"ariel", "ariel":"ariel", "палмолив":"palmolive", "palmolive":"palmolive", "дав":"dove", "dove":"dove", "колгейт":"colgate", "colgate":"colgate", "персил":"persil", "persil":"persil" };
const aliases: Record<string,string> = { "семечки":"семечка", "семечек":"семечка", "семена":"семечка", "вафли":"вафля", "вафельные":"вафля", "трубочки":"трубочка", "полосатые":"полосатый", "полосатых":"полосатый", "классические":"классический", "жареные":"жареный", "жаренные":"жареный", "соленые":"соленый", "солёные":"соленый", "солью":"соль", "морская":"морской", "очищенные":"очищенный", "тыквы":"тыква", "тыквенные":"тыква", "шампуни":"шампунь", "шампуня":"шампунь", "гели":"гель", "крема":"крем", "кремы":"крем", "порошки":"порошок", "капсулы":"капсула", "таблетки":"таблетка", "пасты":"паста", "паста":"паста", "зубная":"зубной", "зубные":"зубной", "бальзамы":"бальзам", "средства":"средство", "посуда":"посуды", "бутылки":"бутылка", "бутылка":"бутылка", "флаконы":"флакон" };
const families = new Set(["семечка", "вафля", "трубочка", "кофе", "чай", "шоколад", "печенье", "конфета", "соус", "лапша", "мыло", "гель", "шампунь", "крем", "порошок", "капсула", "таблетка", "паста", "ополаскиватель", "дезодорант", "бальзам", "средство"]);
const low = new Set(["классический", "жареный", "соленый", "соль", "морской"]);
const variantTokens = new Set(["полосатый", "тыква", "очищенный", "лимон", "яблоко", "алоэ", "кокос", "лаванда", "свежесть", "мята", "ромашка", "жасмин", "color", "колор", "автомат", "sensitive", "сенситив"]);
const packagingTokens = new Set(["пакет", "флакон", "бутылка", "туба", "коробка", "дойпак", "саше"]);

export function getCatalogMatchCandidates(recognized: RecognizedMatchInput, products: CatalogMatchProduct[], options: { limit?: number } = {}) {
  const rf = makeFeatures([recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText].filter(Boolean).join(" "));
  if (!rf.tokens.length) return [];
  const candidates = products.filter((p) => p.is_active !== false).map((p) => score(p, rf)).filter((c) => c.score > 0).sort((a,b) => b.score - a.score).slice(0, Math.max(options.limit ?? 5, 12));
  return markAmbiguous(candidates, rf).sort((a,b) => b.score - a.score).slice(0, options.limit ?? 5);
}

export function buildCatalogMatchKey(recognized: RecognizedMatchInput) {
  const tokens = tokenizeForMatch([recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText].filter(Boolean).join(" ")).filter((t) => !low.has(t)).sort();
  const size = normalizeSize(recognized.sizeText ?? recognized.rawName ?? recognized.priceTagText ?? "");
  return tokens.length ? [tokens.slice(0, 10).join(" "), size].filter(Boolean).join(" |") : "";
}

function score(product: CatalogMatchProduct, rf: F): CatalogMatchCandidate {
  const pf = makeFeatures([product.name, product.brand, product.size_text].filter(Boolean).join(" "));
  const reasons: string[] = [];
  let matched = 0, total = 0;
  for (const t of rf.tokens) { const w = low.has(t) ? 0.35 : families.has(t) || Object.values(brands).includes(t) ? 1.2 : 1; total += w; if (pf.set.has(t)) matched += w; }
  let s = total ? (matched / total) * 0.7 : 0;
  if (rf.brand && pf.brand && rf.brand === pf.brand) { s += 0.16; reasons.push("brand"); }
  if (rf.baseFamily && pf.baseFamily && rf.baseFamily === pf.baseFamily) { s += 0.12; reasons.push("product_family"); }
  if (rf.size && pf.size && rf.size === pf.size) { s += 0.12; reasons.push("size"); }
  else if (rf.size && pf.size && rf.size !== pf.size) { s -= 0.18; reasons.push("size_mismatch_review"); }
  else if (!rf.size && pf.size) { s -= 0.02; reasons.push("missing_size_review"); }
  const sharedVariants = rf.variants.filter((v) => pf.variants.includes(v));
  if (sharedVariants.length) { s += Math.min(sharedVariants.length * 0.04, 0.08); reasons.push("variant"); }
  if (rf.baseFamily && pf.baseFamily && rf.baseFamily === pf.baseFamily) {
    const recognizedVariants = rf.variants.filter((v) => !packagingTokens.has(v));
    const productVariants = pf.variants.filter((v) => !packagingTokens.has(v));
    if (recognizedVariants.length && productVariants.length && !recognizedVariants.some((v) => productVariants.includes(v))) {
      s -= 0.05;
      reasons.push("different_variant_same_base_review");
    }
  }
  const recognizedPackaging = rf.variants.filter((v) => packagingTokens.has(v));
  const productPackaging = pf.variants.filter((v) => packagingTokens.has(v));
  if (recognizedPackaging.length && productPackaging.length && !recognizedPackaging.some((v) => productPackaging.includes(v))) { s = Math.min(s - 0.08, 0.89); reasons.push("packaging_mismatch_review"); }
  if (matched > 0) reasons.push("name_tokens");
  const strongSignals = Number(reasons.includes("brand")) + Number(reasons.includes("product_family")) + Number(reasons.includes("size"));
  if (rf.tokens.length <= 2 && strongSignals < 2) { s = Math.min(s, 0.65); reasons.push("partial_ocr_review"); }
  return { product, score: Math.round(Math.max(0, Math.min(s, 0.99)) * 10000) / 10000, reasons: Array.from(new Set(reasons)) };
}

function markAmbiguous(candidates: CatalogMatchCandidate[], rf: F) {
  if (rf.size) return candidates;
  const sizes = new Map<string, Set<string>>();
  for (const c of candidates) { const f = makeFeatures(c.product.name); if (!f.family || !f.size || c.score < 0.45) continue; const set = sizes.get(f.family) ?? new Set<string>(); set.add(f.size); sizes.set(f.family, set); }
  return candidates.map((c) => { const f = makeFeatures(c.product.name); return f.family && (sizes.get(f.family)?.size ?? 0) > 1 ? { ...c, reasons: Array.from(new Set([...c.reasons, "multiple_catalog_sizes_review"])) } : c; });
}

function makeFeatures(text: string): F { const tokens = tokenizeForMatch(text); const set = new Set(tokens); const brand = tokens.find((t) => Object.values(brands).includes(t)) ?? null; const fam = Array.from(families).find((t) => set.has(t)) ?? null; const vars = [...variantTokens, ...packagingTokens].filter((t) => set.has(t)); const baseFamily = brand && fam ? [brand, fam].join(":") : null; return { text, tokens, set, brand, size: normalizeSize(text), baseFamily, variants: vars, family: baseFamily }; }
export function normalizeText(v: string) { return v.toLowerCase().replace(/[ё]/g, "е").replace(/[^a-zа-я0-9]+/gi, " ").replace(/\s+/g, " ").trim(); }
export function tokenizeForMatch(v: string) { return Array.from(new Set(normalizeText(v).split(" ").map((t) => brands[t] ?? aliases[t] ?? stem(t)).filter((t) => t.length > 1 && !/^\d+$/.test(t) && !stop.has(t)))); }
export function normalizeSize(v: string) { const m = v.toLowerCase().replace(/[ё]/g, "е").match(/(\d+(?:[.,]\d+)?)\s*(кг|kg|г|гр|g|л|l|мл|ml|шт)/i); if (!m) return null; const n = Number(m[1].replace(",", ".")); const u = m[2].toLowerCase(); if (!Number.isFinite(n)) return null; if (u === "кг" || u === "kg") return `${Math.round(n * 1000)}g`; if (["г", "гр", "g"].includes(u)) return `${Math.round(n)}g`; if (u === "л" || u === "l") return `${Math.round(n * 1000)}ml`; if (u === "мл" || u === "ml") return `${Math.round(n)}ml`; return `${Math.round(n)}pc`; }
function stem(t: string) { return /^[а-я]+$/.test(t) && t.length > 4 ? t.replace(/(ыми|ими|ого|его|ому|ему|ая|яя|ое|ее|ые|ие|ый|ий|ой|ей|ов|ев|ам|ям|ах|ях|а|я|ы|и|е|у|ю)$/u, "") : t; }
