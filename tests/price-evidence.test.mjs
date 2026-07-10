import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/price-evidence-test", { recursive: true, force: true });
mkdirSync(".tmp/price-evidence-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-price-parser.ts",
  "server/price-capture/price-evidence.ts",
  "--outDir",
  ".tmp/price-evidence-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { parseRussianPriceText } = require("../.tmp/price-evidence-test/price-capture/local-price-parser.js");
const {
  mergeParsedPriceIntoEvidenceDraft,
  mergeParsedPricesIntoEvidenceDrafts,
} = require("../.tmp/price-evidence-test/price-capture/price-evidence.js");

after(() => {
  rmSync(".tmp/price-evidence-test", { recursive: true, force: true });
});

function draft(itemId = "det-tag-1", overrides = {}) {
  return {
    itemId,
    cropPlan: {
      bbox: { x: 1, y: 2, width: 30, height: 12 },
      cropWidth: 30,
      cropHeight: 12,
      paddingPx: 0,
      wasClamped: false,
    },
    row: {
      company_id: "company-1",
      store_id: "store-1",
      week: 1,
      processing_run_id: "run-1",
      raw_name: "Цена 99 90",
      brand: null,
      size_text: null,
      price_minor: null,
      old_price_minor: null,
      promo_price_minor: null,
      currency: "RUB",
      price_tag_text: "Цена 99 90",
      product_visible_text: null,
      confidence: 0.8,
      photo_storage_path: "photos/shelf.jpg",
      photo_filename: "shelf.jpg",
      captured_date: "2026-07-10",
      bbox: { x: 1, y: 2, width: 30, height: 12 },
      crop_storage_path: `evidence/company-1/runs/run-1/crops/${itemId}.jpg`,
      crop_width: 30,
      crop_height: 12,
      detector_provider: "detector",
      detector_model: "detector-v1",
      detector_confidence: 0.8,
      ocr_provider: "mock-ocr",
      ocr_model: "mock-ocr-v1",
      ocr_text: "Цена 99 90",
      ocr_confidence: 0.9,
      parsed_price_confidence: null,
      normalized_product_text: null,
      review_status: "pending",
      review_reason: "awaiting_local_ocr_or_match",
      ai_used: false,
      ...overrides.row,
    },
    ...overrides,
  };
}

test("merges parsed price into evidence draft row", () => {
  const parsed = parseRussianPriceText("Старая цена 129,90\nАкция 99,90");
  const merged = mergeParsedPriceIntoEvidenceDraft(draft(), parsed);

  assert.notEqual(merged, draft);
  assert.equal(merged.itemId, "det-tag-1");
  assert.equal(merged.row.price_minor, 9990);
  assert.equal(merged.row.old_price_minor, 12990);
  assert.equal(merged.row.promo_price_minor, 9990);
  assert.equal(merged.row.currency, "RUB");
  assert.equal(typeof merged.row.parsed_price_confidence, "number");
  assert.equal(merged.row.ocr_text, "Цена 99 90");
});

test("keeps draft unchanged when parsed price is null", () => {
  const original = draft();
  const merged = mergeParsedPriceIntoEvidenceDraft(original, null);

  assert.equal(merged, original);
});

test("normalizes parsed values before merging", () => {
  const merged = mergeParsedPriceIntoEvidenceDraft(draft(), {
    priceMinor: 12345.9,
    oldPriceMinor: Number.NaN,
    promoPriceMinor: null,
    currency: " usd ",
    confidence: 2,
  });

  assert.equal(merged.row.price_minor, 12345);
  assert.equal(merged.row.old_price_minor, null);
  assert.equal(merged.row.promo_price_minor, null);
  assert.equal(merged.row.currency, "USD");
  assert.equal(merged.row.parsed_price_confidence, 1);
});

test("merges parsed prices into matching drafts and reports metrics", () => {
  const result = mergeParsedPricesIntoEvidenceDrafts({
    drafts: [draft("det-1"), draft("det-2"), draft("det-3", { row: { price_minor: 7770 } })],
    parsedItems: [
      { itemId: "det-1", parsedPrice: parseRussianPriceText("Цена 10,50") },
      { itemId: "det-2", parsedPrice: parseRussianPriceText("Старая цена 20,00\nАкция 15,00") },
      { itemId: "missing", parsedPrice: parseRussianPriceText("99,90") },
      { itemId: "det-3", parsedPrice: null },
    ],
  });

  assert.equal(result.drafts[0].row.price_minor, 1050);
  assert.equal(result.drafts[1].row.price_minor, 1500);
  assert.equal(result.drafts[1].row.old_price_minor, 2000);
  assert.equal(result.drafts[1].row.promo_price_minor, 1500);
  assert.equal(result.drafts[2].row.price_minor, 7770);
  assert.deepEqual(result.metrics, {
    inputDraftCount: 3,
    parsedItemCount: 4,
    mergedDraftCount: 2,
    pricedDraftCount: 3,
    oldPriceDraftCount: 1,
    promoPriceDraftCount: 1,
  });
});
