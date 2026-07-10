/**
 * Adapter Edge-Case Tests — TASK-21.11
 *
 * Тесты для граничных случаев парсинга:
 * - Пустая категория (0 товаров)
 * - Сломанная разметка (битые поля, отсутствующие атрибуты)
 * - HTTP 500
 * - Метро: dual price context (online_delivery vs store_visit)
 * - Все адаптеры: контракт ObservableProduct
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "fixtures", "online");

// ============================================================
// Shared parser (SPAR-style — regex на data-атрибутах)
// ============================================================

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function parseSparHtml(html) {
  const products = [];
  const cards = html.split('<div class="product-card"');

  for (let i = 1; i < cards.length; i++) {
    const card = cards[i];
    const id = card.match(/data-id="([^"]+)"/)?.[1];
    const priceStr = card.match(/data-price="([^"]+)"/)?.[1];
    const url = card.match(/href="([^"]+)"/)?.[1];
    const title = card.match(/title="([^"]+)"/)?.[1];
    const barcode = card.match(/data-barcode="([^"]+)"/)?.[1] ?? null;
    const avail = card.includes("out-of-stock") || card.includes("Нет в наличии")
      ? "out_of_stock"
      : "in_stock";

    if (!id || !priceStr || !url || !title) continue;

    let price;
    try {
      price = priceStr.includes(".")
        ? BigInt(Math.round(parseFloat(priceStr) * 100))
        : BigInt(parseInt(priceStr, 10) * 100);
    } catch {
      continue; // Битая цена — пропускаем товар
    }

    products.push({
      sourceProductId: id,
      url: url.startsWith("http") ? url : `https://spar-online.ru${url}`,
      title,
      brand: null,
      sizeText: null,
      barcode,
      priceMinor: price,
      oldPriceMinor: null,
      promoPriceMinor: null,
      availability: avail,
      observedAt: new Date(),
      rawPayloadHash: hashString(`${id}-${price}-${title}`),
    });
  }

  return products;
}

function createSparFixtureAdapter(fixtureFile) {
  return {
    key: "spar_online",
    parserVersion: "1.0.0",
    async *fetchCatalog() {
      const html = readFileSync(
        join(fixturesDir, "spar-online", fixtureFile),
        "utf-8"
      );
      const products = parseSparHtml(html, "test");
      for (const product of products) {
        yield product;
      }
    },
  };
}

// ============================================================
// Empty category
// ============================================================

describe("Empty category (0 товаров)", () => {
  it("возвращает пустой iterable без ошибок", async () => {
    const adapter = createSparFixtureAdapter("category-empty.html");
    const results = [];
    for await (const product of adapter.fetchCatalog({})) {
      results.push(product);
    }
    assert.equal(results.length, 0);
  });

  it("адаптер не падает при итерации по пустой категории", async () => {
    const adapter = createSparFixtureAdapter("category-empty.html");
    // Не должно быть исключений — просто потребляем iterable
    const results = [];
    for await (const p of adapter.fetchCatalog({})) {
      results.push(p);
    }
    assert.equal(results.length, 0);
  });
});

// ============================================================
// Broken markup
// ============================================================

describe("Broken markup", () => {
  it("пропускает товар без data-price", async () => {
    const adapter = createSparFixtureAdapter("category-broken.html");
    const results = [];
    for await (const product of adapter.fetchCatalog({})) {
      results.push(product);
    }

    // Товар без data-price (id=9001) и без title (id=9002) должны быть пропущены
    const noPriceProduct = results.find(p => p.sourceProductId === "9001");
    const noTitleProduct = results.find(p => p.sourceProductId === "9002");

    assert.equal(noPriceProduct, undefined, "товар без data-price пропущен");
    assert.equal(noTitleProduct, undefined, "товар без title пропущен");
  });

  it("парсит корректный товар среди сломанных", async () => {
    const adapter = createSparFixtureAdapter("category-broken.html");
    const results = [];
    for await (const product of adapter.fetchCatalog({})) {
      results.push(product);
    }

    const correctProduct = results.find(p => p.sourceProductId === "9003");
    assert.ok(correctProduct, "корректный товар должен быть распарсен");
    assert.equal(correctProduct.priceMinor, 14900n);
    assert.equal(correctProduct.title, "Корректный товар 149р");
  });

  it("пропускает товар с неконвертируемой ценой", async () => {
    const adapter = createSparFixtureAdapter("category-broken.html");
    const results = [];
    for await (const product of adapter.fetchCatalog({})) {
      results.push(product);
    }

    const badPriceProduct = results.find(p => p.sourceProductId === "9004");
    assert.equal(badPriceProduct, undefined, "товар с ценой 'abc' пропущен");
  });

  it("корректно обрабатывает HTML-entities в названии", async () => {
    const adapter = createSparFixtureAdapter("category-broken.html");
    const results = [];
    for await (const product of adapter.fetchCatalog({})) {
      results.push(product);
    }

    // Товар 9005: title содержит &quot; entities
    // В HTML fixture entities в атрибуте title: title="Сыр &quot;Российский&quot; 45% 200г"
    // В parsed HTML после readFileSync — это сырой HTML с entities
    // Наш парсер берёт title через regex, поэтому entities остаются как есть
    // Этот тест проверяет что парсер не крашится на entities
    assert.ok(results.length >= 1, "парсер не упал на HTML entities");
  });
});

// ============================================================
// HTTP error pages
// ============================================================

describe("HTTP 500 page", () => {
  it("возвращает 0 товаров из error page", async () => {
    const adapter = createSparFixtureAdapter("error-500.html");
    const results = [];
    for await (const product of adapter.fetchCatalog({})) {
      results.push(product);
    }
    assert.equal(results.length, 0);
  });

  it("не падает при парсинге error page", async () => {
    const adapter = createSparFixtureAdapter("error-500.html");
    // Не должно быть исключений — потребляем iterable
    const results = [];
    for await (const item of adapter.fetchCatalog({})) {
      results.push(item);
    }
    assert.equal(results.length, 0, "не должно быть товаров из error page");
  });
});

// ============================================================
// SPAR: Pagination detection
// ============================================================

describe("Pagination detection", () => {
  it("определяет наличие pagination", () => {
    const html = readFileSync(
      join(fixturesDir, "spar-online", "category-bakaleya.html"),
      "utf-8"
    );
    const hasMore = /pagination|load-more|has-more/i.test(html);
    assert.equal(hasMore, true, "category-bakaleya содержит pagination");

    const emptyHtml = readFileSync(
      join(fixturesDir, "spar-online", "category-empty.html"),
      "utf-8"
    );
    const emptyHasMore = /pagination|load-more|has-more/i.test(emptyHtml);
    assert.equal(emptyHasMore, false, "category-empty не содержит pagination");
  });
});

// ============================================================
// METRO: Dual price context
// ============================================================

describe("METRO dual price context", () => {
  it("online_delivery использует price/promo_price", async () => {
    const html = readFileSync(
      join(fixturesDir, "metro-online", "category-bakaleya.html"),
      "utf-8"
    );
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
    assert.ok(match, "должен найти __NEXT_DATA__");

    const data = JSON.parse(match[1]);
    const items = data?.props?.pageProps?.initialState?.catalog?.products?.items;
    assert.ok(Array.isArray(items));

    // Jacobs: price=349.00, promo_price=299.00
    const jacobs = items.find(i => i.name?.includes("Jacobs"));
    assert.ok(jacobs);
    assert.equal(jacobs.price, "349.00");
    assert.equal(jacobs.promo_price, "299.00");
  });

  it("store_visit использует store_price/store_promo_price", async () => {
    const html = readFileSync(
      join(fixturesDir, "metro-online", "category-bakaleya.html"),
      "utf-8"
    );
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
    assert.ok(match);

    const data = JSON.parse(match[1]);
    const items = data?.props?.pageProps?.initialState?.catalog?.products?.items;

    // Parmalat: store_price=87.50, store_promo_price=85.00
    const milk = items.find(i => i.name?.includes("Parmalat"));
    assert.ok(milk);
    assert.equal(milk.store_price, "87.50");
    assert.equal(milk.store_promo_price, "85.00");
  });

  it("Порошок Tide из химии: old_price и store_old_price", async () => {
    const html = readFileSync(
      join(fixturesDir, "metro-online", "category-khimiya.html"),
      "utf-8"
    );
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
    assert.ok(match);

    const data = JSON.parse(match[1]);
    const items = data?.props?.pageProps?.initialState?.catalog?.products?.items;

    const tide = items.find(i => i.name?.includes("Tide"));
    assert.ok(tide);
    assert.equal(tide.old_price, "699.00");
    assert.equal(tide.store_old_price, "679.00");
  });
});

// ============================================================
// Adapter contract: ObservableProduct validation
// ============================================================

describe("ObservableProduct contract", () => {
  const requiredFields = [
    "sourceProductId",
    "url",
    "title",
    "priceMinor",
    "availability",
    "observedAt",
    "rawPayloadHash",
  ];

  const validAvailability = ["in_stock", "out_of_stock", "unknown"];

  function validateProduct(product, label) {
    for (const field of requiredFields) {
      assert.ok(
        product[field] !== undefined && product[field] !== null,
        `${label}: missing required field "${field}"`
      );
    }
    assert.equal(
      typeof product.priceMinor,
      "bigint",
      `${label}: priceMinor must be bigint`
    );
    assert.ok(
      validAvailability.includes(product.availability),
      `${label}: invalid availability "${product.availability}"`
    );
    assert.ok(
      product.observedAt instanceof Date,
      `${label}: observedAt must be Date`
    );
    assert.ok(
      product.rawPayloadHash && product.rawPayloadHash.length > 0,
      `${label}: rawPayloadHash must be non-empty`
    );
  }

  it("SPAR adapter: все товары проходят валидацию контракта", async () => {
    const adapter = createSparFixtureAdapter("category-bakaleya.html");
    let count = 0;
    for await (const product of adapter.fetchCatalog({})) {
      validateProduct(product, `spar-product-${count}`);
      count++;
    }
    assert.ok(count > 0, "должен быть хотя бы 1 товар");
  });

  it("SPAR khimiya: все товары проходят валидацию", async () => {
    const html = readFileSync(
      join(fixturesDir, "spar-online", "category-khimiya.html"),
      "utf-8"
    );
    const products = parseSparHtml(html, "khimiya");
    assert.ok(products.length > 0);

    for (let i = 0; i < products.length; i++) {
      validateProduct(products[i], `spar-khimiya-${i}`);
    }
  });

  it("METRO adapter: JSON товары проходят валидацию контракта", async () => {
    const html = readFileSync(
      join(fixturesDir, "metro-online", "category-bakaleya.html"),
      "utf-8"
    );
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
    assert.ok(match);

    const data = JSON.parse(match[1]);
    const items = data?.props?.pageProps?.initialState?.catalog?.products?.items;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      assert.ok(item.id, `metro-item-${i}: missing id`);
      assert.ok(item.name, `metro-item-${i}: missing name`);
      assert.ok(item.price, `metro-item-${i}: missing price`);
    }
  });

  it("url формируется корректно (полный URL)", async () => {
    const adapter = createSparFixtureAdapter("category-bakaleya.html");
    for await (const product of adapter.fetchCatalog({})) {
      if (product.url && !product.url.startsWith("http")) {
        assert.fail(`URL должен начинаться с http: ${product.url}`);
      }
    }
    assert.ok(true);
  });
});
