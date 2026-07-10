import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/evidence-contract-test", { recursive: true, force: true });
mkdirSync(".tmp/evidence-contract-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "--outDir",
  ".tmp/evidence-contract-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { buildCompetitorShelfItemEvidenceDraft } = require("../.tmp/evidence-contract-test/evidence-contract.js");

after(() => {
  rmSync(".tmp/evidence-contract-test", { recursive: true, force: true });
});

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
  photoStoragePath: "photos/source.jpg",
  photoFilename: "source.jpg",
  capturedDate: "2026-07-10",
};

const image = { width: 1000, height: 800 };
const detector = {
  itemId: "item-1",
  bbox: { x: 100, y: 200, width: 300, height: 120 },
  provider: "local",
  model: "heuristic-v1",
  confidence: 0.87,
};

test("builds DB-ready evidence row from run, detector, crop, OCR, and parsed price", () => {
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run,
    image,
    detector,
    cropPadding: { pixels: 10 },
    ocr: { provider: "rapidocr", model: "rapidocr-v1", text: "Nescafe Gold 95 г", confidence: 0.74 },
    productText: {
      rawName: "Nescafe Gold 95 г",
      brand: "Nescafe",
      sizeText: "95 г",
      priceTagText: "Nescafe Gold 95 г 399.99",
      productVisibleText: "Nescafe Gold",
      normalizedProductText: "nescafe gold 95 г",
    },
    parsedPrice: { priceMinor: 39999, oldPriceMinor: 45999, promoPriceMinor: null, currency: "rub", confidence: 0.91 },
  });

  assert.ok(draft);
  assert.equal(draft.itemId, "item-1");
  assert.deepEqual(draft.cropPlan.bbox, { x: 90, y: 190, width: 320, height: 140 });

  assert.deepEqual(draft.row, {
    company_id: "company-1",
    store_id: "store-1",
    week: 1,
    processing_run_id: "run-1",

    raw_name: "Nescafe Gold 95 г",
    brand: "Nescafe",
    size_text: "95 г",
    price_minor: 39999,
    old_price_minor: 45999,
    promo_price_minor: null,
    currency: "RUB",
    price_tag_text: "Nescafe Gold 95 г 399.99",
    product_visible_text: "Nescafe Gold",

    confidence: 0.87,
    photo_storage_path: "photos/source.jpg",
    photo_filename: "source.jpg",
    captured_date: "2026-07-10",

    bbox: { x: 90, y: 190, width: 320, height: 140 },
    crop_storage_path: "evidence/company-1/runs/run-1/crops/item-1.jpg",
    crop_width: 320,
    crop_height: 140,

    detector_provider: "local",
    detector_model: "heuristic-v1",
    detector_confidence: 0.87,

    ocr_provider: "rapidocr",
    ocr_model: "rapidocr-v1",
    ocr_text: "Nescafe Gold 95 г",
    ocr_confidence: 0.74,

    parsed_price_confidence: 0.91,
    normalized_product_text: "nescafe gold 95 г",

    review_status: "pending",
    review_reason: "awaiting_local_ocr_or_match",
    ai_used: false,
  });
});

test("uses OCR text as raw_name fallback before unknown", () => {
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run,
    image,
    detector,
    ocr: { text: "OCR fallback" },
  });

  assert.equal(draft.row.raw_name, "OCR fallback");
});

test("normalizes unsafe values without rejecting a draft row", () => {
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run: { ...run, photoFilename: "source.png" },
    image,
    detector: { ...detector, confidence: 5 },
    parsedPrice: { priceMinor: 123.9, currency: "₽", confidence: -2 },
    ocr: { confidence: Number.NaN },
  });

  assert.equal(draft.row.confidence, 1);
  assert.equal(draft.row.detector_confidence, 1);
  assert.equal(draft.row.price_minor, 123);
  assert.equal(draft.row.currency, "RUB");
  assert.equal(draft.row.parsed_price_confidence, 0);
  assert.equal(draft.row.ocr_confidence, null);
  assert.equal(draft.row.crop_storage_path.endsWith(".png"), true);
});

test("returns null when detector bbox cannot produce a crop", () => {
  const draft = buildCompetitorShelfItemEvidenceDraft({
    run,
    image,
    detector: { ...detector, bbox: { x: 2000, y: 2000, width: 100, height: 100 } },
  });

  assert.equal(draft, null);
});
