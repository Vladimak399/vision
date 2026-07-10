import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/local-product-text-extractor-test", { recursive: true, force: true });
mkdirSync(".tmp/local-product-text-extractor-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-price-parser.ts",
  "server/price-capture/local-product-text-extractor.ts",
  "--outDir",
  ".tmp/local-product-text-extractor-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  createLocalProductTextExtractor,
  extractProductTextFromOcr,
  normalizeProductText,
  removeParsedPriceNoise,
} = require("../.tmp/local-product-text-extractor-test/price-capture/local-product-text-extractor.js");
const {
  parseRussianPriceText,
} = require("../.tmp/local-product-text-extractor-test/price-capture/local-price-parser.js");

after(() => {
  rmSync(".tmp/local-product-text-extractor-test", { recursive: true, force: true });
});

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
};

const detection = {
  id: "det-1",
  bbox: { x: 1, y: 2, width: 3, height: 4 },
  confidence: 0.9,
  provider: "test-detector",
  model: "test-detector-v1",
};

test("removes parsed price noise and keeps product-visible text", () => {
  const ocrText = [
    "Кофе Жокей Традиционный 250 г",
    "Старая цена 129,90",
    "Акция 99,90",
    "руб",
  ].join("\n");
  const parsedPrice = parseRussianPriceText(ocrText);

  const result = extractProductTextFromOcr({
    run,
    detection,
    ocr: { text: ocrText, confidence: 0.88, provider: "mock", model: "mock" },
    parsedPrice,
  });

  assert.equal(result.rawName, "Кофе Жокей Традиционный 250 г");
  assert.equal(result.productVisibleText, "Кофе Жокей Традиционный 250 г");
  assert.equal(result.normalizedProductText, "кофе жокей традиционный 250 г");
  assert.equal(result.priceTagText, ocrText);
  assert.equal(result.noise.removedLineCount, 3);
  assert.equal(result.isEmpty, false);
});

test("keeps product numbers that are not price noise", () => {
  const ocrText = [
    "Кофе 3 в 1 MacCoffee",
    "Цена 45 90",
  ].join("\n");
  const parsedPrice = parseRussianPriceText(ocrText);

  const noise = removeParsedPriceNoise(ocrText, parsedPrice);

  assert.equal(noise.cleanedText, "Кофе 3 в 1 MacCoffee");
  assert.equal(normalizeProductText(noise.cleanedText), "кофе 3 в 1 maccoffee");
});

test("implements ProductTextExtractor interface", async () => {
  const extractor = createLocalProductTextExtractor();
  const parsedPrice = parseRussianPriceText("Макароны Щебекинские\nЦена 79,99");

  const result = await extractor.extract({
    run,
    detection,
    ocr: { text: "Макароны Щебекинские\nЦена 79,99", confidence: 0.9, provider: "mock", model: "mock" },
    parsedPrice,
  });

  assert.equal(result.rawName, "Макароны Щебекинские");
  assert.equal(result.normalizedProductText, "макароны щебекинские");
  assert.equal(result.diagnostics.keptLineCount, 1);
});

test("returns empty product result for price-only OCR text", () => {
  const ocrText = "Цена\n99 90\nруб";
  const parsedPrice = parseRussianPriceText(ocrText);

  const result = extractProductTextFromOcr({
    run,
    detection,
    ocr: { text: ocrText, confidence: 0.7, provider: "mock", model: "mock" },
    parsedPrice,
  });

  assert.equal(result.rawName, null);
  assert.equal(result.normalizedProductText, null);
  assert.equal(result.isEmpty, true);
});
