import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-run-service-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-run-service-test", { recursive: true });
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
  "--outDir",
  ".tmp/detector-run-service-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  runDetectorService,
  createDetectorRunContext,
} = require("../.tmp/detector-run-service-test/price-capture/detector-run-service.js");

const baseContext = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
  capturedDate: "2026-07-10",
};

const image = {
  bytes: new Uint8Array([1, 2, 3]),
  filename: "shelf.jpg",
  contentType: "image/jpeg",
  storagePath: "photos/shelf.jpg",
};

function successfulDecoder() {
  return {
    provider: "test-decoder",
    model: "test-decoder-v1",
    async decode(input) {
      return {
        image: {
          bytes: input.bytes,
          dimensions: { width: 100, height: 50 },
          pixelFormat: "grayscale",
          filename: input.filename ?? null,
          contentType: "application/x-pricevision-raw-grayscale",
          storagePath: input.storagePath ?? null,
          decoderProvider: "test-decoder",
          decoderModel: "test-decoder-v1",
          diagnostics: { source: "mock" },
        },
        error: null,
      };
    },
  };
}

function failingDecoder() {
  return {
    provider: "test-decoder",
    model: "test-decoder-v1",
    async decode(input) {
      return {
        image: null,
        error: {
          code: "decode_failed",
          message: "mock decode failed",
          diagnostics: { byteLength: input.bytes.byteLength },
        },
      };
    },
  };
}

function detectorWithDetections() {
  return {
    provider: { provider: "test-detector", model: "test-detector-v1" },
    async detect(input) {
      assert.equal(input.run.runId, "run-1");
      assert.deepEqual(input.photo.dimensions, { width: 100, height: 50 });
      return {
        detections: [
          {
            id: "det-1",
            bbox: { x: 10, y: 5, width: 40, height: 20 },
            confidence: 0.82,
            provider: "test-detector",
            model: "test-detector-v1",
            label: "price_tag",
          },
        ],
        provider: { provider: "test-detector", model: "test-detector-v1" },
        diagnostics: { reason: "ok" },
      };
    },
  };
}

after(() => {
  rmSync(".tmp/detector-run-service-test", { recursive: true, force: true });
});

test("creates normalized detector run context", () => {
  const context = createDetectorRunContext({
    companyId: "company-1",
    storeId: "store-1",
    week: 2,
    runId: " run-2 ",
    photoStoragePath: " photos/source.jpg ",
    photoFilename: " source.jpg ",
    capturedDate: " 2026-07-10 ",
  });

  assert.deepEqual(context, {
    companyId: "company-1",
    storeId: "store-1",
    week: 2,
    runId: "run-2",
    photoStoragePath: "photos/source.jpg",
    photoFilename: "source.jpg",
    capturedDate: "2026-07-10",
  });
});

test("runs decoder and detector and returns run-level metrics", async () => {
  const result = await runDetectorService({
    context: baseContext,
    image,
    decoder: successfulDecoder(),
    detector: detectorWithDetections(),
  });

  assert.equal(result.run.runId, "run-1");
  assert.equal(result.run.photoStoragePath, "photos/shelf.jpg");
  assert.equal(result.run.photoFilename, "shelf.jpg");
  assert.equal(result.detections.length, 1);
  assert.equal(result.metrics.status, "completed");
  assert.equal(result.metrics.detectedCount, 1);
  assert.equal(result.metrics.decodeFailed, false);
  assert.equal(result.metrics.detectExecuted, true);
  assert.equal(result.metrics.aiUsedCount, 0);
  assert.equal(result.metrics.aiCostMicrousd, 0);
  assert.equal(result.metrics.decoderProvider, "test-decoder");
  assert.equal(result.metrics.detectorProvider, "test-detector");
  assert.deepEqual(result.steps.map((step) => [step.step, step.status]), [
    ["decode_image", "completed"],
    ["detect", "completed"],
  ]);
});

test("uses explicit context photo metadata before image fallback", async () => {
  const result = await runDetectorService({
    context: {
      ...baseContext,
      photoStoragePath: "photos/explicit.jpg",
      photoFilename: "explicit.jpg",
    },
    image,
    decoder: successfulDecoder(),
    detector: detectorWithDetections(),
  });

  assert.equal(result.run.photoStoragePath, "photos/explicit.jpg");
  assert.equal(result.run.photoFilename, "explicit.jpg");
});

test("returns failed metrics and does not run detector after decode failure", async () => {
  const detector = {
    provider: { provider: "test-detector", model: "should-not-run" },
    async detect() {
      throw new Error("detector should not run");
    },
  };

  const result = await runDetectorService({
    context: baseContext,
    image,
    decoder: failingDecoder(),
    detector,
  });

  assert.deepEqual(result.detections, []);
  assert.equal(result.pipeline.detectorResult, null);
  assert.equal(result.metrics.status, "failed");
  assert.equal(result.metrics.detectedCount, 0);
  assert.equal(result.metrics.decodeFailed, true);
  assert.equal(result.metrics.detectExecuted, false);
  assert.equal(result.pipeline.decodeError.code, "decode_failed");
  assert.deepEqual(result.steps.map((step) => [step.step, step.status]), [
    ["decode_image", "failed"],
  ]);
});

test("generates a run id when missing or unsafe", () => {
  const generated = createDetectorRunContext({
    companyId: "company-1",
    storeId: "store-1",
    week: 1,
    runId: "../unsafe",
  });

  assert.match(generated.runId, /^[0-9a-f-]{36}$/i);
});
