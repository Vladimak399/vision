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
  "руб",
  "рубль",
  "рублей",
  "цена",
  "распродажа",
  "акция",
]);

const FLAVOR_WORDS = new Set([
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
  минипай: "минипай",
  "мини": "мини",
  пай: "пай",
};

export function getCatalogMatchCandidates(
  recognized: RecognizedMatchInput,
  products: CatalogMatchProduct[],
  options: { limit?: number } = {},
): CatalogMatchCandidate[] {
  const limit = options.limit ?? 5;
  const recognizedText = normalizeText(
    [recognized.rawName, recognized.brand, recognized.sizeText, recognized.priceTagText, recognized.productVisibleText]
      .filter(Boolean)
      .join(" "),
  );
  const recognizedTokens = tokenizeForMatch(recognizedText);
  const recognizedBrand = normalizeBrand([recognized.brand, recognized.rawName, recognized.productVisibleText, recognized.priceTagText].filter(Boolean).join(" "));
  const recognizedSize = normalizeSize(recognized.sizeText ?? recognized.rawName ?? "");

  if (recognizedTokens.length === 0) {
    return [];
  }

  return products
    .filter((product) => product.is_active !== false)
    .map((product) => scoreProductMatch({ product, recognizedTokens, recognizedBrand, recognizedSize }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function scoreProductMatch({
  product,
  recognizedTokens,
  recognizedBrand,
  recognizedSize,
}: {
  product: CatalogMatchProduct;
  recognizedTokens: string[];
  recognizedBrand: string | null;
  recognizedSize: string | null;
}): CatalogMatchCandidate {
  const productText = normalizeText([product.name, product.brand, product.size_text].filter(Boolean).join(" "));
  const productTokens = tokenizeForMatch(productText);
  const productBrand = normalizeBrand([product.brand, product.name].filter(Boolean).join(" "));
  const productSize = normalizeSize(product.size_text ?? product.name);
  const reasons: string[] = [];

  const tokenOverlap = getWeightedTokenOverlap(recognizedTokens, productTokens);
  let score = tokenOverlap * 0.72;

  if (recognizedBrand && productBrand && recognizedBrand === productBrand) {
    score += 0.16;
    reasons.push("brand");
  }

  if (recognizedSize && productSize && recognizedSize === productSize) {
    score += 0.12;
    reasons.push("size");
  }

  if (!recognizedSize && productSize) {
    score -= 0.05;
    reasons.push("missing_size_review");
  }

  if (tokenOverlap > 0) {
    reasons.push("name");
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
    const weight = FLAVOR_WORDS.has(token) ? 0.35 : 1;
    totalWeight += weight;

    if (rightSet.has(token)) {
      matchedWeight += weight;
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
  const tokens = normalizeText(value)
    .split(" ")
    .map((token) => BRAND_ALIASES[token] ?? token)
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token.length > 1)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOP_WORDS.has(token));

  return Array.from(new Set(tokens));
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

function normalizeBrand(value: string) {
  const tokens = normalizeText(value).split(" ").filter(Boolean);

  for (const token of tokens) {
    const alias = BRAND_ALIASES[token];
    if (alias) return alias;
  }

  return tokens.length === 1 ? (BRAND_ALIASES[tokens[0]] ?? tokens[0]) : null;
}

function roundScore(score: number) {
  return Math.round(score * 10000) / 10000;
}

function roundSize(value: number) {
  return Math.round(value * 1000) / 1000;
}
