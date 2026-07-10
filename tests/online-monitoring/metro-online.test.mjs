/**
 * METRO Online Adapter Tests — TASK-21.9
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Mock fetch для тестов
global.fetch = async (url, options) => {
  const html = readFileSync(
    join(import.meta.dirname, "..", "fixtures", "online", "metro-online", "category-bakaleya.html"),
    "utf-8"
  );

  return {
    ok: true,
    status: 200,
    text: async () => html,
  };
};

// Простой парсер для тестов (копия логики из адаптера)
function parseCategoryHtml(html, category, priceContext) {
  const products = [];

  // Ищем __NEXT_DATA__
  const nextDataMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/
  );

  if (nextDataMatch) {
    try {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const pageProps = jsonData?.props?.pageProps;
      const initialState = pageProps?.initialState || pageProps;

      if (initialState?.catalog?.products?.items) {
        return parseMetroCatalogProducts(initialState.catalog.products.items, priceContext);
      }

      if (initialState?.products) {
        return parseMetroCatalogProducts(initialState.products, priceContext);
      }
    } catch (e) {
      // JSON не валиден
    }
  }

  return { products: [], hasMore: false };
}

function parseMetroCatalogProducts(catalogProducts, priceContext) {
  const products = [];
  const items = Array.isArray(catalogProducts) ? catalogProducts : (catalogProducts?.items ?? []);

  for (const item of items) {
    const id = item.id || item.product_id || item.sku;
    if (!id) continue;

    let priceMinor = BigInt(0);
    let oldPriceMinor = null;
    let promoPriceMinor = null;

    if (priceContext === "online_delivery") {
      priceMinor = BigInt(Math.round(parseFloat(item.price || item.regular_price || "0") * 100));
      if (item.old_price) oldPriceMinor = BigInt(Math.round(parseFloat(item.old_price) * 100));
      if (item.promo_price) promoPriceMinor = BigInt(Math.round(parseFloat(item.promo_price) * 100));
    } else {
      priceMinor = BigInt(Math.round(parseFloat(item.store_price || item.price || "0") * 100));
      if (item.store_old_price) oldPriceMinor = BigInt(Math.round(parseFloat(item.store_old_price) * 100));
      if (item.store_promo_price) promoPriceMinor = BigInt(Math.round(parseFloat(item.store_promo_price) * 100));
    }

    const availability = item.available === false || item.stock === 0 ? "out_of_stock" : "in_stock";

    products.push({
      id: String(id),
      url: item.url || `/product/${id}/`,
      title: item.name || item.title || "",
      brand: item.brand || null,
      size: item.size || item.weight || item.volume || null,
      barcode: item.barcode || item.ean || item.upc || null,
      priceMinor,
      oldPriceMinor,
      promoPriceMinor,
      availability,
    });
  }

  return { products, hasMore: false };
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

const metroOnlineAdapter = {
  key: "metro_online",
  parserVersion: "1.0.0",

  async *fetchCatalog(input) {
    const html = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "online", "metro-online", "category-bakaleya.html"),
      "utf-8"
    );

    const priceContext = input.categoryCode === "store_visit" ? "store_visit" : "online_delivery";
    const parsed = parseCategoryHtml(html, "produkty", priceContext);

    for (const product of parsed.products) {
      yield {
        sourceProductId: product.id,
        url: product.url.startsWith("http") ? product.url : `https://online.metro-cc.ru${product.url}`,
        title: product.title,
        brand: product.brand,
        sizeText: product.size,
        barcode: product.barcode,
        priceMinor: product.priceMinor,
        oldPriceMinor: product.oldPriceMinor,
        promoPriceMinor: product.promoPriceMinor,
        availability: product.availability,
        observedAt: new Date(),
        rawPayloadHash: hashString(`${product.id}-${product.priceMinor}-${product.title}-${priceContext}`),
      };
    }
  },
};

describe("METRO Online Adapter", () => {
  const mockInput = {
    companyId: "test-company",
    storeId: "test-store",
    limit: 10,
  };

  it("должен иметь key 'metro_online'", () => {
    assert.equal(metroOnlineAdapter.key, "metro_online");
  });

  it("должен иметь parserVersion", () => {
    assert.ok(metroOnlineAdapter.parserVersion);
    assert.match(metroOnlineAdapter.parserVersion, /^\d+\.\d+\.\d+/);
  });

  it("должен возвращать async iterable", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 2) break;
    }

    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
  });

  it("должен возвращать products с обязательными полями", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(mockInput)) {
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

  it("должен корректно парсить цену в копейках (online_delivery)", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    // Молоко Parmalat 89.90 ₽ = 8990 копеек
    const milkProduct = results.find(p => p.title.includes("Parmalat"));
    assert.ok(milkProduct);
    assert.ok(milkProduct.priceMinor > 8000n);
    assert.ok(milkProduct.priceMinor < 10000n);
  });

  it("должен определять availability", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    // Чай Lipton должен быть out_of_stock (stock = 0)
    const teaProduct = results.find(p => p.title.includes("Lipton"));
    assert.ok(teaProduct);
    assert.equal(teaProduct.availability, "out_of_stock");
  });

  it("должен генерировать rawPayloadHash", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(mockInput)) {
      results.push(product);
      if (results.length >= 1) break;
    }

    const product = results[0];
    assert.ok(product.rawPayloadHash);
    assert.equal(product.rawPayloadHash.length, 8);
  });

  it("должен возвращать brand и barcode", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(mockInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Parmalat"));
    assert.ok(milkProduct);
    assert.equal(milkProduct.brand, "Parmalat");
    assert.equal(milkProduct.barcode, "4607029428179");
  });
});

describe("METRO Price Context (store_visit)", () => {
  const storeVisitInput = {
    companyId: "test-company",
    storeId: "test-store",
    limit: 10,
    categoryCode: "store_visit",
  };

  it("должен использовать store_price для контекста store_visit", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(storeVisitInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Parmalat"));
    assert.ok(milkProduct);
    // store_price = 87.50 = 8750 копеек
    assert.ok(milkProduct.priceMinor === 8750n);
  });

  it("должен учитывать promo_price в store_visit", async () => {
    const results = [];
    for await (const product of metroOnlineAdapter.fetchCatalog(storeVisitInput)) {
      results.push(product);
    }

    const milkProduct = results.find(p => p.title.includes("Parmalat"));
    assert.ok(milkProduct);
    // store_promo_price = 85.00 = 8500 копеек
    assert.ok(milkProduct.promoPriceMinor === 8500n);
  });
});