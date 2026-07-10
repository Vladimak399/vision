import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/local-product-matcher-test", { recursive: true, force: true });
mkdirSync(".tmp/local-product-matcher-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-product-matcher.ts",
  "--outDir",
  ".tmp/local-product-matcher-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { buildCompetitorShelfItemEvidenceDraft } = require("../.tmp/local-product-matcher-test/price-capture/evidence-contract.js");
const {
  buildProductMatcherInputFromEvidenceDraft,
  createLocalCatalogProductMatcher,
  productTextToRecognizedMatchInput,
  runLocalProductMatcherForDraftItems,
} = require("../.tmp/local-product-matcher-test/price-capture/local-product-matcher.js");

const catalog = [
  { id: "coffee-jockey-trad-250", name: "Кофе Жокей Традиционный 250 г", brand: "Жокей", size_text: "250 г", is_active: true },
  { id: "coffee-jockey-classic-250", name: "Кофе Жокей Классический 250 г", brand: "Жокей", size_text: "250 г", is_active: true },
  { id: "tea-greenfield-25", name: "Чай Greenfield Kenyan Sunrise 25 пак", brand: "Greenfield", size_text: "25 шт", is_active: true },
  { id: "inactive-coffee", name: "Кофе Жокей Традиционный 250 г старый", brand: "Жокей", size_text: "250 г", is_active: false },
];

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
  photoFilename: "shelf.png",
  photoStoragePath: "photos/shelf.png",
  capturedDate: "2026-07-10",
};

after(() => {
  rmSync(".tmp/local-product-matcher-test", { recursive: true, force: true });
});

test("builds recognized match input from normalized product text", () => {
  assert.deepEqual(productTextToRecognizedMatchInput({
    rawName: " Кофе Жокей Традиционный 250 г ",
    brand: " Жокей ",
    sizeText: " 250 г ",
    priceTagText: " Цена 99 90 ",
    productVisibleText: " Кофе на пачке ",
    normalizedProductText: "кофе жокей традиционный 250 г",
  }), {
    rawName: "Кофе Жокей Традиционный 250 г",
    brand: "Жокей",
    sizeText: "250 г",
    priceTagText: "Цена 99 90",
    productVisibleText: "Кофе на пачке",
  });

  assert.deepEqual(productTextToRecognizedMatchInput({
    rawName: " ",
    normalizedProductText: "кофе жокей традиционный 250 г",
  }), {
    rawName: "кофе жокей традиционный 250 г",
    brand: null,
    sizeText: null,
    priceTagText: null,
    productVisibleText: null,
  });
});

test("selects a strong local catalog match", async () => {
  const matcher = createLocalCatalogProductMatcher();
  const result = await matcher.match({
    run,
    productText: {
      rawName: "Кофе Жокей Традиционный 250 г",
      normalizedProductText: "кофе жокей традиционный 250 г",
      brand: "Жокей",
      sizeText: "250 г",
    },
    parsedPrice: { priceMinor: 9990, currency: "RUB", confidence: 0.9 },
    catalog,
  });

  assert.equal(result.selectedCatalogProductId, "coffee-jockey-trad-250");
  assert.equal(result.reviewRequired, false);
  assert.ok(result.matchConfidence >= 0.82);
  assert.equal(result.candidates[0].product.id, "coffee-jockey-trad-250");
  assert.ok(result.candidates[0].reasons.includes("name_tokens"));
});

test("keeps weak or missing matches in review", async () => {
  const matcher = createLocalCatalogProductMatcher();
  const result = await matcher.match({
    run,
    productText: { rawName: "Непонятный товар без совпадений" },
    parsedPrice: null,
    catalog,
  });

  assert.equal(result.selectedCatalogProductId, null);
  assert.equal(result.reviewRequired, true);
  assert.equal(result.matchReason, "no_candidates");
  assert.deepEqual(result.candidates, []);
});

test("marks ambiguous close catalog candidates for review", async () => {
  const matcher = createLocalCatalogProductMatcher({ ambiguityDelta: 1 });
  const result = await matcher.match({
    run,
    productText: { rawName: "Кофе Жокей 250 г", brand: "Жокей", sizeText: "250 г" },
    parsedPrice: null,
    catalog,
  });

  assert.equal(result.selectedCatalogProductId, null);
  assert.equal(result.reviewRequired, true);
  assert.match(result.matchReason, /ambiguous_catalog_candidates_review/);
  assert.ok(result.candidates.length >= 2);
});

test("builds matcher input from evidence draft", () => {
  const draft = createDraft({
    itemId: "det-1",
    productText: {
      rawName: "Кофе Жокей Традиционный 250 г",
      normalizedProductText: "кофе жокей традиционный 250 г",
      brand: "Жокей",
      sizeText: "250 г",
      priceTagText: "Цена 99 90",
    },
    parsedPrice: { priceMinor: 9990, currency: "RUB", confidence: 0.8 },
  });

  const input = buildProductMatcherInputFromEvidenceDraft({ run, draft, catalog });
  assert.equal(input.productText.rawName, "Кофе Жокей Традиционный 250 г");
  assert.equal(input.productText.normalizedProductText, "кофе жокей традиционный 250 г");
  assert.equal(input.parsedPrice.priceMinor, 9990);
  assert.equal(input.catalog.length, catalog.length);
});

test("runs local matcher over evidence drafts and builds debug DTO", async () => {
  const drafts = [
    createDraft({
      itemId: "det-coffee",
      productText: {
        rawName: "Кофе Жокей Традиционный 250 г",
        normalizedProductText: "кофе жокей традиционный 250 г",
        brand: "Жокей",
        sizeText: "250 г",
      },
      parsedPrice: { priceMinor: 9990, currency: "RUB", confidence: 0.9 },
    }),
    createDraft({
      itemId: "det-unknown",
      productText: {
        rawName: "Совсем другой товар",
        normalizedProductText: "совсем другой товар",
      },
      parsedPrice: null,
    }),
  ];

  const debug = await runLocalProductMatcherForDraftItems({ run, drafts, catalog });
  assert.equal(debug.provider.model, "catalog-fuzzy-matcher-v1");
  assert.equal(debug.metrics.inputDraftCount, 2);
  assert.equal(debug.metrics.catalogSize, 3);
  assert.equal(debug.metrics.selectedCount, 1);
  assert.equal(debug.metrics.noCandidateCount, 1);
  assert.equal(debug.items[0].selectedCatalogProductId, "coffee-jockey-trad-250");
  assert.equal(debug.items[0].reviewRequired, false);
  assert.equal(debug.items[0].candidates[0].catalogProductId, "coffee-jockey-trad-250");
  assert.equal(debug.items[1].reviewRequired, true);
  assert.equal(debug.items[1].matchReason, "no_candidates");
});

function createDraft({ itemId, productText, parsedPrice }) {
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run,
    image: { width: 200, height: 120 },
    detector: {
      itemId,
      bbox: { x: 10, y: 10, width: 60, height: 20 },
      provider: "test-detector",
      model: "test-detector-v1",
      confidence: 0.91,
    },
    productText,
    parsedPrice,
    cropExtension: "png",
  });

  assert.ok(draft);
  return draft;
}
