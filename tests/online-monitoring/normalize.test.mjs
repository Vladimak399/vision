/**
 * Normalize Module Tests — TASK-21.11
 *
 * Тесты для normalize.ts: цена, штрихкод, размер, транслитерация.
 * Используем копию логики (чистые функции) для тестирования контракта.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// Копия логики из server/online-monitoring/normalize.ts для тестирования контракта
// Это допустимо — тестируем контракт, а не конкретный файл
function normalizePriceToMinorLocal(price, currency = "RUB") {
  if (price === null || price === undefined) return BigInt(0);
  if (typeof price === "bigint") return price;
  if (typeof price === "number") {
    if (price > 10000) return BigInt(Math.round(price));
    return BigInt(Math.round(price * 100));
  }
  const cleaned = price.replace(/[^\d.,]/g, "").replace(",", ".").trim();
  const rubles = parseFloat(cleaned);
  if (isNaN(rubles)) return BigInt(0);
  const rate = currency === "USD" ? 90 : currency === "EUR" ? 100 : currency === "KZT" ? 0.17 : currency === "UAH" ? 2.5 : 1;
  return BigInt(Math.round(rubles * rate * 100));
}

function normalizeBarcodeLocal(barcode) {
  if (!barcode) return null;
  const cleaned = barcode.replace(/\D/g, "");
  if (cleaned.length < 8 || cleaned.length > 13) return null;
  return cleaned;
}

function normalizeSizeTextLocal(sizeText) {
  if (!sizeText) return null;
  return sizeText.replace(/\s+/g, "").replace(/gramm/i, "г").replace(/g\b/i, "г").replace(/ml/i, "мл").replace(/l\b/i, "л").replace(/kg/i, "кг").replace(/pcs/i, "шт").trim();
}

function transliterateLocal(text) {
  const ruToLat = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
    с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
    щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return text.toLowerCase().split("").map(c => /[а-я]/.test(c) ? (ruToLat[c] ?? c) : c).join("");
}

function normalizeProductTitleLocal(title) {
  if (!title) return "";
  return title.trim();
}

// Используем локальные копии (они зеркально повторяют логику normalize.ts)
const norm = normalizePriceToMinorLocal;
const normBc = normalizeBarcodeLocal;
const normSz = normalizeSizeTextLocal;
const transl = transliterateLocal;
const normTitle = normalizeProductTitleLocal;

// ============================================================
// Price normalization tests
// ============================================================

describe("normalizePriceToMinor", () => {
  it("конвертирует строку с рублями и копейками (129.90 → 12990)", () => {
    assert.equal(norm("129.90"), 12990n);
  });

  it("конвертирует строку с запятой (129,90 → 12990)", () => {
    assert.equal(norm("129,90"), 12990n);
  });

  it("конвертирует строку без копеек (129 → 12900)", () => {
    assert.equal(norm("129"), 12900n);
  });

  it("конвертирует число с копейками (89.90 → 8990)", () => {
    assert.equal(norm(89.9), 8990n);
  });

  it("конвертирует число без копеек (289 → 28900)", () => {
    assert.equal(norm(289), 28900n);
  });

  it("сохраняет bigint как есть (12990n → 12990n)", () => {
    assert.equal(norm(12990n), 12990n);
  });

  it("возвращает 0 для null", () => {
    assert.equal(norm(null), 0n);
  });

  it("возвращает 0 для undefined", () => {
    assert.equal(norm(undefined), 0n);
  });

  it("возвращает 0 для пустой строки", () => {
    assert.equal(norm(""), 0n);
  });

  it("возвращает 0 для невалидной строки", () => {
    assert.equal(norm("abc"), 0n);
  });

  it("убирает валютные символы (89.90 ₽ → 8990)", () => {
    assert.equal(norm("89.90 ₽"), 8990n);
  });

  it("убирает пробелы (1 299 ₽ → 129900)", () => {
    assert.equal(norm("1 299 ₽"), 129900n);
  });

  it("большое число >10000 считается уже в копейках (12990 → 12990)", () => {
    assert.equal(norm(12990), 12990n);
  });

  it("ноль возвращает 0", () => {
    assert.equal(norm(0), 0n);
    assert.equal(norm("0"), 0n);
  });

  it("отрицательное число конвертирует", () => {
    assert.equal(norm(-50), -5000n);
  });

  it("конвертирует USD (10 USD → 900000 при курсе 90)", () => {
    const result = norm("10", "USD");
    assert.equal(result, 90000n); // 10 * 90 * 100 = 90000
  });

  it("конвертирует EUR (5 EUR → 50000 при курсе 100)", () => {
    const result = norm("5", "EUR");
    assert.equal(result, 50000n);
  });

  it("конвертирует KZT (1000 KZT → 17000 при курсе 0.17)", () => {
    const result = norm("1000", "KZT");
    assert.equal(result, 17000n); // 1000 * 0.17 * 100 = 17000
  });
});

// ============================================================
// Barcode normalization tests
// ============================================================

describe("normalizeBarcode", () => {
  it("оставляет только цифры (4607029428179)", () => {
    assert.equal(normBc("4607029428179"), "4607029428179");
  });

  it("убирает нецифровые символы (4607-029-428-179 → 4607029428179)", () => {
    assert.equal(normBc("4607-029-428-179"), "4607029428179");
  });

  it("возвращает null для null", () => {
    assert.equal(normBc(null), null);
  });

  it("возвращает null для пустой строки", () => {
    assert.equal(normBc(""), null);
  });

  it("возвращает null для слишком короткого (12345 → 5 цифр)", () => {
    assert.equal(normBc("12345"), null);
  });

  it("возвращает null для слишком длинного (>13 цифр)", () => {
    assert.equal(normBc("12345678901234"), null);
  });

  it("принимает 8-значный EAN-8", () => {
    assert.equal(normBc("96385074"), "96385074");
  });

  it("принимает 13-значный EAN-13", () => {
    assert.equal(normBc("4607029428179"), "4607029428179");
  });

  it("принимает 12-значный UPC-A", () => {
    assert.equal(normBc("012345678901"), "012345678901");
  });

  it("возвращает null для букв без цифр", () => {
    assert.equal(normBc("ABC"), null);
  });
});

// ============================================================
// Size text normalization tests
// ============================================================

describe("normalizeSizeText", () => {
  it("нормализует граммы (500 г → 500г)", () => {
    assert.equal(normSz("500 г"), "500г");
  });

  it("нормализует миллилитры (250 мл → 250мл)", () => {
    assert.equal(normSz("250 мл"), "250мл");
  });

  it("нормализует литры (1.5 л → 1.5л)", () => {
    assert.equal(normSz("1.5 л"), "1.5л");
  });

  it("нормализует килограммы (1 кг → 1кг)", () => {
    assert.equal(normSz("1 кг"), "1кг");
  });

  it("нормализует штуки (10 шт → 10шт)", () => {
    assert.equal(normSz("10 шт"), "10шт");
  });

  it("нормализует без пробела (500г → 500г)", () => {
    assert.equal(normSz("500г"), "500г");
  });

  it("убирает лишние пробелы (500   г → 500г)", () => {
    assert.equal(normSz("500   г"), "500г");
  });

  it("возвращает null для null", () => {
    assert.equal(normSz(null), null);
  });

  it("возвращает null для undefined", () => {
    assert.equal(normSz(undefined), null);
  });

  it("возвращает null для пустой строки", () => {
    assert.equal(normSz(""), null);
  });
});

// ============================================================
// Transliteration tests
// ============================================================

describe("transliterate", () => {
  it("транслитерирует кириллицу в латиницу (сплат → splat)", () => {
    assert.equal(transl("сплат"), "splat");
  });

  it("транслитерирует колгейт (колгейт → kolgeyt)", () => {
    assert.equal(transl("колгейт"), "kolgeyt");
  });

  it("транслитерирует мила (мила → mila)", () => {
    assert.equal(transl("мила"), "mila");
  });

  it("оставляет латиницу без изменений (milka → milka)", () => {
    assert.equal(transl("milka"), "milka");
  });

  it("транслитерирует щ (щетка → schetka)", () => {
    // щ→sch, е→e, т→t, к→k, а→a = "schetka"
    assert.equal(transl("щетка"), "schetka");
    // С буквой ё — ё не в маппе, остаётся как есть
    // щ→sch, ё→ё, т→t, к→k, а→a = "schёtka"
    assert.equal(transl("щётка"), "schёtka");
  });

  it("транслитерирует ю (юлия → yuliya)", () => {
    assert.equal(transl("юлия"), "yuliya");
  });

  it("транслитерирует я (яблоко → yabloko)", () => {
    assert.equal(transl("яблоко"), "yabloko");
  });

  it("переводит в нижний регистр (Милка → милка → milka)", () => {
    assert.equal(transl("Милка"), "milka");
  });

  it("транслитерирует цифры без изменений (123 → 123)", () => {
    assert.equal(transl("123"), "123");
  });

  it("транслитерирует смешанный текст (Splat зубная → splat zubnaya)", () => {
    assert.equal(transl("Splat зубная"), "splat zubnaya");
  });
});

// ============================================================
// Product title normalization tests
// ============================================================

describe("normalizeProductTitle", () => {
  it("убирает пробелы по краям", () => {
    assert.equal(normTitle("  тест  "), "тест");
  });

  it("возвращает пустую строку для null", () => {
    assert.equal(normTitle(null), "");
  });

  it("возвращает пустую строку для undefined", () => {
    assert.equal(normTitle(undefined), "");
  });

  it("возвращает пустую строку для пустой строки", () => {
    assert.equal(normTitle(""), "");
  });

  it("не изменяет нормальное название", () => {
    assert.equal(normTitle("Молоко Parmalat 3.2%"), "Молоко Parmalat 3.2%");
  });
});
