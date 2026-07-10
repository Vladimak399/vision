import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-orchestrator-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-orchestrator-test", { recursive: true });
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
  "--outDir",
  ".tmp/detector-only-orchestrator-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  processDetectorOnlyPhoto,
  createSharpHeuristicDetectorOnlyProcessor,
  buildDetectorOnlySummary,
} = require("../.tmp/detector-only-orchestrator-test/price-capture/detector-only-orchestrator.js");

const context = {
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
          dimensions: { width: 200, height: 100 },
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

function detectorWith(detections) {
  return {
    provider: { provider: "test-detector", model: "test-detector-v1" },
    async detect(input) {
      assert.equal(input.run.runId, "run-1");
      assert.deepEqual(input.photo.dimensions, { width: 200, height: 100 });
      return {
        detections,
        provider: { provider: "test-detector", model: "test-detector-v1" },
        diagnostics: { reason: "ok" },
      };
    },
  };
}

function detection(id, bbox, confidence = 0.8) {
  return {
    id,
    bbox,
    confidence,
    provider: "test-detector",
    model: "test-detector-v1",
    label: "price_tag",
  };
}

after(() => {
  rmSync(".tmp/detector-only-orchestrator-test", { recursive: true, force: true });
});

test("runs detector-only processing and returns evidence drafts plus summary", async () => {
  const result = await processDetectorOnlyPhoto({
    context,
    image,
    decoder: successfulDecoder(),
    detector: detectorWith([
      detection("tag-1", { x: 10, y: 12, width: 40, height: 18 }),
      detection("tag-2", { x: 80, y: 20, width: 50, height: 22 }),
    ]),
    evidence: {
      cropPadding: { pixels: 2 },
      cropExtension: "webp",
    },
  });

  assert.equal(result.run.runId, "run-1");
  assert.equal(result.detectorRun.metrics.status, "completed");
  assert.equal(result.evidence.metrics.draftCount, 2);
  assert.equal(result.drafts.length, 2);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.drafts[0].row.processing_run_id, "run-1");
  assert.equal(result.drafts[0].row.review_status, "pending");
  assert.equal(result.drafts[0].row.ai_used, false);
  assert.match(result.drafts[0].row.crop_storage_path, /evidence\/company-1\/runs\/run-1\/crops\/det-tag-1\.webp$/);
  assert.deepEqual(result.summary, {
    status: "completed",
    detectedCount: 2,
    draftCount: 2,
    skippedCount: 0,
    needsReviewCount: 2,
    decodeFailed: false,
    detectExecuted: true,
    imageAvailable: true,
    durationMs: result.detectorRun.metrics.durationMs,
    aiUsedCount: 0,
    aiCostMicrousd: 0,
    decoderProvider: "test-decoder",
    decoderModel: "test-decoder-v1",
    detectorProvider: "test-detector",
    detectorModel: "test-detector-v1",
  });
});

test("returns failed summary and no drafts when decoding fails", async () => {
  const detector = {
    provider: { provider: "test-detector", model: "should-not-run" },
    async detect() {
      throw new Error("detector should not run after decode failure");
    },
  };

  const result = await processDetectorOnlyPhoto({
    context,
    image,
    decoder: failingDecoder(),
    detector,
  });

  assert.deepEqual(result.drafts, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.detectorRun.pipeline.decodeError.code, "decode_failed");
  assert.equal(result.summary.status, "failed");
  assert.equal(result.summary.detectedCount, 0);
  assert.equal(result.summary.draftCount, 0);
  assert.equal(result.summary.skippedCount, 0);
  assert.equal(result.summary.needsReviewCount, 0);
  assert.equal(result.summary.decodeFailed, true);
  assert.equal(result.summary.detectExecuted, false);
  assert.equal(result.summary.imageAvailable, false);
});

test("keeps completed status while reporting skipped invalid crops", async () => {
  const result = await processDetectorOnlyPhoto({
    context,
    image,
    decoder: successfulDecoder(),
    detector: detectorWith([
      detection("valid", { x: 10, y: 12, width: 40, height: 18 }),
      detection("invalid", { x: 300, y: 20, width: 50, height: 22 }),
    ]),
  });

  assert.equal(result.summary.status, "completed");
  assert.equal(result.summary.detectedCount, 2);
  assert.equal(result.summary.draftCount, 1);
  assert.equal(result.summary.skippedCount, 1);
  assert.equal(result.summary.needsReviewCount, 1);
  assert.equal(result.skipped[0].reason, "invalid_crop");
  assert.equal(result.skipped[0].itemId, "det-invalid");
});

test("builds summary from existing detector run and evidence results", () => {
  const summary = buildDetectorOnlySummary({
    metrics: {
      status: "completed",
      detectedCount: 3,
      decodeFailed: false,
      detectExecuted: true,
      durationMs: 12,
      aiUsedCount: 0,
      aiCostMicrousd: 0,
      decoderProvider: "decoder",
      decoderModel: "decoder-v1",
      detectorProvider: "detector",
      detectorModel: "detector-v1",
    },
  }, {
    metrics: {
      detectedCount: 3,
      draftCount: 2,
      skippedCount: 1,
      imageAvailable: true,
      decodeFailed: false,
    },
  });

  assert.deepEqual(summary, {
    status: "completed",
    detectedCount: 3,
    draftCount: 2,
    skippedCount: 1,
    needsReviewCount: 2,
    decodeFailed: false,
    detectExecuted: true,
    imageAvailable: true,
    durationMs: 12,
    aiUsedCount: 0,
    aiCostMicrousd: 0,
    decoderProvider: "decoder",
    decoderModel: "decoder-v1",
    detectorProvider: "detector",
    detectorModel: "detector-v1",
  });
});

test("creates sharp heuristic detector-only processor factory", () => {
  const processor = createSharpHeuristicDetectorOnlyProcessor({
    decoder: { pixelFormat: "rgba" },
    detector: { minWidthPx: 20 },
    evidence: { cropExtension: "webp" },
  });

  assert.equal(processor.decoder.provider, "sharp");
  assert.equal(processor.detector.provider.provider, "local");
  assert.equal(typeof processor.process, "function");
});
