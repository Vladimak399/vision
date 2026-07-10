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
    pretty: false,
  });
});

test("parses detector-only debug OCR flag", () => {
  const parsed = parseDetectorOnlyDebugArgs(["./shelf.png", "--with-ocr"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.withOcr, true);
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
    pretty: false,
  });

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.ocr, undefined);
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
  assert.ok(response.report.summary.detectedCount >= 1);
  assert.ok(response.report.drafts.length >= 1);
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

test("runs detector-only debug script with no-op OCR section", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-ocr.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug({
    imagePath: pngPath,
    companyId: "company-debug",
    storeId: "store-debug",
    week: 1,
    runId: "run-debug-ocr-1",
    capturedDate: "2026-07-10",
    contentType: "image/png",
    cropExtension: "png",
    cropPaddingPixels: 1,
    withOcr: true,
    pretty: false,
  });

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.ocr.mode, "unsupported-noop");
  assert.ok(response.ocr.metrics.ocrProcessedCount >= 1);
  assert.equal(response.ocr.metrics.ocrTextResultCount, 0);
  assert.ok(response.ocr.metrics.ocrEmptyResultCount >= 1);
  assert.equal(response.report.summary.ocr.processedCount, response.ocr.metrics.ocrProcessedCount);
  assert.equal(response.report.summary.ocr.textResultCount, 0);
  assert.ok(response.report.drafts.some((draft) => draft.ocr?.provider === "local"));
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
