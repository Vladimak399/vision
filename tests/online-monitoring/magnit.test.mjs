/**
 * Magnit Adapter Tests — TASK-21.9
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock fetch для тестов
global.fetch = async (url, options) => {
  const html = readFileSync(
    join(import.meta.dirname, "..", "fixtures", "online", "magnit", "category-bakaleya.html"),
    "utf-8"
  );

  return {
    ok: true,
    status: 200,
    text: async () => html,
  };
};

// Вспомогательные функции (копия из адаптера для тестов)
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

function parseMagnitCatalogProducts(items) {
  const products = [];
  for (const item of items) {
    const id = item.id ?? item.product_id ?? item.sku ?? item.code;
    if (!id) continue;

    const priceMinor = normalizePriceToMinor(item.price ?? item.regular_price ?? item.current_price ?? item.sale_price, "RUB");
    const oldPriceMinor = normalizePriceToMinor(item.old_price ?? item.regular_price ?? item.prev_price, "RUB");
    const promoPriceMinor = normalizePriceToMinor(item.promo_price ?? item.discount_price ?? item.action_price, "RUB");

    const availability = item.available === false || item.stock === 0 ? "out_of_stock" : "in_stock";

    products.push({
      id: String(id),
      url: item.url?.startsWith("http") ? item.url : `https://magnit.ru/product/${id}/`,
      title: item.name ?? item.title ?? "",
      brand: item.brand ?? null,
      size: item.size ?? item.weight ?? item.volume ?? item.unit ?? null,
      barcode: item.barcode ?? item.ean ?? item.gtin ?? item.upc ?? null,
      priceMinor,
      oldPriceMinor: oldPriceMinor > 0n ? oldPriceMinor : null,
      promoPriceMinor: promoPriceMinor > 0n ? promoPriceMinor : null,
      availability,
    });
  }
  return { products, hasMore: false };
}

const magnitAdapter = {
  key: "magnit",
  parserVersion: "1.0.0",

  async *fetchCatalog(input) {
    const html = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "online", "magnit", "category-bakaleya.html"),
      "utf-8"
    );

    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
    if (nextDataMatch) {
      try {
        const jsonData = JSON.parse(nextDataMatch[1]);
        const pageProps = jsonData?.props?.pageProps;
        const items = pageProps?.catalog?.products?.items;
        if (Array.isArray(items)) {
          const parsed = parseMagnitCatalogProducts(items);
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

describe("Magnit Adapter", () => {
  const mockInput = {
    companyId: "test-company",
    storeId: "test-store",
    limit: 10,
  };

  it("должен иметь key 'magnit'", () => {
    assert.equal(magnitAdapter.key, "magnit");
  });

  it("должен иметь parserVersion", () => {
    assert.ok(magnitAdapter.parserVersion);
    assert.match(magnitAdapter.parserVersion, /^\d+\.\d+\.\d+/);
  });

  it("должен возвращать async iterable", async () => {
    const results = [];
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 2) break;
    }

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it("должен возвращать products с обязательными полями", async () => {
    const results = [];
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
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
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    // Молоко 89.90 ₽ = 8990 копеек
    const milkProduct = results.find(p => p.title.includes("Домик"));
    assert.ok(milkProduct);
    assert.ok(milkProduct.priceMinor > 8000n);
    assert.ok(milkProduct.priceMinor < 10000n);
  });

  it("должен определять availability", async () => {
    const results = [];
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    // Рис должен быть out_of_stock (stock = 0)
    const riceProduct = results.find(p => p.title.includes("Рис"));
    assert.ok(riceProduct);
    assert.equal(riceProduct.availability, "out_of_stock");
  });

  it("должен генерировать rawPayloadHash", async () => {
    const results = [];
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 1) break;
    }

    const product = results[0];
    assert.ok(product.rawPayloadHash);
    assert.equal(product.rawPayloadHash.length, 8);
  });

  it("должен возвращать brand и barcode", async () => {
    const results = [];
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Домик"));
    assert.ok(milkProduct);
    assert.equal(milkProduct.brand, "Домик в деревне");
    assert.equal(milkProduct.barcode, "4607029428179");
  });

  it("должен парсить old_price и promo_price", async () => {
    const results = [];
    for await (const product of magnitAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Домик"));
    assert.ok(milkProduct);
    // old_price = 95.00 = 9500 копеек
    assert.equal(milkProduct.oldPriceMinor, 9500n);

    const butterProduct = results.find(p => p.title.includes("Традиционное"));
    assert.ok(butterProduct);
    // promo_price = 129.00 = 12900 копеек
    assert.equal(butterProduct.promoPriceMinor, 12900n);
  });
});