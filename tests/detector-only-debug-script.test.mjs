import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-debug-script-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-debug-script-test", { recursive: true });
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
  "server/price-capture/local-price-parser.ts",
  "server/price-capture/price-evidence.ts",
  "scripts/detector-only-debug.ts",
  "--outDir",
  ".tmp/detector-only-debug-script-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const {
  inferContentType,
  parseDetectorOnlyDebugArgs,
  runDetectorOnlyDebug,
} = require("../.tmp/detector-only-debug-script-test/scripts/detector-only-debug.js");

after(() => {
  rmSync(".tmp/detector-only-debug-script-test", { recursive: true, force: true });
});

test("parses detector-only debug CLI arguments", () => {
  const parsed = parseDetectorOnlyDebugArgs([
    "./shelf.png",
    "--company-id", "company-1",
    "--store-id=store-1",
    "--week", "2",
    "--run-id", "run-1",
    "--captured-date", "2026-07-10",
    "--crop-extension", "webp",
    "--crop-padding", "3",
    "--compact",
  ]);

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options, {
    imagePath: "./shelf.png",
    companyId: "company-1",
    storeId: "store-1",
    week: 2,
    runId: "run-1",
    capturedDate: "2026-07-10",
    contentType: "image/png",
    cropExtension: "webp",
    cropPaddingPixels: 3,
    withOcr: false,
    ocrMode: "unsupported-noop",
    mockOcrText: null,
    mockOcrConfidence: null,
    parsePrice: false,
    pretty: false,
  });
});

test("parses mock OCR worker and price parser debug flags", () => {
  const parsed = parseDetectorOnlyDebugArgs([
    "./shelf.jpg",
    "--ocr-mode", "mock-worker",
    "--mock-ocr-text", "Цена 99 90",
    "--mock-ocr-confidence", "0.77",
    "--parse-price",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.withOcr, true);
  assert.equal(parsed.options.ocrMode, "mock-worker");
  assert.equal(parsed.options.mockOcrText, "Цена 99 90");
  assert.equal(parsed.options.mockOcrConfidence, 0.77);
  assert.equal(parsed.options.parsePrice, true);
});

test("returns usage errors for missing path or invalid options", () => {
  const missing = parseDetectorOnlyDebugArgs([]);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /image path is required/);

  const invalidWeek = parseDetectorOnlyDebugArgs(["./shelf.jpg", "--week", "3"]);
  assert.equal(invalidWeek.ok, false);
  assert.match(invalidWeek.error, /--week must be 1 or 2/);

  const invalidPadding = parseDetectorOnlyDebugArgs(["./shelf.jpg", "--crop-padding", "-1"]);
  assert.equal(invalidPadding.ok, false);
  assert.match(invalidPadding.error, /--crop-padding/);

  const invalidOcrMode = parseDetectorOnlyDebugArgs(["./shelf.jpg", "--ocr-mode", "real"]);
  assert.equal(invalidOcrMode.ok, false);
  assert.match(invalidOcrMode.error, /--ocr-mode/);

  const invalidOcrConfidence = parseDetectorOnlyDebugArgs(["./shelf.jpg", "--mock-ocr-confidence", "2"]);
  assert.equal(invalidOcrConfidence.ok, false);
  assert.match(invalidOcrConfidence.error, /--mock-ocr-confidence/);
});

test("infers supported image content types", () => {
  assert.equal(inferContentType("a.jpg"), "image/jpeg");
  assert.equal(inferContentType("a.jpeg"), "image/jpeg");
  assert.equal(inferContentType("a.png"), "image/png");
  assert.equal(inferContentType("a.webp"), "image/webp");
  assert.equal(inferContentType("a.bin"), null);
});

test("runs detector-only debug script against a synthetic PNG file", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug({
    imagePath: pngPath,
    companyId: "company-debug",
    storeId: "store-debug",
    week: 1,
    runId: "run-debug-1",
    capturedDate: "2026-07-10",
    contentType: "image/png",
    cropExtension: "png",
    cropPaddingPixels: 1,
    withOcr: false,
    ocrMode: "unsupported-noop",
    mockOcrText: null,
    mockOcrConfidence: null,
    parsePrice: false,
    pretty: false,
  });

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.report.schemaVersion, "detector-only-report-v1");
  assert.equal(response.report.run.companyId, "company-debug");
  assert.equal(response.report.run.storeId, "store-debug");
  assert.equal(response.report.run.runId, "run-debug-1");
  assert.equal(response.report.summary.status, "completed");
  assert.equal(response.report.summary.statusReason, "ok");
  assert.equal(response.report.summary.decoderProvider, "sharp");
  assert.equal(response.report.summary.detectorProvider, "local");
  assert.equal(response.report.summary.aiUsedCount, 0);
  assert.equal(response.report.summary.aiCostMicrousd, 0);
  assert.equal(response.report.summary.ocr.processedCount, 0);
  assert.equal(response.report.summary.price.pricedCount, 0);
  assert.ok(response.report.summary.detectedCount >= 1);
  assert.ok(response.report.drafts.length >= 1);
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

test("runs debug script with mock OCR worker over extracted crops", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-mock-ocr.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug({
    imagePath: pngPath,
    companyId: "company-debug",
    storeId: "store-debug",
    week: 1,
    runId: "run-debug-mock-ocr",
    capturedDate: "2026-07-10",
    contentType: "image/png",
    cropExtension: "png",
    cropPaddingPixels: 1,
    withOcr: true,
    ocrMode: "mock-worker",
    mockOcrText: "Цена 99 90",
    mockOcrConfidence: 0.77,
    parsePrice: false,
    pretty: false,
  });

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.ocr.mode, "mock-worker");
  assert.ok(response.ocr.metrics.mergedDraftCount >= 1);
  assert.equal(response.ocr.metrics.ocrTextResultCount, response.ocr.metrics.mergedDraftCount);
  assert.equal(response.report.summary.ocr.textResultCount, response.ocr.metrics.mergedDraftCount);
  assert.equal(response.report.summary.price.pricedCount, 0);
  assert.equal(response.report.drafts[0].ocr.provider, "mock-worker");
  assert.equal(response.report.drafts[0].ocr.text, "Цена 99 90");
  assert.equal(response.report.drafts[0].ocr.confidence, 0.77);
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

test("runs debug script with mock OCR worker and parses price into report drafts", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-price-parser.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug({
    imagePath: pngPath,
    companyId: "company-debug",
    storeId: "store-debug",
    week: 1,
    runId: "run-debug-price-parser",
    capturedDate: "2026-07-10",
    contentType: "image/png",
    cropExtension: "png",
    cropPaddingPixels: 1,
    withOcr: true,
    ocrMode: "mock-worker",
    mockOcrText: "Старая цена 129,90\nАкция 99,90",
    mockOcrConfidence: 0.88,
    parsePrice: true,
    pretty: false,
  });

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.price.parser, "ru-price-parser-heuristic-v1");
  assert.ok(response.price.metrics.mergedDraftCount >= 1);
  assert.equal(response.report.summary.price.pricedCount, response.price.metrics.mergedDraftCount);
  assert.equal(response.report.drafts[0].product.priceMinor, 9990);
  assert.equal(response.report.drafts[0].product.oldPriceMinor, 12990);
  assert.equal(response.report.drafts[0].product.promoPriceMinor, 9990);
  assert.equal(response.price.parsed[0].priceMinor, 9990);
  assert.equal(response.price.parsed[0].oldPriceMinor, 12990);
  assert.equal(response.price.parsed[0].promoPriceMinor, 9990);
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

async function createSyntheticShelfPng() {
  const svg = `
    <svg width="160" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="20" width="60" height="22" fill="#ffffff"/>
      <rect x="98" y="58" width="44" height="18" fill="#ffffff"/>
    </svg>
  `;

  return sharp({
    create: {
      width: 160,
      height: 100,
      channels: 3,
      background: { r: 18, g: 18, b: 18 },
    },
  })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
