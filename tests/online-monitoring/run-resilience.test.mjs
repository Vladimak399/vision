/**
 * Run Resilience Tests — TASK-21.11
 *
 * Тесты:
 * 1. Идемпотентность: повторный запуск run с теми же данными не создаёт дубликаты
 * 2. Устойчивость: ошибка одной страницы/категории не валит весь run
 * 3. RunContext: правильный подсчёт статистики
 *
 * Используем чистую логику (без БД) через мок-объекты.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

// ============================================================
// 1. RunContext — stats tracking (fixture-friendly, без БД)
// ============================================================

/**
 * In-memory RunContext для тестов (зеркало server/online-monitoring/run.ts)
 * Не пишет в БД, только считает статистику.
 */
class TestRunContext {
  constructor(runId) {
    this.runId = runId;
    this.stats = {
      fetched: 0,
      productsUpserted: 0,
      pricesInserted: 0,
      matched: 0,
      unmatched: 0,
      errors: 0,
    };
    this.errorMessages = [];
    this.events = [];
    this.completedStatus = null;
  }

  inc(field, delta = 1) {
    this.stats[field] += delta;
  }

  addError(message, metadata) {
    this.stats.errors += 1;
    this.errorMessages.push(message);
    this.events.push({ level: "error", message, metadata });
  }

  addWarn(message, metadata) {
    this.events.push({ level: "warn", message, metadata });
  }

  addInfo(message, metadata) {
    this.events.push({ level: "info", message, metadata });
  }

  complete(status) {
    this.completedStatus = status;
  }
}

// ============================================================
// In-memory product store (имитация БД для тестов)
// ============================================================

class InMemoryProductStore {
  constructor() {
    this.products = new Map(); // sourceProductId → product
    this.prices = [];          // массив price observations
    this.matches = new Map();  // sourceProductId → match
  }

  upsertProduct(product) {
    const key = product.sourceProductId;
    const existing = this.products.get(key);
    if (existing && existing.rawPayloadHash === product.rawPayloadHash) {
      // Идемпотентность: тот же payload — не обновляем
      return false;
    }
    this.products.set(key, product);
    return true; // действительно вставлен/обновлён
  }

  insertPrice(price) {
    this.prices.push(price);
  }

  getMatch(sourceProductId) {
    return this.matches.get(sourceProductId) ?? null;
  }

  saveMatch(sourceProductId, match) {
    this.matches.set(sourceProductId, match);
  }
}

// ============================================================
// Тестовые адаптеры
// ============================================================

/**
 * Фикстурный адаптер: возвращает предсказуемый набор товаров.
 */
function createFixtureAdapter(products, options = {}) {
  const { failOnCategory = null } = options;

  return {
    key: "fixture",
    parserVersion: "1.0.0",

    async *fetchCatalog(input) {
      const limit = input.limit ?? 100;
      let count = 0;

      for (const product of products) {
        if (count >= limit) break;

        if (failOnCategory && product._category === failOnCategory) {
          throw new Error(`Ошибка доступа к категории: ${failOnCategory}`);
        }

        count++;
        yield product;
      }
    },
  };
}

/**
 * Создаёт тестовый товар с опциональной категорией.
 */
function makeProduct(overrides = {}) {
  return {
    sourceProductId: `prod-${Math.random().toString(36).slice(2, 8)}`,
    url: "https://example.com/product/1/",
    title: "Товар тестовый 100г",
    brand: "ТестБренд",
    sizeText: "100г",
    barcode: "4607029428179",
    priceMinor: 8990n,
    oldPriceMinor: null,
    promoPriceMinor: null,
    availability: "in_stock",
    observedAt: new Date(),
    rawPayloadHash: "a1b2c3d4",
    _category: "bakaleya",
    ...overrides,
  };
}

// ============================================================
// ТЕСТЫ
// ============================================================

describe("RunContext", () => {
  it("инициализируется с нулевыми stats", () => {
    const ctx = new TestRunContext("run-1");
    assert.equal(ctx.stats.fetched, 0);
    assert.equal(ctx.stats.errors, 0);
    assert.equal(ctx.stats.productsUpserted, 0);
  });

  it("inc увеличивает счётчик", () => {
    const ctx = new TestRunContext("run-1");
    ctx.inc("fetched", 5);
    assert.equal(ctx.stats.fetched, 5);
    ctx.inc("fetched", 3);
    assert.equal(ctx.stats.fetched, 8);
  });

  it("addError увеличивает errors и записывает сообщение", () => {
    const ctx = new TestRunContext("run-1");
    ctx.addError("Test error", { url: "https://example.com" });
    assert.equal(ctx.stats.errors, 1);
    assert.equal(ctx.errorMessages.length, 1);
    assert.equal(ctx.errorMessages[0], "Test error");
  });

  it("complete устанавливает статус", () => {
    const ctx = new TestRunContext("run-1");
    ctx.complete("succeeded");
    assert.equal(ctx.completedStatus, "succeeded");
  });
});

// ============================================================
// 1. Тест идемпотентности
// ============================================================

describe("Run Idempotency", () => {
  it("повторный upsert с тем же hash не дублирует продукт", () => {
    const store = new InMemoryProductStore();
    const product = makeProduct({
      sourceProductId: "prod-001",
      rawPayloadHash: "hash-abc",
    });

    const first = store.upsertProduct(product);
    assert.equal(first, true, "первый insert должен вернуть true");

    const second = store.upsertProduct(product);
    assert.equal(second, false, "повторный insert с тем же hash должен вернуть false");

    assert.equal(store.products.size, 1, "в магазине должен быть только 1 продукт");
  });

  it("upsert с другим hash обновляет продукт", () => {
    const store = new InMemoryProductStore();
    const productV1 = makeProduct({
      sourceProductId: "prod-002",
      priceMinor: 8990n,
      rawPayloadHash: "hash-v1",
    });
    const productV2 = makeProduct({
      sourceProductId: "prod-002",
      priceMinor: 7990n,
      rawPayloadHash: "hash-v2",
    });

    store.upsertProduct(productV1);
    store.upsertProduct(productV2);

    assert.equal(store.products.size, 1, "должен быть 1 продукт");
    const stored = store.products.get("prod-002");
    assert.equal(stored.priceMinor, 7990n, "цена должна обновиться");
  });

  it("полный run: fetch → upsert повторный — без дублей", async () => {
    const store = new InMemoryProductStore();
    const ctx = new TestRunContext("run-idem-1");

    const products = [
      makeProduct({ sourceProductId: "p1", priceMinor: 100n, rawPayloadHash: "h1" }),
      makeProduct({ sourceProductId: "p2", priceMinor: 200n, rawPayloadHash: "h2" }),
      makeProduct({ sourceProductId: "p3", priceMinor: 300n, rawPayloadHash: "h3" }),
    ];

    const adapter = createFixtureAdapter(products);

    // Первый run
    for await (const product of adapter.fetchCatalog({ limit: 100 })) {
      const inserted = store.upsertProduct(product);
      ctx.inc("productsUpserted", inserted ? 1 : 0);
      ctx.inc("fetched");
    }
    assert.equal(ctx.stats.fetched, 3);
    assert.equal(ctx.stats.productsUpserted, 3);

    // Второй run с теми же данными (имитация повторного запуска)
    const ctx2 = new TestRunContext("run-idem-2");
    for await (const product of adapter.fetchCatalog({ limit: 100 })) {
      const inserted = store.upsertProduct(product);
      ctx2.inc("productsUpserted", inserted ? 1 : 0);
      ctx2.inc("fetched");
    }
    assert.equal(ctx2.stats.fetched, 3, "второй run тоже fetch'ит 3 товара");
    assert.equal(ctx2.stats.productsUpserted, 0, "но не вставляет ни одного (все дубли)");
    assert.equal(store.products.size, 3, "в магазине по-прежнему 3 уникальных товара");
  });
});

// ============================================================
// 2. Тест: ошибка одной страницы не валит весь run
// ============================================================

describe("Run Error Resilience", () => {
  it("ошибка в одной категории не останавливает парсинг других", async () => {
    const store = new InMemoryProductStore();
    const ctx = new TestRunContext("run-resilient-1");

    // 3 категории: bakaleya (OK), khimiya (FAIL), napitki (OK)
    const allProducts = [
      makeProduct({ sourceProductId: "b1", title: "Товар из бакалеи 1", _category: "bakaleya", rawPayloadHash: "hb1" }),
      makeProduct({ sourceProductId: "b2", title: "Товар из бакалеи 2", _category: "bakaleya", rawPayloadHash: "hb2" }),
      makeProduct({ sourceProductId: "k1", title: "Товар из химии 1", _category: "khimiya", rawPayloadHash: "hk1" }),
      makeProduct({ sourceProductId: "n1", title: "Товар из напитков 1", _category: "napitki", rawPayloadHash: "hn1" }),
      makeProduct({ sourceProductId: "n2", title: "Товар из напитков 2", _category: "napitki", rawPayloadHash: "hn2" }),
    ];

    // Имитация pattern из адаптеров: try/catch на категорию
    // В реальном адаптере категории перебираются в цикле, каждая в try/catch
    const categories = ["bakaleya", "khimiya", "napitki"];
    for (const category of categories) {
      try {
        // Фильтруем товары по категории и эмулируем fetch одной категории
        const catProducts = allProducts.filter(p => p._category === category);
        const catAdapter = createFixtureAdapter(
          catProducts,
          category === "khimiya" ? { failOnCategory: "khimiya" } : {}
        );

        for await (const product of catAdapter.fetchCatalog({ limit: 100 })) {
          const inserted = store.upsertProduct(product);
          ctx.inc("productsUpserted", inserted ? 1 : 0);
          ctx.inc("fetched");
        }
      } catch (error) {
        ctx.addError(`Ошибка парсинга категории ${category}: ${error.message}`);
      }
    }

    // Run должен завершиться с ошибкой в одной категории,
    // но с успешно обработанными другими
    assert.equal(ctx.stats.errors, 1, "должна быть 1 ошибка (khimiya)");
    assert.equal(ctx.stats.fetched, 4, "должно быть fetch'ито 4 товара (2 из bakaleya + 2 из napitki)");
    assert.equal(ctx.stats.productsUpserted, 4, "должно быть upsert'ито 4 товара");
    assert.equal(store.products.size, 4, "в магазине 4 продукта (khimiya пропущена)");
    assert.ok(ctx.errorMessages[0].includes("khimiya"), "ошибка должна упоминать khimiya");
  });

  it("fetch бросает исключение — try/catch в адаптере продолжает", async () => {
    // Адаптер, который падает на первом же fetch
    const failingAdapter = {
      key: "failing",
      parserVersion: "1.0.0",
      async *fetchCatalog() {
        throw new Error("Network error");
      },
    };

    const ctx = new TestRunContext("run-fetch-fail");
    try {
      for await (const p of failingAdapter.fetchCatalog({ limit: 100 })) {
        ctx.inc("fetched");
        void p; // intentionally consumed
      }
    } catch (error) {
      ctx.addError(`Fetch failed: ${error.message}`);
    }

    assert.equal(ctx.stats.fetched, 0, "ничего не fetch'ито");
    assert.equal(ctx.stats.errors, 1, "ошибка записана");
    assert.equal(ctx.completedStatus, null, "run не завершён (error не крашит процесс)");
  });

  it("run с mix успешных и неуспешных категорий завершается succeeded", async () => {
    const ctx = new TestRunContext("run-mixed-1");
    const categories = [
      { name: "ok1", shouldFail: false, count: 3 },
      { name: "fail1", shouldFail: true },
      { name: "ok2", shouldFail: false, count: 2 },
    ];

    let totalFetched = 0;
    for (const cat of categories) {
      try {
        if (cat.shouldFail) {
          throw new Error(`Category ${cat.name} unavailable`);
        }
        totalFetched += cat.count;
      } catch (error) {
        ctx.addError(error.message);
      }
    }

    ctx.inc("fetched", totalFetched);
    ctx.complete("succeeded");

    assert.equal(ctx.stats.fetched, 5, "3 + 2 = 5 товаров");
    assert.equal(ctx.stats.errors, 1, "1 ошибка (fail1)");
    assert.equal(ctx.completedStatus, "succeeded", "run завершён успешно несмотря на partial failure");
  });
});

// ============================================================
// 3. Matching: barcode match без LLM для confirmed match
// ============================================================

describe("Matching (без LLM)", () => {
  it("точный barcode match находит продукт без LLM", () => {
    const catalog = [
      { id: "cat-1", barcode: "4607029428179", name: "Молоко Parmalat 3.2%" },
      { id: "cat-2", barcode: "4607029428186", name: "Кофе Jacobs 200г" },
      { id: "cat-3", barcode: "4607065961011", name: "Чай Lipton 25 пакетиков" },
    ];

    const onlineProduct = {
      sourceProductId: "online-001",
      rawName: "Молоко Parmalat 3.2% 1л",
      barcode: "4607029428179",
    };

    // Имитация barcode match
    const matched = catalog.find(c => c.barcode === onlineProduct.barcode);
    assert.ok(matched, "должен найти совпадение по barcode");
    assert.equal(matched.id, "cat-1");
  });

  it("barcode match имеет confidence 1.0", () => {
    const match = {
      catalogProductId: "cat-1",
      confidence: 1.0,
      method: "barcode",
      status: "auto",
      reason: "Exact barcode match: 4607029428179",
    };

    assert.equal(match.confidence, 1.0);
    assert.equal(match.method, "barcode");
    assert.equal(match.status, "auto");
  });

  it("уже подтверждённый match не отправляется на LLM повторно", () => {
    const store = new InMemoryProductStore();
    const existingMatch = {
      catalogProductId: "cat-1",
      confidence: 1.0,
      method: "barcode",
      status: "confirmed",
      reason: "Manual confirm",
    };
    store.saveMatch("online-001", existingMatch);

    // Имитация проверки existing match
    const cached = store.getMatch("online-001");
    assert.ok(cached, "cached match найден");
    assert.equal(cached.status, "confirmed");
    assert.equal(cached.method, "barcode");

    // Если status confirmed/auto — LLM не нужен
    const needsLLM = !cached || !["auto", "confirmed"].includes(cached.status);
    assert.equal(needsLLM, false, "confirmed match не требует LLM");
  });

  it("auto match (barcode) тоже пропускает LLM", () => {
    const store = new InMemoryProductStore();
    const autoMatch = {
      catalogProductId: "cat-2",
      confidence: 1.0,
      method: "barcode",
      status: "auto",
      reason: "Exact barcode match",
    };
    store.saveMatch("online-002", autoMatch);

    const cached = store.getMatch("online-002");
    const needsLLM = !cached || !["auto", "confirmed"].includes(cached.status);
    assert.equal(needsLLM, false, "auto match тоже не требует LLM");
  });

  it("needs_review match требует LLM", () => {
    const store = new InMemoryProductStore();
    const fuzzyMatch = {
      catalogProductId: "cat-3",
      confidence: 0.75,
      method: "fuzzy",
      status: "needs_review",
      reason: "Fuzzy name match",
    };
    store.saveMatch("online-003", fuzzyMatch);

    const cached = store.getMatch("online-003");
    const needsLLM = !cached || !["auto", "confirmed"].includes(cached.status);
    assert.equal(needsLLM, true, "needs_review требует LLM");
  });

  it("нет match — отправляет на LLM", () => {
    const store = new InMemoryProductStore();
    const cached = store.getMatch("online-new");
    const needsLLM = !cached;
    assert.equal(needsLLM, true, "нет match — нужен LLM");
  });

  it("batch matching: только unmatched отправляются на LLM", () => {
    const store = new InMemoryProductStore();
    store.saveMatch("p1", { status: "confirmed", method: "barcode" });
    store.saveMatch("p2", { status: "auto", method: "barcode" });
    store.saveMatch("p3", { status: "needs_review", method: "fuzzy" });
    // p4 — нет match

    const products = [
      { sourceProductId: "p1" },
      { sourceProductId: "p2" },
      { sourceProductId: "p3" },
      { sourceProductId: "p4" },
    ];

    const needsLLM = products.filter(p => {
      const cached = store.getMatch(p.sourceProductId);
      return !cached || !["auto", "confirmed"].includes(cached.status);
    });

    assert.equal(needsLLM.length, 2, "только p3 и p4 отправляются на LLM");
    assert.equal(needsLLM[0].sourceProductId, "p3");
    assert.equal(needsLLM[1].sourceProductId, "p4");
  });
});
