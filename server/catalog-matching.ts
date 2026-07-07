export type RecognizedMatchInput = {
  rawName: string | null;
  brand?: string | null;
  sizeText?: string | null;
  priceTagText?: string | null;
  productVisibleText?: string | null;
};

export type CatalogMatchProduct = {
  id: string;
  name: string;
  brand: string | null;
  size_text: string | null;
  is_active?: boolean | null;
};

export type CatalogMatchCandidate = {
  product: CatalogMatchProduct;
  score: number;
  reasons: string[];
};

type MatchFeatures = {
  text: string;
  tokens: string[];
  tokenSet: Set<string>;
  brand: string | null;
  size: string | null;
  familyKey: string | null;
  trigrams: Set<string>;
};

const STOP_WORDS = new Set([
  "и",
  "в",
  "во",
  "на",
  "для",
  "с",
  "со",
  "без",
  "из",
  "от",
  "до",
  "по",
  "при",
  "или",
  "товар",
  "продукт",
  "руб",
  "рубль",
  "рублей",
  "цена",
  "распродажа",
  "акция",
  "шт",
  "уп",
  "кор",
  "блок",
]);

const LOW_WEIGHT_TOKENS = new Set([
  "яблоко",
  "груша",
  "клубника",
  "малина",
  "вишня",
  "апельсин",
  "лимон",
  "лайм",
  "ваниль",
  "карамель",
  "орех",
  "орехи",
  "фундук",
  "изюм",
  "персик",
  "манго",
  "мята",
  "лаванда",
  "алоэ",
  "ромашка",
  "сгущенка",
  "молоко",
  "сливочный",
  "какао",
  "классический",
  "классическ",
  "оригинальный",
  "оригинальн",
  "жареный",
  "жарен",
  "обжаренный",
  "обжарен",
  "соленый",
  "солен",
  "соль",
  "морской",
  "морск",
]);

const CORE_CATEGORY_TOKENS = new Set([
  "семечка",
  "вафля",
  "трубочка",
  "рулетик",
  "кофе",
  "чай",
  "шоколад",
  "печенье",
  "конфета",
  "соус",
  "лапша",
  "сок",
  "напиток",
  "шампунь",
  "гель",
  "мыло",
  "порошок",
  "паста",
]);

const BRAND_ALIASES: Record<string, string> = {
  milka: "milka",
  милка: "milka",
  nescafe: "nescafe",
  нескафе: "nescafe",
  nestle: "nestle",
  нестле: "nestle",
  jacobs: "jacobs",
  якобс: "jacobs",
  monarch: "monarch",
  монарх: "monarch",
  poetti: "poetti",
  поэтти: "poetti",
  поетти: "poetti",
  jardin: "jardin",
  жардин: "jardin",
  jockey: "jockey",
  жокей: "jockey",
  yashkino: "yashkino",
  яшкино: "yashkino",
  lavazza: "lavazza",
  лавацца: "lavazza",
  лаваза: "lavazza",
  aura: "aura",
  аура: "aura",
  biomio: "biomio",
  биомио: "biomio",
  palmolive: "palmolive",
  палмолив: "palmolive",
  luksja: "luksja",
  луксжа: "luksja",
  mixit: "mixit",
  миксит: "mixit",
  bucheron: "bucheron",
  бушерон: "bucheron",
  babyfox: "babyfox",
  бебифокс: "babyfox",
  бэйбифокс: "babyfox",
  vitabar: "vitabar",
  vita: "vita",
  вита: "vita",
  бабкины: "babkiny",
  бабкин: "babkiny",
  babkiny: "babkiny",
  martin: "martin",
  мартин: "martin",
  мартина: "martin",
  джинн: "djinn",
  djinn: "djinn",
};

const TOKEN_ALIASES: Record<string, string> = {
  вафли: "вафля",
  вафел: "вафля",
  вафля: "вафля",
  вафельные: "вафля",
  вафельный: "вафля",
  вафельная: "вафля",
  вафельных: "вафля",
  трубочки: "трубочка",
  трубочка: "трубочка",
  трубочек: "трубочка",
  рулетики: "рулетик",
  рулетик: "рулетик",
  сендвич: "сэндвич",
  сэндвич: "сэндвич",
  сандвич: "сэндвич",
  сгущ: "сгущенка",
  сгущенка: "сгущенка",
  сгущеного: "сгущенка",
  сгущенного: "сгущенка",
  сгущенное: "сгущенка",
  сгущенным: "сгущенка",
  молока: "молоко",
  молоком: "молоко",
  молочный: "молоко",
  молочным: "молоко",
  молочная: "молоко",
  ореховые: "орех",
  ореховый: "орех",
  ореховая: "орех",
  ореховой: "орех",
  орешками: "орех",
  шоколайт: "chocolight",
  chocolight: "chocolight",
  семечки: "семечка",
  семечек: "семечка",
  семечка: "семечка",
  семена: "семечка",
  семя: "семечка",
  подсолнечника: "подсолнечник",
  подсолнечные: "подсолнечник",
  подсолнечные: "подсолнечник",
  полосатые: "полосатый",
  полосатых: "полосатый",
  полосатый: "полосатый",
  классические: "классический",
  классический: "классический",
  классика: "классический",
  жареные: "жареный",
  жаренные: "жареный",
  жареный: "жареный",
  обжаренные: "жареный",
  соленые: "соленый",
  солёные: "соленый",
  соленый: "соленый",
  солью: "соль",
  соли: "соль",
  соль: "соль",
  морская: "морской",
  морской: "морской",
  очищенные: "очищенный",
  очищенная: "очищенный",
  очищенный: "очищенный",
  тыква: "тыква",
  тыквы: "тыква",
  тыквенные: "тыква",
};

const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: "а",
  b: "б",
  c: "к",
  d: "д",
  e: "е",
  f: "ф",
  g: "г",
  h: "х",
  i: "и",
  j: "ж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "к",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  w: "в",
  x: "кс",
  y: "и",
  z: "з",
};

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ы: "y",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function getCatalogMatchCandidates(
  recognized: RecognizedMatchInput,
  products: CatalogMatchProduct[],
  options: { limit?: number } = {},
): CatalogMatchCandidate[] {
  const limit = options.limit ?? 5;
  const recognizedFeatures = buildRecognizedFeatures(recognized);

  if (recognizedFeatures.tokens.length === 0) {
    return [];
  }

  const candidates = products
    .filter((product) => product.is_active !== false)
    .map((product) => scoreProductMatch(product, recognizedFeatures))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(limit, 12));

  return markSizeAmbiguity(candidates, recognizedFeatures)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function buildCatalogMatchKey(recognized: RecognizedMatchInput) {
  const tokens = tokenizeForMatch(getRecognizedText(recognized))
    .filter((token) => !LOW_WEIGHT_TOKENS.has(token))
    .slice(0, 10)
    .sort();
  const size = normalizeSize(recognized.sizeText ?? recognized.rawName ?? recognized.priceTagText ?? "");

  if (tokens.length === 0) {
    return "";
  }

  return [tokens.join(" "), size].filter(Boolean).join(" |");
}

function scoreProductMatch(product: CatalogMatchProduct, recognizedFeatures: MatchFeatures): CatalogMatchCandidate {
  const productText = [product.name, product.brand, product.size_text].filter(Boolean).join(" ");
  const productFeatures = buildProductFeatures(product);
  const reasons: string[] = [];

  const tokenOverlap = getWeightedTokenOverlap(recognizedFeatures.tokens, productFeatures.tokens);
  const trigramScore = diceCoefficient(recognizedFeatures.trigrams, productFeatures.trigrams);
  let score = tokenOverlap * 0.58 + trigramScore * 0.12;

  if (recognizedFeatures.brand && productFeatures.brand && recognizedFeatures.brand === productFeatures.brand) {
    score += 0.16;
    reasons.push("brand");
  }

  if (recognizedFeatures.familyKey && productFeatures.familyKey && recognizedFeatures.familyKey === productFeatures.familyKey) {
    score += 0.12;
    reasons.push("product_family");
  }

  if (recognizedFeatures.size && productFeatures.size && recognizedFeatures.size === productFeatures.size) {
    score += 0.12;
    reasons.push("size");
  } else if (recognizedFeatures.size && productFeatures.size && recognizedFeatures.size !== productFeatures.size) {
    score -= 0.18;
    reasons.push("size_mismatch_review");
  } else if (!recognizedFeatures.size && productFeatures.size) {
    score -= 0.02;
    reasons.push("missing_size_review");
  }

  if (tokenOverlap > 0) {
    reasons.push("name_tokens");
  }

  if (trigramScore >= 0.35) {
    reasons.push("name_similarity");
  }

  if (recognizedFeatures.tokenSet.has("полосатый") && productFeatures.tokenSet.has("полосатый")) {
    score += 0.05;
    reasons.push("variant");
  }

  if (recognizedFeatures.tokenSet.has("тыква") && productFeatures.tokenSet.has("тыква")) {
    score += 0.08;
    reasons.push("variant");
  }

  if (recognizedFeatures.tokenSet.has("очищенный") && productFeatures.tokenSet.has("очищенный")) {
    score += 0.08;
    reasons.push("variant");
  }

  return {
    product,
    score: roundScore(Math.max(0, Math.min(score, 0.99))),
    reasons: Array.from(new Set(reasons)),
  };
}

function markSizeAmbiguity(candidates: CatalogMatchCandidate[], recognizedFeatures: MatchFeatures) {
  if (recognizedFeatures.size || candidates.length < 2) {
    return candidates;
  }

  const sizesByFamily = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    if (candidate.score < 0.45) continue;
    const productFeatures = buildProductFeatures(candidate.product);
    if (!productFeatures.familyKey || !productFeatures.size) continue;
    const sizes = sizesByFamily.get(productFeatures.familyKey) ?? new Set<string>();
    sizes.add(productFeatures.size);
    sizesByFamily.set(productFeatures.familyKey, sizes);
  }

  return candidates.map((candidate) => {
    const productFeatures = buildProductFeatures(candidate.product);
    if (productFeatures.familyKey && (sizesByFamily.get(productFeatures.familyKey)?.size ?? 0) > 1) {
      return { ...candidate, reasons: Array.from(new Set([...candidate.reasons, "multiple_catalog_sizes_review"])) };
    }
    return candidate;
  });
}

function buildRecognizedFeatures(recognized: RecognizedMatchInput): MatchFeatures {
  const text = getRecognizedText(recognized);
  const tokens = tokenizeForMatch(text);
  const brand = normalizeBrand([recognized.brand, recognized.rawName, recognized.productVisibleText, recognized.priceTagText].filter(Boolean).join(" "));
  const size = normalizeSize(recognized.sizeText ?? recognized.rawName ?? recognized.priceTagText ?? "");

  return buildMatchFeatures({ text, tokens, brand, size });
}

function buildProductFeatures(product: CatalogMatchProduct): MatchFeatures {
  const text = [product.name, product.brand, product.size_text].filter(Boolean).join(" ");
  const tokens = tokenizeForMatch(text);
  const brand = normalizeBrand([product.brand, product.name].filter(Boolean).join(" "));
  const size = normalizeSize(product.size_text ?? product.name);

  return buildMatchFeatures({ text, tokens, brand, size });
}

function buildMatchFeatures({ text, tokens, brand, size }: { text: string; tokens: string[]; brand: string | null; size: string | null }): MatchFeatures {
  const tokenSet = new Set(tokens);
  const familyKey = buildFamilyKey({ brand, tokenSet });

  return {
    text,
    tokens,
    tokenSet,
    brand,
    size,
    familyKey,
    trigrams: getTrigrams(normalizeText(text)),
  };
}

function buildFamilyKey({ brand, tokenSet }: { brand: string | null; tokenSet: Set<string> }) {
  const category = Array.from(CORE_CATEGORY_TOKENS).find((token) => tokenSet.has(token));

  if (!brand || !category) {
    return null;
  }

  const variantTokens = ["полосатый", "тыква", "очищенный"].filter((token) => tokenSet.has(token));
  return [brand, category, ...variantTokens].join(":");
}

function getWeightedTokenOverlap(leftTokens: string[], rightTokens: string[]) {
  const rightSet = new Set(rightTokens);
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const token of leftTokens) {
    const weight = getTokenWeight(token);
    totalWeight += weight;

    if (rightSet.has(token)) {
      matchedWeight += weight;
      continue;
    }

    if (rightTokens.some((rightToken) => areTokensClose(token, rightToken))) {
      matchedWeight += weight * 0.72;
    }
  }

  return totalWeight > 0 ? matchedWeight / totalWeight : 0;
}

function getTokenWeight(token: string) {
  if (LOW_WEIGHT_TOKENS.has(token)) return 0.35;
  if (CORE_CATEGORY_TOKENS.has(token)) return 1.2;
  if (Object.values(BRAND_ALIASES).includes(token)) return 1.25;
  return 1;
}

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeForMatch(value: string) {
  const tokenSet = new Set<string>();

  for (const rawToken of normalizeText(value).split(" ")) {
    if (rawToken.length <= 1 || /^\d+$/.test(rawToken) || STOP_WORDS.has(rawToken)) {
      continue;
    }

    for (const variant of getTokenVariants(rawToken)) {
      if (variant.length > 1 && !/^\d+$/.test(variant) && !STOP_WORDS.has(variant)) {
        tokenSet.add(variant);
      }
    }
  }

  return Array.from(tokenSet);
}

export function normalizeSize(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|гр|g|л|l|мл|ml|шт)/i);

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (!Number.isFinite(amount)) {
    return null;
  }

  if (unit === "кг" || unit === "kg") {
    return `${roundSize(amount * 1000)}g`;
  }

  if (unit === "г" || unit === "гр" || unit === "g") {
    return `${roundSize(amount)}g`;
  }

  if (unit === "л" || unit === "l") {
    return `${roundSize(amount * 1000)}ml`;
  }

  if (unit === "мл" || unit === "ml") {
    return `${roundSize(amount)}ml`;
  }

  return `${roundSize(amount)}pc`;
}

function getRecognizedText(recognized: RecognizedMatchInput) {
  return [recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText].filter(Boolean).join(" ");
}

function getTokenVariants(token: string) {
  const variants = new Set<string>();
  const alias = BRAND_ALIASES[token] ?? TOKEN_ALIASES[token] ?? token;
  variants.add(alias);
  variants.add(stemRussianToken(alias));

  if (/^[a-z]+$/.test(token)) {
    const cyrillic = transliterateLatinToCyrillic(token);
    variants.add(cyrillic);
    variants.add(stemRussianToken(cyrillic));
  }

  if (/^[а-я]+$/.test(token)) {
    variants.add(transliterateCyrillicToLatin(token));
  }

  return variants;
}

function stemRussianToken(token: string) {
  if (!/^[а-я]+$/.test(token) || token.length < 5) {
    return token;
  }

  return token.replace(/(ыми|ими|ого|его|ому|ему|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ей|ов|ев|ам|ям|ах|ях|а|я|ы|и|е|у|ю)$/u, "");
}

function normalizeBrand(value: string) {
  const tokens = normalizeText(value).split(" ").filter(Boolean);

  for (const token of tokens) {
    const alias = BRAND_ALIASES[token];
    if (alias) return alias;
  }

  return null;
}

function areTokensClose(left: string, right: string) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;

  const maxLength = Math.max(left.length, right.length);
  const distance = levenshteinDistance(left, right);
  return 1 - distance / maxLength >= 0.82;
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + cost);
    }

    for (let rightIndex = 0; rightIndex <= right.length; rightIndex += 1) {
      previous[rightIndex] = current[rightIndex];
    }
  }

  return previous[right.length];
}

function getTrigrams(value: string) {
  const normalized = `  ${value}  `;
  const trigrams = new Set<string>();

  for (let index = 0; index < normalized.length - 2; index += 1) {
    trigrams.add(normalized.slice(index, index + 3));
  }

  return trigrams;
}

function diceCoefficient(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  return (2 * intersection) / (left.size + right.size);
}

function transliterateLatinToCyrillic(value: string) {
  return value
    .replace(/ch/g, "ч")
    .replace(/sh/g, "ш")
    .replace(/yu/g, "ю")
    .replace(/ya/g, "я")
    .split("")
    .map((letter) => LATIN_TO_CYRILLIC[letter] ?? letter)
    .join("");
}

function transliterateCyrillicToLatin(value: string) {
  return value
    .split("")
    .map((letter) => CYRILLIC_TO_LATIN[letter] ?? letter)
    .join("");
}

function roundScore(score: number) {
  return Math.round(score * 10000) / 10000;
}

function roundSize(value: number) {
  return Math.round(value * 1000) / 1000;
}
