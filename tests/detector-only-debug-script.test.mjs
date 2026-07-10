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
  "server/price-capture/ocr-crop-preprocess.ts",
  "server/price-capture/ocr-crop.ts",
  "server/price-capture/ocr-evidence.ts",
  "server/price-capture/external-ocr-worker.ts",
  "server/price-capture/http-ocr-worker-client.ts",
  "server/price-capture/local-price-parser.ts",
  "server/price-capture/price-evidence.ts",
  "server/price-capture/local-product-text-extractor.ts",
  "server/price-capture/product-text-evidence.ts",
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
    ocrWorkerUrl: "http://127.0.0.1:8765/ocr",
    ocrWorkerTimeoutMs: 30000,
    mockOcrText: null,
    mockOcrConfidence: null,
    parsePrice: false,
    extractProductText: false,
    dumpCrops: false,
    cropDumpDir: "tmp/real-photo-runs/crops",
    pretty: false,
  });
});

test("parses crop dump debug flags", () => {
  const parsed = parseDetectorOnlyDebugArgs([
    "./shelf.jpg",
    "--ocr-mode", "rapidocr-worker",
    "--dump-crops",
    "--crop-dump-dir", "tmp/custom-crops",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.withOcr, true);
  assert.equal(parsed.options.dumpCrops, true);
  assert.equal(parsed.options.cropDumpDir, "tmp/custom-crops");
});

test("parses mock OCR worker, price parser, and product text debug flags", () => {
  const parsed = parseDetectorOnlyDebugArgs([
    "./shelf.jpg",
    "--ocr-mode", "mock-worker",
    "--mock-ocr-text", "Кофе 3 в 1\nЦена 99 90",
    "--mock-ocr-confidence", "0.77",
    "--extract-product-text",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.withOcr, true);
  assert.equal(parsed.options.ocrMode, "mock-worker");
  assert.equal(parsed.options.mockOcrText, "Кофе 3 в 1\nЦена 99 90");
  assert.equal(parsed.options.mockOcrConfidence, 0.77);
  assert.equal(parsed.options.parsePrice, true);
  assert.equal(parsed.options.extractProductText, true);
});

test("parses RapidOCR worker debug flags", () => {
  const parsed = parseDetectorOnlyDebugArgs([
    "./shelf.jpg",
    "--ocr-mode", "rapidocr-worker",
    "--ocr-worker-url", "http://127.0.0.1:8765/ocr",
    "--ocr-worker-timeout-ms", "1234",
    "--extract-product-text",
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.withOcr, true);
  assert.equal(parsed.options.ocrMode, "rapidocr-worker");
  assert.equal(parsed.options.ocrWorkerUrl, "http://127.0.0.1:8765/ocr");
  assert.equal(parsed.options.ocrWorkerTimeoutMs, 1234);
  assert.equal(parsed.options.parsePrice, true);
  assert.equal(parsed.options.extractProductText, true);
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

  const invalidOcrWorkerTimeout = parseDetectorOnlyDebugArgs(["./shelf.jpg", "--ocr-worker-timeout-ms", "0"]);
  assert.equal(invalidOcrWorkerTimeout.ok, false);
  assert.match(invalidOcrWorkerTimeout.error, /--ocr-worker-timeout-ms/);
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

  const json = await runDetectorOnlyDebug(baseOptions({
    imagePath: pngPath,
    companyId: "company-debug",
    storeId: "store-debug",
    runId: "run-debug-1",
    withOcr: false,
  }));

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
  assert.ok(response.report.summary.productText.unknownCount >= 1);
  assert.ok(response.report.summary.detectedCount >= 1);
  assert.ok(response.report.drafts.length >= 1);
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

test("runs debug script with mock OCR worker over extracted crops", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-mock-ocr.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug(baseOptions({
    imagePath: pngPath,
    runId: "run-debug-mock-ocr",
    withOcr: true,
    ocrMode: "mock-worker",
    mockOcrText: "Цена 99 90",
    mockOcrConfidence: 0.77,
  }));

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.ocr.mode, "mock-worker");
  assert.ok(response.ocr.metrics.mergedDraftCount >= 1);
  assert.equal(response.ocr.metrics.ocrTextResultCount, response.ocr.metrics.mergedDraftCount);
  assert.equal(response.report.summary.ocr.textResultCount, response.ocr.metrics.mergedDraftCount);
  assert.equal(response.report.summary.price.pricedCount, 0);
  assert.equal(response.ocr.items[0].status, "text");
  assert.equal(response.ocr.items[0].provider, "mock-worker");
  assert.equal(response.ocr.items[0].textPreview, "Цена 99 90");
  assert.equal(response.ocr.items[0].diagnostics.source, "detector-only-debug");
  assert.equal(response.ocr.items[0].cropDiagnostics.ocrInputWidth >= 320, true);
  assert.equal(response.report.drafts[0].ocr.provider, "mock-worker");
  assert.equal(response.report.drafts[0].ocr.text, "Цена 99 90");
  assert.equal(response.report.drafts[0].ocr.confidence, 0.77);
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

test("runs debug script with mock OCR worker and parses price into report drafts", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-price-parser.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug(baseOptions({
    imagePath: pngPath,
    runId: "run-debug-price-parser",
    withOcr: true,
    ocrMode: "mock-worker",
    mockOcrText: "Старая цена 129,90\nАкция 99,90",
    mockOcrConfidence: 0.88,
    parsePrice: true,
  }));

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

test("runs debug script with full mock OCR price and product text flow", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-product-text.png";
  await writeFile(pngPath, await createSyntheticShelfPng());

  const json = await runDetectorOnlyDebug(baseOptions({
    imagePath: pngPath,
    runId: "run-debug-product-text",
    withOcr: true,
    ocrMode: "mock-worker",
    mockOcrText: "Кофе Жокей Традиционный 250 г\nСтарая цена 129,90\nАкция 99,90",
    mockOcrConfidence: 0.91,
    parsePrice: true,
    extractProductText: true,
  }));

  const response = JSON.parse(json);
  assert.equal(response.ok, true);
  assert.equal(response.price.parser, "ru-price-parser-heuristic-v1");
  assert.equal(response.productText.extractor, "ru-product-text-extractor-heuristic-v1");
  assert.ok(response.productText.metrics.mergedDraftCount >= 1);
  assert.equal(response.report.summary.productText.namedCount, response.productText.metrics.namedDraftCount);
  assert.equal(response.report.summary.productText.normalizedCount, response.productText.metrics.normalizedDraftCount);
  assert.equal(response.report.drafts[0].product.priceMinor, 9990);
  assert.equal(response.report.drafts[0].product.rawName, "Кофе Жокей Традиционный 250 г");
  assert.equal(response.report.drafts[0].product.normalizedProductText, "кофе жокей традиционный 250 г");
  assert.equal(response.productText.extracted[0].rawName, "Кофе Жокей Традиционный 250 г");
  assert.equal(response.productText.extracted[0].normalizedProductText, "кофе жокей традиционный 250 г");
  assert.equal(JSON.stringify(response).includes("bytes"), false);
});

test("runs debug script through RapidOCR HTTP worker mode using a fake HTTP worker", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-rapidocr-worker.png";
  await writeFile(pngPath, await createSyntheticShelfPng());
  const calls = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });

    assert.equal(body.schemaVersion, "pricevision-ocr-worker-request-v1");
    assert.ok(["rgb", "rgba"].includes(body.image.pixelFormat));
    assert.ok(body.image.width >= 320);
    assert.ok(body.image.height >= 80);
    assert.ok(body.image.bytesBase64.length > 0);
    assert.equal(body.context.companyId, "company-debug");

    return new Response(JSON.stringify({
      schemaVersion: "pricevision-ocr-worker-response-v1",
      requestId: body.requestId,
      ok: true,
      provider: "rapidocr-worker",
      model: "rapidocr-v1",
      text: "Кофе Жокей Традиционный 250 г\nСтарая цена 129,90\nАкция 99,90",
      confidence: 0.83,
      blocks: [],
      diagnostics: { source: "fake-http-worker" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const json = await runDetectorOnlyDebug(baseOptions({
      imagePath: pngPath,
      runId: "run-debug-rapidocr-worker",
      withOcr: true,
      ocrMode: "rapidocr-worker",
      parsePrice: true,
      extractProductText: true,
    }));

    const response = JSON.parse(json);
    assert.equal(response.ok, true);
    assert.equal(response.ocr.mode, "rapidocr-worker");
    assert.equal(response.ocr.diagnostics.workerUrl, "http://127.0.0.1:8765/ocr");
    assert.ok(calls.length >= 1);
    assert.equal(response.ocr.items[0].status, "text");
    assert.equal(response.ocr.items[0].provider, "rapidocr-worker");
    assert.equal(response.ocr.items[0].diagnostics.source, "fake-http-worker");
    assert.equal(response.ocr.items[0].cropDiagnostics.ocrInputWidth >= 320, true);
    assert.equal(response.report.drafts[0].ocr.provider, "rapidocr-worker");
    assert.equal(response.report.drafts[0].ocr.confidence, 0.83);
    assert.equal(response.report.drafts[0].product.priceMinor, 9990);
    assert.equal(response.report.drafts[0].product.rawName, "Кофе Жокей Традиционный 250 г");
    assert.equal(response.report.drafts[0].product.normalizedProductText, "кофе жокей традиционный 250 г");
    assert.equal(JSON.stringify(response).includes("bytesBase64"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps RapidOCR worker failures visible in debug JSON", async () => {
  const pngPath = ".tmp/detector-only-debug-script-test/synthetic-shelf-rapidocr-worker-failure.png";
  await writeFile(pngPath, await createSyntheticShelfPng());
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      schemaVersion: "pricevision-ocr-worker-response-v1",
      requestId: body.requestId,
      ok: false,
      provider: "rapidocr-worker",
      model: "rapidocr-v1",
      error: {
        code: "rapidocr_unavailable",
        message: "RapidOCR is unavailable in this worker process.",
      },
      diagnostics: {
        traceback: "x".repeat(600),
        bytesBase64: "should-not-leak",
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const json = await runDetectorOnlyDebug(baseOptions({
      imagePath: pngPath,
      runId: "run-debug-rapidocr-worker-failure",
      withOcr: true,
      ocrMode: "rapidocr-worker",
      parsePrice: true,
      extractProductText: true,
    }));

    const response = JSON.parse(json);
    assert.equal(response.ok, true);
    assert.equal(response.ocr.mode, "rapidocr-worker");
    assert.equal(response.ocr.items[0].status, "worker_error");
    assert.equal(response.ocr.items[0].provider, "http-worker");
    assert.equal(response.ocr.items[0].textPreview, null);
    assert.equal(response.ocr.items[0].diagnostics.reason, "external_ocr_worker_failed");
    assert.equal(response.ocr.items[0].diagnostics.errorCode, "rapidocr_unavailable");
    assert.equal(response.ocr.items[0].diagnostics.bytesBase64, "[redacted]");
    assert.match(response.ocr.items[0].diagnostics.traceback, /…$/);
    assert.equal(response.report.summary.ocr.emptyResultCount, response.ocr.metrics.mergedDraftCount);
    assert.equal(response.report.summary.price.pricedCount, 0);
    assert.equal(JSON.stringify(response).includes("should-not-leak"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function baseOptions(overrides = {}) {
  return {
    imagePath: overrides.imagePath,
    companyId: overrides.companyId ?? "company-debug",
    storeId: overrides.storeId ?? "store-debug",
    week: overrides.week ?? 1,
    runId: overrides.runId ?? "run-debug",
    capturedDate: overrides.capturedDate ?? "2026-07-10",
    contentType: overrides.contentType ?? "image/png",
    cropExtension: overrides.cropExtension ?? "png",
    cropPaddingPixels: overrides.cropPaddingPixels ?? 1,
    withOcr: overrides.withOcr ?? false,
    ocrMode: overrides.ocrMode ?? "unsupported-noop",
    ocrWorkerUrl: overrides.ocrWorkerUrl ?? "http://127.0.0.1:8765/ocr",
    ocrWorkerTimeoutMs: overrides.ocrWorkerTimeoutMs ?? 30000,
    mockOcrText: overrides.mockOcrText ?? null,
    mockOcrConfidence: overrides.mockOcrConfidence ?? null,
    parsePrice: overrides.parsePrice ?? false,
    extractProductText: overrides.extractProductText ?? false,
    dumpCrops: overrides.dumpCrops ?? false,
    cropDumpDir: overrides.cropDumpDir ?? "tmp/real-photo-runs/crops",
    pretty: overrides.pretty ?? false,
  };
}

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
