import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/external-ocr-worker-test", { recursive: true, force: true });
mkdirSync(".tmp/external-ocr-worker-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-ocr.ts",
  "server/price-capture/external-ocr-worker.ts",
  "--outDir",
  ".tmp/external-ocr-worker-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  EXTERNAL_OCR_WORKER_PROVIDER,
  MOCK_EXTERNAL_OCR_WORKER_PROVIDER,
  buildExternalOcrWorkerRequest,
  createExternalOcrWorkerEngine,
  createMockExternalOcrWorkerClient,
} = require("../.tmp/external-ocr-worker-test/price-capture/external-ocr-worker.js");

after(() => {
  rmSync(".tmp/external-ocr-worker-test", { recursive: true, force: true });
});

function ocrInput(overrides = {}) {
  return {
    run: {
      companyId: "company-1",
      storeId: "store-1",
      week: 1,
      runId: "run-1",
    },
    photo: {
      bytes: new Uint8Array([1, 2, 3, 4]),
      dimensions: { width: 2, height: 2 },
      filename: "det-tag-1.raw",
      storagePath: "evidence/company-1/runs/run-1/crops/det-tag-1.raw",
    },
    detection: {
      id: " det-tag-1 ",
      bbox: { x: 10, y: 20, width: 30, height: 12 },
      confidence: 0.8,
      provider: "detector",
      model: "detector-v1",
    },
    crop: {
      bbox: { x: 9, y: 19, width: 32, height: 14 },
      cropWidth: 32,
      cropHeight: 14,
      paddingPx: 1,
      wasClamped: false,
    },
    ...overrides,
  };
}

test("builds external OCR worker request from existing OcrInput", () => {
  const request = buildExternalOcrWorkerRequest(ocrInput(), ["RU", "en", "ru", " "]);

  assert.equal(request.requestId, "run-1:det-tag-1");
  assert.deepEqual(request.run, {
    companyId: "company-1",
    storeId: "store-1",
    week: 1,
    runId: "run-1",
  });
  assert.deepEqual(request.item, {
    detectionId: "det-tag-1",
    itemId: "det-tag-1",
    detectionBBox: { x: 10, y: 20, width: 30, height: 12 },
    cropBBox: { x: 9, y: 19, width: 32, height: 14 },
  });
  assert.equal(request.image.byteLength, 4);
  assert.equal(request.image.width, 2);
  assert.equal(request.image.height, 2);
  assert.equal(request.image.filename, "det-tag-1.raw");
  assert.equal(request.image.storagePath, "evidence/company-1/runs/run-1/crops/det-tag-1.raw");
  assert.deepEqual(request.hints.languages, ["ru", "en"]);
});

test("mock external OCR worker engine returns normalized OCR result", async () => {
  const client = createMockExternalOcrWorkerClient({
    text: "  Цена   99 90 ",
    confidence: 0.87654,
    blocks: [{ text: "Цена", confidence: 0.9 }],
    diagnostics: { fixture: true },
  });
  const engine = createExternalOcrWorkerEngine({ client, languages: ["ru"] });

  assert.deepEqual(MOCK_EXTERNAL_OCR_WORKER_PROVIDER, {
    provider: "mock-worker",
    model: "mock-ocr-worker-v1",
    version: "PV-03-10",
  });
  assert.deepEqual(engine.provider, MOCK_EXTERNAL_OCR_WORKER_PROVIDER);

  const result = await engine.recognize(ocrInput());

  assert.equal(result.text, "Цена 99 90");
  assert.equal(result.confidence, 0.8765);
  assert.equal(result.provider, "mock-worker");
  assert.equal(result.model, "mock-ocr-worker-v1");
  assert.equal(result.isEmpty, false);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.diagnostics.requestId, "run-1:det-tag-1");
  assert.equal(result.diagnostics.workerProvider, "mock-worker");
  assert.equal(result.diagnostics.fixture, true);
});

test("worker failure can return empty OCR result or throw", async () => {
  const client = createMockExternalOcrWorkerClient({
    fail: true,
    errorCode: "mock_timeout",
    errorMessage: "Mock timeout",
  });

  const safeEngine = createExternalOcrWorkerEngine({
    client,
    provider: EXTERNAL_OCR_WORKER_PROVIDER,
  });
  const safeResult = await safeEngine.recognize(ocrInput());

  assert.equal(safeResult.text, "");
  assert.equal(safeResult.isEmpty, true);
  assert.equal(safeResult.provider, "external-worker");
  assert.equal(safeResult.model, "external-ocr-worker-v1");
  assert.equal(safeResult.diagnostics.reason, "external_ocr_worker_failed");
  assert.equal(safeResult.diagnostics.errorCode, "mock_timeout");
  assert.equal(safeResult.diagnostics.errorMessage, "Mock timeout");

  const throwingEngine = createExternalOcrWorkerEngine({ client, throwOnWorkerError: true });
  await assert.rejects(() => throwingEngine.recognize(ocrInput()), /Mock timeout/);
});
