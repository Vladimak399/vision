export type RecognizedMatchInput = { rawName: string | null; brand?: string | null; sizeText?: string | null; priceTagText?: string | null; productVisibleText?: string | null };
export type CatalogMatchProduct = { id: string; name: string; brand: string | null; size_text: string | null; is_active?: boolean | null };
export type CatalogMatchCandidate = { product: CatalogMatchProduct; score: number; reasons: string[] };

type F = { text: string; tokens: string[]; set: Set<string>; brand: string | null; size: string | null; baseFamily: string | null; variants: string[]; family: string | null };
const stop = new Set(["и", "в", "на", "для", "с", "со", "без", "из", "от", "руб", "цена", "шт"]);

// Транслитерация: русский ↔ латиница (для fuzzy-поиска)
const ruToLat: Record<string, string> = {
  "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
  "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
  "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
  "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ы": "y", "э": "e",
  "ю": "yu", "я": "ya",
};

const latToRu: Record<string, string> = {
  "a": "а", "b": "б", "v": "в", "g": "г", "d": "д", "e": "е",
  "zh": "ж", "z": "з", "i": "и", "y": "й", "k": "к", "l": "л", "m": "м",
  "n": "н", "o": "о", "p": "п", "r": "р", "s": "с", "t": "т", "u": "у", "f": "ф",
  "kh": "х", "ts": "ц", "ch": "ч", "sh": "ш", "sch": "щ",
  "yu": "ю", "ya": "я",
};

/**
 * Транслитерация текста: русский → латиница и латиница → русский.
 * Используется для fuzzy-поиска: "splat" совпадает с "Сплат".
 */
export function transliterate(text: string): string {
  const normalized = text.toLowerCase();
  let result = normalized;
  // Сначала латиница → русский
  for (const [lat, ru] of Object.entries(latToRu)) {
    result = result.replace(new RegExp(lat, "gi"), ru);
  }
  // Потом русский → латиница
  for (const [ru, lat] of Object.entries(ruToLat)) {
    result = result.replace(new RegExp(ru, "gi"), lat);
  }
  // Возвращаем в нижнем регистре для сравнения
  return result.toLowerCase();
}
const brands: Record<string,string> = { "бабкины":"babkiny", "бабкин":"babkiny", "яшкино":"yashkino", "милка":"milka", "milka":"milka", "нескафе":"nescafe", "nescafe":"nescafe", "джинн":"djinn", "gin":"djinn", "мартин":"martin", "мартина":"martin", "нивеа":"nivea", "nivea":"nivea", "ариэль":"ariel", "ariel":"ariel", "палмолив":"palmolive", "palmolive":"palmolive", "дав":"dove", "dove":"dove", "колгейт":"colgate", "colgate":"colgate", "персил":"persil", "persil":"persil", "splat":"splat", "сплат":"splat", "president":"president", "президент":"president" };
const aliases: Record<string,string> = { "семечки":"семечка", "семечек":"семечка", "семена":"семечка", "вафли":"вафля", "вафельные":"вафля", "трубочки":"трубочка", "полосатые":"полосатый", "полосатых":"полосатый", "классические":"классический", "жареные":"жареный", "жаренные":"жареный", "соленые":"соленый", "солёные":"соленый", "солью":"соль", "морская":"морской", "очищенные":"очищенный", "тыквы":"тыква", "тыквенные":"тыква", "шампуни":"шампунь", "шампуня":"шампунь", "гели":"гель", "крема":"крем", "кремы":"крем", "порошки":"порошок", "капсулы":"капсула", "таблетки":"таблетка", "пасты":"паста", "паста":"паста", "зубная":"зубной", "зубные":"зубной", "бальзамы":"бальзам", "средства":"средство", "посуда":"посуды", "бутылки":"бутылка", "бутылка":"бутылка", "флаконы":"флакон" };
const families = new Set(["семечка", "вафля", "трубочка", "кофе", "чай", "шоколад", "печенье", "конфета", "соус", "лапша", "мыло", "гель", "шампунь", "крем", "порошок", "капсула", "таблетка", "паста", "ополаскиватель", "дезодорант", "бальзам", "средство"]);
const low = new Set(["классический", "жареный", "соленый", "соль", "морской"]);
const variantTokens = new Set(["полосатый", "тыква", "очищенный", "лимон", "яблоко", "алоэ", "кокос", "лаванда", "свежесть", "мята", "ромашка", "жасмин", "color", "колор", "автомат", "sensitive", "сенситив"]);
const packagingTokens = new Set(["пакет", "флакон", "бутылка", "туба", "коробка", "дойпак", "саше"]);

export function getCatalogMatchCandidates(recognized: RecognizedMatchInput, products: CatalogMatchProduct[], options: { limit?: number } = {}) {
  const rf = makeFeatures([recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText].filter(Boolean).join(" "));
  if (!rf.tokens.length) return [];
  const candidates = products.filter((p) => p.is_active !== false).map((p) => score(p, rf)).filter((c) => c.score > 0).sort((a,b) => b.score - a.score).slice(0, Math.max(options.limit ?? 30, 30));
  return markAmbiguous(candidates, rf).sort((a,b) => b.score - a.score).slice(0, options.limit ?? 30);
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
  for (const t of rf.tokens) { const w = low.has(t) ? 0.35 : families.has(t) || Object.values(brands).includes(t) ? 1.2 : 1; total += w; if (pf.set.has(t)) matched += w; }
  let s = total ? (matched / total) * 0.7 : 0;

  // a) Substring match: токен распознавания входит в название продукта (или наоборот)
  // Исключаем токены, которые уже совпадают через обычные токены (name_tokens) - они уже учтены
  let substringScore = 0;
  for (const rt of rf.tokens) {
    // Пропускаем: уже совпадающие токены, brand, family, variant, low tokens
    if (pf.set.has(rt)) continue;
    if (rf.brand && rt === rf.brand) continue;
    if (rf.baseFamily && (rt === rf.brand || rt === rf.family || rt === rf.baseFamily)) continue;
    if (rf.variants.includes(rt)) continue;
    if (low.has(rt)) continue;
    for (const pt of pf.tokens) {
      if (pt.length >= 3 && !pf.set.has(rt)) {
        if (rt.includes(pt) || pt.includes(rt)) {
          substringScore += 0.15;
        }
      }
    }
  }
  if (substringScore > 0) {
    s += substringScore;
    reasons.push("substring_match");
  }

  // b) Транслитерация: рус ↔ лат (splat = Сплат = splat)
  let translitScore = 0;
  for (const rt of rf.tokens) {
    const rtTranslit = transliterate(rt);
    for (const pt of pf.tokens) {
      const ptTranslit = transliterate(pt);
      if (rtTranslit === ptTranslit && rt !== pt) {
        // Транслитерация сделала токены равными (они различаются исходно)
        translitScore += 0.4;
      }
    }
  }
  if (translitScore > 0) {
    s += translitScore;
    reasons.push("transliteration");
  }

  if (rf.brand && pf.brand && rf.brand === pf.brand) { s += 0.16; reasons.push("brand"); }
  if (rf.baseFamily && pf.baseFamily && rf.baseFamily === pf.baseFamily) { s += 0.12; reasons.push("product_family"); }
  if (rf.size && pf.size && rf.size === pf.size) { s += 0.18; reasons.push("size"); }
  else if (rf.size && pf.size && rf.size !== pf.size) { s -= 0.08; reasons.push("size_mismatch_review"); }
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
