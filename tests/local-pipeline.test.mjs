import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/local-pipeline-test", { recursive: true, force: true });
mkdirSync(".tmp/local-pipeline-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "--outDir",
  ".tmp/local-pipeline-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { createInitialLocalPipelineRunResult, detectionToEvidenceDraftInput } = require("../.tmp/local-pipeline-test/price-capture/local-pipeline.js");

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
  photoStoragePath: null,
  photoFilename: null,
  capturedDate: "2026-07-10",
};

const photo = {
  bytes: new Uint8Array([1, 2, 3]),
  dimensions: { width: 1200, height: 900 },
  storagePath: "photos/source.jpg",
  filename: "source.jpg",
  sha256: "hash-1",
};

const detection = {
  id: "det-1",
  bbox: { x: 100, y: 120, width: 300, height: 140 },
  confidence: 0.82,
  provider: "local",
  model: "heuristic-v1",
};

after(() => {
  rmSync(".tmp/local-pipeline-test", { recursive: true, force: true });
});

test("creates zero-cost initial local pipeline run result", () => {
  assert.deepEqual(createInitialLocalPipelineRunResult("run-1"), {
    runId: "run-1",
    detectedCount: 0,
    writtenCount: 0,
    needsReviewCount: 0,
    unmatchedCount: 0,
    aiCallsCount: 0,
    aiCostMicrousd: 0,
    items: [],
    steps: [],
  });
});

test("maps detection and photo metadata into evidence draft input", () => {
  const input = detectionToEvidenceDraftInput({
    run,
    photo,
    detection,
    ocr: {
      text: "Nescafe Gold 95 г",
      confidence: 0.76,
      provider: "rapidocr",
      model: "rapidocr-v1",
    },
    productText: {
      rawName: "Nescafe Gold 95 г",
      brand: "Nescafe",
      sizeText: "95 г",
    },
    parsedPrice: {
      priceMinor: 39999,
      currency: "RUB",
      confidence: 0.91,
    },
  });

  assert.deepEqual(input, {
    run: {
      ...run,
      photoStoragePath: "photos/source.jpg",
      photoFilename: "source.jpg",
    },
    image: { width: 1200, height: 900 },
    detector: {
      itemId: "det-1",
      bbox: { x: 100, y: 120, width: 300, height: 140 },
      provider: "local",
      model: "heuristic-v1",
      confidence: 0.82,
    },
    ocr: {
      provider: "rapidocr",
      model: "rapidocr-v1",
      text: "Nescafe Gold 95 г",
      confidence: 0.76,
    },
    productText: {
      rawName: "Nescafe Gold 95 г",
      brand: "Nescafe",
      sizeText: "95 г",
    },
    parsedPrice: {
      priceMinor: 39999,
      currency: "RUB",
      confidence: 0.91,
    },
  });
});

test("keeps explicit run photo metadata over photo fallback", () => {
  const input = detectionToEvidenceDraftInput({
    run: {
      ...run,
      photoStoragePath: "photos/explicit.jpg",
      photoFilename: "explicit.jpg",
    },
    photo,
    detection,
  });

  assert.equal(input.run.photoStoragePath, "photos/explicit.jpg");
  assert.equal(input.run.photoFilename, "explicit.jpg");
  assert.equal(input.ocr, null);
  assert.equal(input.productText, null);
  assert.equal(input.parsedPrice, null);
});
