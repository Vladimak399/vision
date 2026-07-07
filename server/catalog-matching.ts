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
  "напиток",
  "соус",
  "чай",
  "кофе",
  "шампунь",
  "гель",
  "мыло",
  "шоколад",
  "плитка",
  "печенье",
  "вафли",
  "конфеты",
  "конфета",
  "руб",
  "рубль",
  "рублей",
  "цена",
  "распродажа",
  "акция",
  "шт",
  "р",
  "коп",
  "скидка",
  "суперцена",
  "выгода",
  "новинка",
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
  "шоколад",
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
  сгущен: "сгущенка",
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
  const recognizedText = getRecognizedText(recognized);
  const recognizedTokens = tokenizeForMatch(recognizedText);
  const recognizedBrand = normalizeBrand([recognized.brand, recognized.rawName, recognized.productVisibleText, recognized.priceTagText].filter(Boolean).join(" "));
  const recognizedSize = normalizeSize([recognized.sizeText, recognized.rawName, recognized.productVisibleText, recognized.priceTagText].filter(Boolean).join(" "));
  const recognizedTrigrams = getTrigrams(normalizeText(recognizedText));

  if (recognizedTokens.length === 0) {
    return [];
  }

  return products
    .filter((product) => product.is_active !== false)
    .map((product) => scoreProductMatch({ product, recognizedTokens, recognizedBrand, recognizedSize, recognizedTrigrams }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function buildCatalogMatchKey(recognized: RecognizedMatchInput) {
  const tokens = tokenizeForMatch(getRecognizedText(recognized))
    .filter((token) => !LOW_WEIGHT_TOKENS.has(token))
    .slice(0, 10)
    .sort();
  const size = normalizeSize([recognized.sizeText, recognized.rawName, recognized.productVisibleText, recognized.priceTagText].filter(Boolean).join(" "));

  if (tokens.length === 0) {
    return "";
  }

  return [tokens.join(" "), size].filter(Boolean).join(" |");
}

function scoreProductMatch({
  product,
  recognizedTokens,
  recognizedBrand,
  recognizedSize,
  recognizedTrigrams,
}: {
  product: CatalogMatchProduct;
  recognizedTokens: string[];
  recognizedBrand: string | null;
  recognizedSize: string | null;
  recognizedTrigrams: Set<string>;
}): CatalogMatchCandidate {
  const productText = [product.name, product.brand, product.size_text].filter(Boolean).join(" ");
  const productTokens = tokenizeForMatch(productText);
  const productBrand = normalizeBrand([product.brand, product.name].filter(Boolean).join(" "));
  const productSize = normalizeSize(product.size_text ?? product.name);
  const reasons: string[] = [];

  const tokenOverlap = getWeightedTokenOverlap(recognizedTokens, productTokens);
  const trigramScore = diceCoefficient(recognizedTrigrams, getTrigrams(normalizeText(productText)));
  let score = tokenOverlap * 0.62 + trigramScore * 0.16;

  if (recognizedBrand && productBrand && recognizedBrand === productBrand) {
    score += 0.13;
    reasons.push("brand");
  }

  if (recognizedSize && productSize && recognizedSize === productSize) {
    score += 0.11;
    reasons.push("size");
  } else if (recognizedSize && productSize && recognizedSize !== productSize) {
    score -= 0.18;
    reasons.push("size_mismatch_review");
  } else if (!recognizedSize && productSize) {
    score -= 0.04;
    reasons.push("missing_size_review");
  }

  if (tokenOverlap > 0) {
    reasons.push("name_tokens");
  }

  if (trigramScore >= 0.35) {
    reasons.push("name_similarity");
  }

  return {
    product,
    score: roundScore(Math.max(0, Math.min(score, 0.99))),
    reasons,
  };
}

function getWeightedTokenOverlap(leftTokens: string[], rightTokens: string[]) {
  const rightSet = new Set(rightTokens);
  let matchedWeight = 0;
  let totalWeight = 0;

  for (const token of leftTokens) {
    const weight = LOW_WEIGHT_TOKENS.has(token) ? 0.45 : 1;
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
    if (rawToken.length <= 1 || /^\d+$/.test(rawToken) || /^\d+[.,]?\d*$/.test(rawToken) || STOP_WORDS.has(rawToken)) {
      continue;
    }

    for (const variant of getTokenVariants(rawToken)) {
      if (variant.length > 1 && !/^\d+$/.test(variant) && !/^\d+[.,]?\d*$/.test(variant) && !STOP_WORDS.has(variant)) {
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
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(кг|kg|г|гр|g|л|l|мл|ml|шт|штук|pcs?)/i);

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

export function getRecognizedText(recognized: RecognizedMatchInput) {
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

export function normalizeBrand(value: string) {
  const tokens = normalizeText(value).split(" ").filter(Boolean);

  for (const token of tokens) {
    const alias = BRAND_ALIASES[token];
    if (alias) return alias;
  }

  return null;
}

export function areTokensClose(left: string, right: string) {
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
