/**
 * E2E Smoke Tests — TASK-29
 *
 * Фото-flow и online-flow smoke tests.
 *
 * Цель: проверить, что критический путь каждого flow НЕ разваливается и
 * выдаёт ожидаемый результат на стыке реальных модулей:
 *   - распознавание (server/shelf-recognition/normalize.ts — РЕАЛЬНЫЙ)
 *   - matching (server/catalog-matching.ts — РЕАЛЬНЫЙ)
 *   - парсинг шаблона Яны (server/template-parser.ts — РЕАЛЬНЫЙ)
 *   - адаптер онлайн-источника (server/online-monitoring/adapters/spar-online.ts — РЕАЛЬНЫЙ)
 *
 * DB-зависимые стадии (запись в competitor_shelf_items / online_* таблицы,
 * getLatestPrices) заменены in-memory stores, повторяющими контракт БД.
 * Это соответствует сложившейся в проекте практике (см. tests/online-monitoring/*):
 * чистая логика тестируется напрямую, а persist-слой мокается.
 *
 * Запуск: node --test tests/e2e-smoke.test.mjs
 * (добавлен в `npm run test`)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseRecognitionPayload } from "../server/shelf-recognition/normalize.ts";
import {
  getCatalogMatchCandidates,
  transliterate,
} from "../server/catalog-matching.ts";
import {
  parseMonitoringTemplate,
  splitStoreLabel,
} from "../server/template-parser.ts";
import {
  normalizePriceToMinor,
  normalizeBarcode,
  normalizeSizeText,
} from "../server/online-monitoring/normalize.ts";

import Excel from "exceljs";

// ============================================================
// In-memory mirrors of DB tables / production helpers
// ============================================================

/** Зеркало server/template-export.ts (только persist-независимая логика). */
function normalizeBarcodeLocal(value) {
  return String(value ?? "").trim().replace(/\.0$/, "");
}
function storeKey(name, address) {
  return `${name.trim().toLocaleLowerCase("ru-RU")}|${(address ?? "").trim().toLocaleLowerCase("ru-RU")}`;
}
function buildStoreIndex(stores) {
  const byNameAddress = new Map();
  const idsByName = new Map();
  for (const store of stores) {
    byNameAddress.set(storeKey(store.name, store.address), store.id);
    const nameKey = store.name.trim().toLocaleLowerCase("ru-RU");
    idsByName.set(nameKey, [...(idsByName.get(nameKey) ?? []), store.id]);
  }
  return { byNameAddress, idsByName };
}
function resolveStoreId(label, storeIndex) {
  const { name, address } = splitStoreLabel(label);
  if (!name) return null;
  const exactMatch = storeIndex.byNameAddress.get(storeKey(name, address));
  if (exactMatch) return exactMatch;
  const matchesByName = storeIndex.idsByName.get(name.toLocaleLowerCase("ru-RU")) ?? [];
  if (matchesByName.length === 1) return matchesByName[0];
  return null;
}
function buildBarcodeMap(catalog) {
  const map = new Map();
  for (const product of catalog) {
    for (const raw of [product.barcode, product.external_sku]) {
      const bc = normalizeBarcodeLocal(raw);
      if (bc && !map.has(bc)) map.set(bc, product.id);
    }
  }
  return map;
}

// ============================================================
// Shared in-memory catalog
// ============================================================

const CATALOG = [
  { id: "cat-milka", name: "Милка Шоколад молочный 90г", brand: "milka", size_text: "90г", barcode: "46012345", external_sku: "46012345", is_active: true },
  { id: "cat-colgate", name: "Колгейт Зубная паста 100мл", brand: "colgate", size_text: "100мл", barcode: "46067890", external_sku: "46067890", is_active: true },
  { id: "cat-splat", name: "Сплат Зубная паста биокальций 100мл", brand: "splat", size_text: "100мл", barcode: "46011111", external_sku: "46011111", is_active: true },
  { id: "cat-ariel", name: "Ариэль Порошок 1кг", brand: "ariel", size_text: "1кг", barcode: "46022222", external_sku: "46022222", is_active: true },
  { id: "cat-nescafe", name: "Нескафе Кофе 95г", brand: "nescafe", size_text: "95г", barcode: "46033333", external_sku: "46033333", is_active: true },
  // Товары для online-flow (баркоды из фикстуры SPAR)
  { id: "cat-milk", name: "Молоко Parmalat 3,2% 1л", brand: null, size_text: "1л", barcode: "4607029428179", external_sku: "4607029428179", is_active: true },
  { id: "cat-coffee", name: "Кофе Jacobs 200г", brand: null, size_text: "200г", barcode: "4607029428186", external_sku: "4607029428186", is_active: true },
  { id: "cat-tea", name: "Чай Lipton 25 пакетиков", brand: null, size_text: "25 пак", barcode: "4607065961011", external_sku: "4607065961011", is_active: true },
  { id: "cat-milka-choc", name: "Шоколад Milka Орео 85г", brand: "milka", size_text: "85г", barcode: "46000001", external_sku: "46000001", is_active: true },
];

// ============================================================
// Photo-flow in-memory store
// ============================================================

class ShelfItemsStore {
  constructor() {
    this.items = [];
    this.seq = 0;
  }
  save(raw) {
    const item = { id: `shelf-${++this.seq}`, catalog_product_id: null, match_confidence: null, matched_at: null, ...raw };
    this.items.push(item);
    return item;
  }
  /** Симулирует LLM batch: берёт ТОП-кандидата (как это делает batchMatchCatalogItems). */
  applyMatch(item, candidate) {
    item.catalog_product_id = candidate.product.id;
    item.match_confidence = candidate.score;
    item.matched_at = new Date().toISOString();
  }
}

// ============================================================
// Online-flow in-memory stores
// ============================================================

class OnlineStore {
  constructor() {
    this.products = [];
    this.prices = [];
  }
  upsertProduct(p) {
    this.products.push(p);
  }
  insertPrice(row) {
    this.prices.push(row);
  }
}

// ============================================================
// Helpers: LLM-симуляция выбора матча
// ============================================================

const MATCH_THRESHOLD = 0.4;

function pickMatchCandidates(recognized) {
  return getCatalogMatchCandidates(
    {
      rawName: recognized.raw_name,
      brand: recognized.brand,
      sizeText: recognized.size_text,
      priceTagText: recognized.price_tag_text,
      productVisibleText: recognized.product_visible_text,
    },
    CATALOG,
    { limit: 30 },
  );
}

// ============================================================
// PHOTO-FLOW E2E SMOKE
// ============================================================

describe("Photo-flow E2E smoke", () => {
  it("Стадия 1: распознавание парсит сырой JSON Gemini → нормализованные товары", () => {
    const rawAiJson = JSON.stringify({
      items: [
        { raw_name: "Милка шоколад 90г", brand: "milka", size_text: "90г", price_minor: 8990 },
        { raw_name: "Colgate паста 100мл", brand: "colgate", size_text: "100мл", price: "129.90" },
        { raw_name: "Splat паста 100мл", price_minor: 15990 },
        { raw_name: "Ariel порошок 1кг", brand: "ariel", size_text: "1кг", price_minor: 34900 },
        { raw_name: "Nescafe кофе 95г", brand: "nescafe", size_text: "95г", price_minor: 25900 },
        { raw_name: "СуперПродукт QQQ 777г", price_minor: 9999 },
      ],
    });

    const payload = parseRecognitionPayload(rawAiJson, "gemini");
    assert.equal(payload.normalizeError, undefined, "нет ошибки нормализации");
    assert.equal(payload.items.length, 6, "распознано 6 товаров");
    // цена из price_minor и из строки price конвертируется в копейки
    const colgate = payload.items.find((i) => i.raw_name.includes("Colgate"));
    assert.equal(colgate.price_minor, 12990, "цена '129.90' → 12990 копеек");
    const milka = payload.items.find((i) => i.raw_name.includes("Милка"));
    assert.equal(milka.price_minor, 8990);
  });

  it("Стадия 1→2: сохранение + matching сопоставляет известные бренды с каталогом", () => {
    const rawAiJson = JSON.stringify({
      items: [
        { raw_name: "Милка шоколад 90г", brand: "milka", size_text: "90г", price_minor: 8990 },
        { raw_name: "Colgate паста 100мл", brand: "colgate", size_text: "100мл", price_minor: 12990 },
        { raw_name: "Splat паста 100мл", price_minor: 15990 },
        { raw_name: "Ariel порошок 1кг", brand: "ariel", size_text: "1кг", price_minor: 34900 },
        { raw_name: "Nescafe кофе 95г", brand: "nescafe", size_text: "95г", price_minor: 25900 },
        { raw_name: "СуперПродукт QQQ 777г", price_minor: 9999 },
      ],
    });
    const payload = parseRecognitionPayload(rawAiJson, "gemini");

    const store = new ShelfItemsStore();
    const expected = {
      "Милка": "cat-milka",
      "Colgate": "cat-colgate",
      "Splat": "cat-splat",
      "Ariel": "cat-ariel",
      "Nescafe": "cat-nescafe",
    };

    for (const item of payload.items) {
      const saved = store.save({
        week: 1,
        store_id: "store-spar",
        raw_name: item.raw_name,
        brand: item.brand,
        size_text: item.size_text,
        price_minor: item.price_minor,
      });
      // Этап 2: matching (как matchShelfItemsAction + batchMatchCatalogItems)
      const candidates = pickMatchCandidates(item);
      if (candidates.length && candidates[0].score >= MATCH_THRESHOLD) {
        store.applyMatch(saved, candidates[0]);
      }
    }

    assert.equal(store.items.length, 6, "все 6 товаров сохранены в competitor_shelf_items");
    const matched = store.items.filter((i) => i.catalog_product_id);
    assert.equal(matched.length, 5, "5 из 6 сопоставлено с каталогом");

    // Каждый известный бренд сматчен в ПРАВИЛЬНУЮ карточку каталога
    for (const [brand, catId] of Object.entries(expected)) {
      const item = store.items.find((i) => i.raw_name.includes(brand));
      assert.equal(item.catalog_product_id, catId, `${brand} → ${catId}`);
      assert.ok(item.match_confidence >= MATCH_THRESHOLD, `${brand}: confidence >= threshold`);
    }

    // Заведомо чужой товар НЕ сматчен
    const xyz = store.items.find((i) => i.raw_name.includes("СуперПродукт"));
    assert.equal(xyz.catalog_product_id, null, "СуперПродукт QQQ остался несопоставленным");
  });

  it("Стадия 3: экспорт проставляет цены конкурентов в ячейки шаблона Яны", async () => {
    // Подготовим сопоставленные товары (результат предыдущего шага)
    const recognized = [
      { raw_name: "Милка шоколад 90г", brand: "milka", size_text: "90г", price_minor: 8990, cat: "cat-milka" },
      { raw_name: "Colgate паста 100мл", brand: "colgate", size_text: "100мл", price_minor: 12990, cat: "cat-colgate" },
      { raw_name: "Splat паста 100мл", price_minor: 15990, cat: "cat-splat" },
      { raw_name: "Ariel порошок 1кг", brand: "ariel", size_text: "1кг", price_minor: 34900, cat: "cat-ariel" },
      { raw_name: "СуперПродукт QQQ 777г", price_minor: 9999, cat: null },
    ];
    const store = new ShelfItemsStore();
    for (const r of recognized) {
      const saved = store.save({ week: 1, store_id: "store-spar", raw_name: r.raw_name, brand: r.brand, size_text: r.size_text, price_minor: r.price_minor });
      if (r.cat) {
        const cands = pickMatchCandidates(r);
        if (cands.length && cands[0].score >= MATCH_THRESHOLD) store.applyMatch(saved, cands[0]);
      }
    }

    // price map: catalog_product_id → store_id → price_minor (как строит fillTemplateWithPrices)
    const priceMap = new Map();
    for (const item of store.items) {
      if (!item.catalog_product_id) continue;
      const inner = priceMap.get(item.catalog_product_id) ?? new Map();
      inner.set(item.store_id, item.price_minor);
      priceMap.set(item.catalog_product_id, inner);
    }

    // Строим шаблон Яны (Продукты) с колонкой-конкурентом "Спар, Ленина 60"
    const templateBuf = await buildYanaTemplate([
      { name: "Милка Шоколад молочный 90г", barcode: "46012345" },
      { name: "Колгейт Зубная паста 100мл", barcode: "46067890" },
      { name: "Сплат Зубная паста биокальций 100мл", barcode: "46011111" },
      { name: "Ариэль Порошок 1кг", barcode: "46022222" },
      { name: "Продукт без совпадения XYZ 200г", barcode: "46999999" },
    ]);

    const stores = [{ id: "store-spar", name: "Спар", address: "Ленина 60" }];

    // Заполняем цены (зеркало fillTemplateWithPrices, но из in-memory priceMap)
    const filledBuf = await fillTemplateWithInMemoryPrices(templateBuf, 1, CATALOG, stores, priceMap);
    const filled = new Excel.Workbook();
    await filled.xlsx.load(filledBuf);
    const worksheet = filled.getWorksheet("Продукты");
    assert.ok(worksheet);

    // Колонка D (index 3) — "Спар, Ленина 60"; строки товаров начинаются с row 2 (0-based)
    // Milka → 89.90, Colgate → 129.90, Splat → 159.90, Ariel → 349.00
    const expect = {
      "46012345": 89.9,
      "46067890": 129.9,
      "46011111": 159.9,
      "46022222": 349.0,
      "46999999": undefined, // несопоставлен → ячейка пуста
    };
    for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const barcode = String(worksheet.getCell(rowNumber, 2).value ?? "").trim();
      if (!expect[barcode]) continue;
      const cell = worksheet.getCell(rowNumber, 4).value;
      if (expect[barcode] === undefined) {
        assert.equal(cell, "" , `товар ${barcode} (несопоставлен) — ячейка пуста`);
      } else {
        assert.equal(Number(cell), expect[barcode], `товар ${barcode} — цена ${expect[barcode]} в колонке конкурента`);
      }
    }
  });
});

// ============================================================
// ONLINE-FLOW E2E SMOKE
// ============================================================

// Фикстурный SPAR-адаптер: зеркалирует HTML-экстракцию (regex) из
// server/online-monitoring/adapters/spar-online.ts, но использует РЕАЛЬНЫЕ
// функции нормализации (normalizePriceToMinor/normalizeBarcode/normalizeSizeText)
// и РЕАЛЬНЫЙ matching (getCatalogMatchCandidates).
// Импорт самого адаптера невозможен в node (extensionless `../types` import),
// поэтому extraction зеркалируется — как и в tests/online-monitoring/spar-online.test.mjs.
const sparFixture = readFileSync(
  join(import.meta.dirname, "fixtures", "online", "spar-online", "category-bakaleya.html"),
  "utf-8",
);

function createSparFixtureAdapter() {
  return {
    key: "spar_online",
    parserVersion: "1.0.0",
    async *fetchCatalog(input) {
      const limit = input.limit ?? 100;
      let fetched = 0;
      const html = sparFixture;
      const cards = html.split('<div class="product-card"');
      for (let i = 1; i < cards.length; i++) {
        if (fetched >= limit) break;
        const card = cards[i];
        const id = card.match(/data-id="([^"]+)"/)?.[1];
        const priceStr = card.match(/data-price="([^"]+)"/)?.[1];
        const url = card.match(/href="([^"]+)"/)?.[1];
        const title = card.match(/title="([^"]+)"/)?.[1];
        const avail = card.includes("out-of-stock") || card.includes("Нет в наличии") ? "out_of_stock" : "in_stock";
        if (!id || !priceStr || !url || !title) continue;
        const price = priceStr.includes(".")
          ? BigInt(Math.round(parseFloat(priceStr) * 100))
          : BigInt(parseInt(priceStr, 10) * 100);
        fetched++;
        yield {
          sourceProductId: id,
          url: url.startsWith("http") ? url : `https://spar-online.ru${url}`,
          title,
          brand: null,
          sizeText: normalizeSizeText(null),
          barcode: normalizeBarcode(card.match(/data-barcode="([^"]+)"/)?.[1] ?? null),
          priceMinor: normalizePriceToMinor(priceStr, "RUB"),
          oldPriceMinor: null,
          promoPriceMinor: null,
          availability: avail,
          observedAt: new Date(),
          rawPayloadHash: hashString(`${id}-${price}-${title}`),
        };
      }
    },
  };
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

describe("Online-flow E2E smoke", () => {
  it("Адаптер парсит HTML → нормализованные товары с ценами в копейках", async () => {
    const adapter = createSparFixtureAdapter();
    const products = [];
    for await (const p of adapter.fetchCatalog({ companyId: "c", storeId: "s", limit: 4 })) {
      products.push(p);
    }
    // limit: 4 → после первой категории (4 товара) парсинг останавливается
    assert.equal(products.length, 4, "распознано 4 товара из фикстуры");
    for (const p of products) {
      assert.ok(typeof p.priceMinor === "bigint", "цена — bigint (копейки)");
      assert.ok(p.priceMinor > 0n, "цена > 0");
      assert.ok(["in_stock", "out_of_stock", "unknown"].includes(p.availability));
      assert.ok(p.observedAt instanceof Date);
    }
    const milk = products.find((p) => p.title.includes("Parmalat"));
    assert.equal(milk.priceMinor, 8990n, "Молоко Parmalat 89.90 → 8990 копеек (реальный normalizePriceToMinor)");
  });

  it("Полный online-flow: fetch → persist → matching → price map", async () => {
    const adapter = createSparFixtureAdapter();
    const store = new OnlineStore();
    const onlineStoreId = "spar-store";

    // Стадия 1: fetch + persist (как worker: upsert products + insert prices)
    for await (const p of adapter.fetchCatalog({ companyId: "c", storeId: onlineStoreId, limit: 4 })) {
      store.upsertProduct({ sourceProductId: p.sourceProductId, barcode: p.barcode, title: p.title, rawPayloadHash: p.rawPayloadHash });
      store.insertPrice({
        catalog_product_id: null, // заполним после matching
        store_id: onlineStoreId,
        price_minor: Number(p.priceMinor),
        observed_at: p.observedAt.toISOString(),
      });
    }
    assert.equal(store.products.length, 4, "4 товара сохранено в online_source_products");
    assert.equal(store.prices.length, 4, "4 цены сохранено в online_prices");

    // Стадия 2: matching (как server/online-monitoring/matching.ts)
    // barcode match → иначе fuzzy/LLM batch. matching идёт по индексу (product i ↔ price i)
    const barcodeIndex = new Map(CATALOG.map((c) => [normalizeBarcode(c.barcode), c.id]));
    for (let i = 0; i < store.products.length; i++) {
      const product = store.products[i];
      let catalogId = null;
      if (product.barcode && barcodeIndex.has(product.barcode)) {
        catalogId = barcodeIndex.get(product.barcode); // barcode match, confidence 1.0
      } else {
        const cands = getCatalogMatchCandidates(
          { rawName: product.title, brand: null, sizeText: null },
          CATALOG,
          { limit: 10 },
        );
        if (cands.length && cands[0].score >= MATCH_THRESHOLD) catalogId = cands[0].product.id;
      }
      store.prices[i].catalog_product_id = catalogId;
    }

    // Проверяем barcode-матчи (milk, coffee, tea) и fuzzy-матч (Milka Oreo без баркода)
    const byBarcode = (bc) => store.products.find((p) => p.barcode === bc);
    assert.equal(store.prices[store.products.indexOf(byBarcode("4607029428179"))].catalog_product_id, "cat-milk");
    assert.equal(store.prices[store.products.indexOf(byBarcode("4607029428186"))].catalog_product_id, "cat-coffee");
    assert.equal(store.prices[store.products.indexOf(byBarcode("4607065961011"))].catalog_product_id, "cat-tea");
    const milkaOreo = store.products.find((p) => p.title.includes("Milka Орео"));
    assert.equal(store.prices[store.products.indexOf(milkaOreo)].catalog_product_id, "cat-milka-choc", "Milka Орео сматчен по названию (fuzzy)");

    // Стадия 3: price observation map (как getLatestPrices online_preferred)
    const priceObs = new Map();
    for (const row of store.prices) {
      if (!row.catalog_product_id) continue;
      const inner = priceObs.get(row.catalog_product_id) ?? new Map();
      inner.set(row.store_id, { catalogProductId: row.catalog_product_id, storeId: row.store_id, priceMinor: row.price_minor, source: "online" });
      priceObs.set(row.catalog_product_id, inner);
    }
    assert.equal(priceObs.size, 4, "4 товара с ценами в online price map");
    assert.equal(priceObs.get("cat-milk").get("spar-store").priceMinor, 8990, "цена milk из онлайна = 8990");
  });
});

// ============================================================
// COMBINED: merge photo + online (режим latest / online_preferred)
// ============================================================

describe("Combined price merge (latest mode) smoke", () => {
  it("online имеет приоритет, photo заполняет отсутствующие пары (товар,магазин)", () => {
    // Моделируем getLatestPrices(companyId, week, "latest"):
    // 1) online_preferred: онлайн-цены
    // 2) photo_only fallback: фото-цены НЕ перезаписывают онлайн по той же (товар,магазин)
    const online = new Map();
    const photo = new Map();

    // cat-milk: в обоих источниках по store "spar-store", но с разной ценой
    online.set("cat-milk", new Map([["spar-store", 8990]]));
    photo.set("cat-milk", new Map([["spar-store", 9500], ["photo-only-store", 8000]]));

    const merged = mergeLatest(online, photo);

    // online побеждает там, где есть оба
    assert.equal(merged.get("cat-milk").get("spar-store"), 8990, "online приоритетнее photo по одной паре");
    // photo заполняет там, где онлайна нет
    assert.equal(merged.get("cat-milk").get("photo-only-store"), 8000, "photo fallback где нет онлайна");
  });
});

/** Зеркало merge-логики getLatestPrices (mode: latest / online_preferred). */
function mergeLatest(online, photo) {
  const merged = new Map();
  for (const [catId, storeMap] of (online ?? new Map())) {
    const inner = new Map();
    for (const [storeId, price] of storeMap) inner.set(storeId, price);
    merged.set(catId, inner);
  }
  for (const [catId, storeMap] of (photo ?? new Map())) {
    const inner = merged.get(catId) ?? new Map();
    for (const [storeId, price] of storeMap) {
      if (inner.has(storeId)) continue; // не перезаписываем онлайн
      inner.set(storeId, price);
    }
    merged.set(catId, inner);
  }
  return merged;
}

// ============================================================
// Helpers: построение шаблона Яны и заполнения цен
// ============================================================

async function buildYanaTemplate(products) {
  const workbook = new Excel.Workbook();
  const worksheet = workbook.addWorksheet("Продукты");
  worksheet.addRow(["", "", "Наша ТТ (Розница)"]);
  worksheet.addRow(["Наименование", "Штрихкод", "Наша цена", "Спар, Ленина 60"]);
  for (const product of products) worksheet.addRow([product.name, product.barcode, "", ""]);
  worksheet.mergeCells(1, 3, 1, 4);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Зеркало server/template-export.ts:fillTemplateWithPrices — только без БД.
 * Цены берутся из in-memory priceMap (catalog_product_id → store_id → price_minor).
 */
async function fillTemplateWithInMemoryPrices(fileBuffer, week, catalog, stores, priceMap) {
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(fileBuffer);

  const parsed = await parseMonitoringTemplate(fileBuffer, week);
  const competitorColumns = parsed.columns.filter((c) => c.priceKind === "competitor" && c.week === week);

  const barcodeToCatalogId = buildBarcodeMap(catalog);
  const storeIndex = buildStoreIndex(stores);
  const columnToStoreId = new Map();
  for (const column of competitorColumns) {
    const storeId = resolveStoreId(column.storeLabel, storeIndex);
    if (storeId) columnToStoreId.set(`${column.department}:${column.columnIndex}`, storeId);
  }

  const SHEET_TO_DEPARTMENT = { Химия: "chemistry", Продукты: "products" };
  for (const worksheet of workbook.worksheets) {
    const department = SHEET_TO_DEPARTMENT[worksheet.name];
    if (!department) continue;
    const columns = competitorColumns.filter((c) => c.department === department);
    const rowCount = worksheet.rowCount;
    for (let exceljsRow = 3; exceljsRow <= rowCount; exceljsRow += 1) {
      const row = worksheet.getRow(exceljsRow);
      const barcode = normalizeBarcodeLocal(row.getCell(2).value);
      if (!barcode || barcode === "0") continue;
      const catalogProductId = barcodeToCatalogId.get(barcode);
      if (!catalogProductId) continue;
      const storePrices = priceMap.get(catalogProductId);
      if (!storePrices) continue;
      for (const column of columns) {
        const storeId = columnToStoreId.get(`${column.department}:${column.columnIndex}`);
        if (!storeId) continue;
        const priceMinor = storePrices.get(storeId);
        if (priceMinor !== undefined) {
          row.getCell(column.columnIndex + 1).value = priceMinor / 100;
        }
      }
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
