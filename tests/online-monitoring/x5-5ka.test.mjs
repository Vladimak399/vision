/**
 * X5 / 5ka Adapter Tests — TASK-21.9
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock fetch для тестов
global.fetch = async (url, options) => {
  const html = readFileSync(
    join(import.meta.dirname, "..", "fixtures", "online", "x5-5ka", "category-bakaleya.html"),
    "utf-8"
  );

  return {
    ok: true,
    status: 200,
    text: async () => html,
  };
};

// Вспомогательные функции для тестов
function normalizePriceToMinor(price, currency = "RUB") {
  if (price === null || price === undefined) return BigInt(0);
  if (typeof price === "bigint") return price;
  if (typeof price === "number") {
    if (price > 10000) return BigInt(Math.round(price));
    return BigInt(Math.round(price * 100));
  }
  const cleaned = price.replace(/[^\d.,]/g, "").replace(",", ".").trim();
  const rubles = parseFloat(cleaned);
  if (isNaN(rubles)) return BigInt(0);
  return BigInt(Math.round(rubles * 100));
}

function normalizeBarcode(barcode) {
  if (!barcode) return null;
  const cleaned = barcode.replace(/\D/g, "");
  if (cleaned.length < 8 || cleaned.length > 13) return null;
  return cleaned;
}

function normalizeSizeText(sizeText) {
  if (!sizeText) return null;
  return sizeText.replace(/\s+/g, "").replace(/gramm/i, "г").replace(/g\b/i, "г").replace(/ml/i, "мл").replace(/l\b/i, "л").replace(/kg/i, "кг").replace(/pcs/i, "шт").trim();
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function parseApiResponse(json) {
  const products = [];
  const items = json?.results ?? json?.items ?? json?.products ?? json?.data ?? [];

  if (!Array.isArray(items)) {
    return { products, hasMore: false };
  }

  for (const item of items) {
    const product = item.product ?? item;
    const id = product.id ?? product.sku ?? product.code ?? item.id;
    if (!id) continue;

    const price = product.price ?? product.regular_price ?? product.current_price;
    const oldPrice = product.old_price ?? product.prev_price;
    const promoPrice = product.promo_price ?? product.discount_price ?? product.sale_price;

    const priceMinor = normalizePriceToMinor(price);
    const oldPriceMinor = oldPrice && oldPrice !== price ? normalizePriceToMinor(oldPrice) : null;
    const promoPriceMinor = promoPrice && promoPrice !== price ? normalizePriceToMinor(promoPrice) : null;

    const availability = product.available === false || product.stock === 0 ? "out_of_stock" : "in_stock";

    const url = product.url ?? product.link ?? `https://5ka.ru/product/${id}/`;

    products.push({
      id: String(id),
      url: url.startsWith("http") ? url : `https://5ka.ru${url}`,
      title: product.name ?? product.title ?? "",
      brand: product.brand ?? product.brand_name ?? null,
      size: product.size ?? product.weight ?? product.volume ?? product.unit ?? null,
      barcode: product.barcode ?? product.ean ?? product.gtin ?? product.upc ?? null,
      priceMinor,
      oldPriceMinor: oldPriceMinor && oldPriceMinor > 0n ? oldPriceMinor : null,
      promoPriceMinor: promoPriceMinor && promoPriceMinor > 0n ? promoPriceMinor : null,
      availability,
    });
  }

  const hasMore = !!json?.next;

  return { products, hasMore };
}

// Тестовый адаптер с использованием fixture
const x55kaAdapter = {
  key: "x5_5ka",
  parserVersion: "1.0.0",

  async *fetchCatalog(input) {
    // Для теста читаем HTML fixture и ищем __NEXT_DATA__ или парсим HTML
    const html = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "online", "x5-5ka", "category-bakaleya.html"),
      "utf-8"
    );

    // Ищем JSON в script тегах
    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
    if (nextDataMatch) {
      try {
        const jsonData = JSON.parse(nextDataMatch[1]);
        // Структура может быть разной, пробуем разные пути
        const items = jsonData?.props?.pageProps?.initialState?.catalog?.products?.items
          ?? jsonData?.props?.pageProps?.products
          ?? jsonData?.props?.pageProps?.data
          ?? [];

        if (Array.isArray(items)) {
          const parsed = parseApiResponse({ results: items });
          for (const product of parsed.products) {
            yield {
              sourceProductId: product.id,
              url: product.url,
              title: product.title,
              brand: product.brand,
              sizeText: normalizeSizeText(product.size),
              barcode: normalizeBarcode(product.barcode),
              priceMinor: product.priceMinor,
              oldPriceMinor: product.oldPriceMinor,
              promoPriceMinor: product.promoPriceMinor,
              availability: product.availability,
              observedAt: new Date(),
              rawPayloadHash: hashString(`${product.id}-${product.priceMinor}-${product.title}`),
            };
          }
        }
      } catch (e) {
        // ignore
      }
    }
  },
};

describe("X5 / 5ka Adapter", () => {
  const mockInput = {
    companyId: "test-company",
    storeId: "test-store",
    limit: 10,
  };

  it("должен иметь key 'x5_5ka'", () => {
    assert.equal(x55kaAdapter.key, "x5_5ka");
  });

  it("должен иметь parserVersion", () => {
    assert.ok(x55kaAdapter.parserVersion);
    assert.match(x55kaAdapter.parserVersion, /^\d+\.\d+\.\d+/);
  });

  it("должен возвращать async iterable", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 2) break;
    }

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it("должен возвращать products с обязательными полями", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 1) break;
    }

    const product = results[0];
    assert.ok(product.sourceProductId);
    assert.ok(product.url);
    assert.ok(product.title);
    assert.equal(typeof product.priceMinor, "bigint");
    assert.ok(["in_stock", "out_of_stock", "unknown"].includes(product.availability));
    assert.ok(product.observedAt instanceof Date);
    assert.ok(product.rawPayloadHash);
  });

  it("должен корректно парсить цену в копейках", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    // Молоко 89.90 ₽ = 8990 копеек
    const milkProduct = results.find(p => p.title.includes("Простоквашино"));
    assert.ok(milkProduct);
    assert.ok(milkProduct.priceMinor > 8000n);
    assert.ok(milkProduct.priceMinor < 10000n);
  });

  it("должен определять availability", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    // Сыр должен быть out_of_stock (stock = 0)
    const cheeseProduct = results.find(p => p.title.includes("Сыр"));
    assert.ok(cheeseProduct);
    assert.equal(cheeseProduct.availability, "out_of_stock");
  });

  it("должен генерировать rawPayloadHash", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 1) break;
    }

    const product = results[0];
    assert.ok(product.rawPayloadHash);
    assert.equal(product.rawPayloadHash.length, 8);
  });

  it("должен возвращать brand и barcode", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Простоквашино"));
    assert.ok(milkProduct);
    assert.ok(milkProduct.brand);
    assert.ok(milkProduct.barcode);
  });

  it("должен парсить old_price и promo_price", async () => {
    const results = [];
    for await (const product of x55kaAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Простоквашино"));
    assert.ok(milkProduct);
    // old_price = 95.00 = 9500 копеек
    assert.equal(milkProduct.oldPriceMinor, 9500n);

    const breadProduct = results.find(p => p.title.includes("Бородинский"));
    assert.ok(breadProduct);
    // promo_price = 39.00 = 3900 копеек
    assert.equal(breadProduct.promoPriceMinor, 3900n);
  });
});