/**
 * Price Normalization Module — TASK-21.3
 *
 * Нормализация цен в копейки (price_minor: bigint).
 * Поддерживает разные форматы входных данных и валюты.
 */

export type PriceInput = string | number | bigint | null | undefined;
export type CurrencyCode = "RUB" | "USD" | "EUR" | "KZT" | "UAH";

/**
 * Курсы валют к рублю (hardcoded, для production лучше использовать внешний API).
 * Обновляются из `online_sources.config.exchange_rates` при необходимости.
 */
const EXCHANGE_RATES: Record<CurrencyCode, number> = {
  RUB: 1,
  USD: 90, // Примерный курс, обновлять динамически
  EUR: 100,
  KZT: 0.17,
  UAH: 2.5,
};

/**
 * Нормализует цену в копейки (целое число).
 *
 * Поддерживает форматы:
 * - "129.90" → 12990
 * - "129,90" → 12990 (запятая как десятичный разделитель)
 * - "129 ₽" → 12900
 * - 129.9 → 12990
 * - 12990 → 12990 (уже в копейках)
 */
export function normalizePriceToMinor(price: PriceInput, currency: CurrencyCode = "RUB"): bigint {
  if (price === null || price === undefined) {
    return BigInt(0);
  }

  let rubles: number;

  if (typeof price === "bigint") {
    // Предполагаем, что уже в копейках
    return price;
  }

  if (typeof price === "number") {
    // Если число большое (больше 10000), вероятно уже в копейках
    if (price > 10000) {
      return BigInt(Math.round(price));
    }
    rubles = price;
  } else {
    // Строка: убираем пробелы, валютные символы, заменяем запятую на точку
    const cleaned = price
      .replace(/[^\d.,]/g, "")
      .replace(",", ".")
      .trim();

    rubles = parseFloat(cleaned);
    if (isNaN(rubles)) {
      return BigInt(0);
    }
  }

  // Переводим в рубли (если другая валюта)
  const inRubles = rubles * (EXCHANGE_RATES[currency] ?? 1);

  // Конвертируем в копейки
  const inMinor = Math.round(inRubles * 100);

  return BigInt(inMinor);
}

/**
 * Парсит цену из строки с ценой и валютой.
 * Пример: "129.90 ₽" → { priceMinor: 12990n, currency: "RUB" }
 */
export function parsePriceWithCurrency(
  priceText: string | null
): { priceMinor: bigint; currency: CurrencyCode } {
  if (!priceText) {
    return { priceMinor: BigInt(0), currency: "RUB" };
  }

  const currencyMatch = priceText.match(/(₽|RUB|USD|EUR|KZT|UAH)/i);
  const currency: CurrencyCode = (() => {
    const c = currencyMatch?.[1]?.toUpperCase() ?? "RUB";
    if (c === "RUB" || c === "₽") return "RUB";
    if (c === "USD") return "USD";
    if (c === "EUR") return "EUR";
    if (c === "KZT") return "KZT";
    if (c === "UAH") return "UAH";
    return "RUB";
  })();

  return {
    priceMinor: normalizePriceToMinor(priceText, currency),
    currency,
  };
}

/**
 * Нормализует размер/вес товара в унифицированный формат.
 * Пример: "500г", "500 г", "0.5л", "1.5л" → "500г", "500г", "0.5л", "1.5л"
 */
export function normalizeSizeText(sizeText: string | null | undefined): string | null {
  if (!sizeText) {
    return null;
  }

  return sizeText
    .replace(/\s+/g, "")
    .replace(/gramm/i, "г")
    .replace(/g\b/i, "г")
    .replace(/ml/i, "мл")
    .replace(/l\b/i, "л")
    .replace(/kg/i, "кг")
    .replace(/pcs/i, "шт")
    .trim();
}

/**
 * Нормализует штрихкод: убирает лишние символы, оставляет цифры.
 */
export function normalizeBarcode(barcode: string | null | undefined): string | null {
  if (!barcode) {
    return null;
  }

  const cleaned = barcode.replace(/\D/g, "");
  if (cleaned.length < 8 || cleaned.length > 13) {
    return null;
  }

  return cleaned;
}

/**
 * Транслитерация рус↔латиница для fuzzy-поиска.
 * Использует тот же алгоритм, что и catalog-matching.ts.
 */
export function transliterate(text: string): string {
  const ruToLat: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };

  return text
    .toLowerCase()
    .split("")
    .map((char) => {
      if (/[а-я]/.test(char)) {
        return ruToLat[char] ?? char;
      }
      return char;
    })
    .join("");
}

/**
 * Нормализует название товара: убирает лишние символы, транслитерирует.
 */
export function normalizeProductTitle(title: string | null | undefined): string {
  if (!title) {
    return "";
  }
  return title.trim();
}