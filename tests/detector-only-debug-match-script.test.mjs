import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-debug-match-script-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-debug-match-script-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/image-decoder.ts",
  "server/price-capture/heuristic-price-tag-detector.ts",
  "server/price-capture/sharp-image-decoder.ts",
  "server/price-capture/decoded-detector-pipeline.ts",
  "server/price-capture/detector-run-service.ts",
  "server/price-capture/detector-evidence-drafts.ts",
  "server/price-capture/detector-only-orchestrator.ts",
  "server/price-capture/detector-only-report.ts",
  "server/price-capture/detector-only-api-boundary.ts",
  "server/price-capture/local-ocr.ts",
  "server/price-capture/ocr-crop.ts",
  "server/price-capture/ocr-evidence.ts",
  "server/price-capture/external-ocr-worker.ts",
  "server/price-capture/http-ocr-worker-client.ts",
  "server/price-capture/local-price-parser.ts",
  "server/price-capture/price-evidence.ts",
  "server/price-capture/local-product-text-extractor.ts",
  "server/price-capture/product-text-evidence.ts",
  "server/price-capture/local-product-matcher.ts",
  "server/price-capture/debug-match-catalog.ts",
  "server/price-capture/debug-product-match-runner.ts",
  "scripts/detector-only-debug.ts",
  "scripts/detector-only-debug-match.ts",
  "--outDir",
  ".tmp/detector-only-debug-match-script-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  parseDetectorOnlyDebugMatchArgs,
  reportDraftToMatchItem,
  reportRunToContext,
} = require("../.tmp/detector-only-debug-match-script-test/scripts/detector-only-debug-match.js");

after(() => {
  rmSync(".tmp/detector-only-debug-match-script-test", { recursive: true, force: true });
});

test("strips match flags before delegating to the base detector debug parser", () => {
  const parsed = parseDetectorOnlyDebugMatchArgs([
    "./photo.jpg",
    "--ocr-mode", "mock-worker",
    "--match-product",
    "--compact",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.matchProduct, true);
  assert.deepEqual(parsed.argv, ["./photo.jpg", "--ocr-mode", "mock-worker", "--compact"]);
});

test("keeps argv unchanged when matching is not requested", () => {
  const parsed = parseDetectorOnlyDebugMatchArgs(["./photo.jpg", "--compact"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.matchProduct, false);
  assert.deepEqual(parsed.argv, ["./photo.jpg", "--compact"]);
});

test("maps report run DTO into price capture context", () => {
  const context = reportRunToContext({
    companyId: "company-1",
    storeId: "store-1",
    week: 1,
    runId: "run-1",
    photoStoragePath: "./photo.jpg",
    photoFilename: "photo.jpg",
    capturedDate: "2026-07-10",
  });

  assert.deepEqual(context, {
    companyId: "company-1",
    storeId: "store-1",
    week: 1,
    runId: "run-1",
    photoStoragePath: "./photo.jpg",
    photoFilename: "photo.jpg",
    capturedDate: "2026-07-10",
  });
});

test("maps report draft product fields into matcher input", () => {
  const item = reportDraftToMatchItem({
    itemId: "item-1",
    product: {
      rawName: "Кофе Жокей Традиционный 250 г",
      normalizedProductText: "кофе жокей традиционный 250 г",
      brand: "Жокей",
      sizeText: "250 г",
      productVisibleText: "Кофе Жокей Традиционный 250 г",
      priceMinor: 9990,
      oldPriceMinor: 12990,
      promoPriceMinor: 9990,
      parsedPriceConfidence: 0.91,
      currency: "RUB",
    },
  });

  assert.equal(item.itemId, "item-1");
  assert.equal(item.productText.rawName, "Кофе Жокей Традиционный 250 г");
  assert.equal(item.productText.normalizedProductText, "кофе жокей традиционный 250 г");
  assert.equal(item.parsedPrice.priceMinor, 9990);
  assert.equal(item.parsedPrice.oldPriceMinor, 12990);
  assert.equal(item.parsedPrice.promoPriceMinor, 9990);
  assert.equal(item.parsedPrice.confidence, 0.91);
  assert.equal(item.parsedPrice.currency, "RUB");
});

test("maps empty report draft price evidence to null", () => {
  const item = reportDraftToMatchItem({
    itemId: "item-empty",
    product: {
      rawName: "unknown",
      normalizedProductText: null,
    },
  });

  assert.equal(item.itemId, "item-empty");
  assert.equal(item.parsedPrice, null);
});
