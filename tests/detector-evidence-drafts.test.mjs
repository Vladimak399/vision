import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-evidence-drafts-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-evidence-drafts-test", { recursive: true });
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
  "--outDir",
  ".tmp/detector-evidence-drafts-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  buildEvidenceDraftsFromDetectorRun,
} = require("../.tmp/detector-evidence-drafts-test/price-capture/detector-evidence-drafts.js");

after(() => {
  rmSync(".tmp/detector-evidence-drafts-test", { recursive: true, force: true });
});

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
  photoStoragePath: "photos/shelf.jpg",
  photoFilename: "shelf.jpg",
  capturedDate: "2026-07-10",
};

function detection(id, bbox, confidence = 0.82) {
  return {
    id,
    bbox,
    confidence,
    provider: "local",
    model: "heuristic-price-tag-v1",
    label: "price_tag",
  };
}

function runResult({ detections, decodedImage = decodedImageFixture(), decodeFailed = false }) {
  return {
    run,
    detections,
    pipeline: {
      detections,
      decodedImage,
      detectorResult: decodedImage
        ? {
            detections,
            provider: { provider: "local", model: "heuristic-price-tag-v1" },
            diagnostics: { reason: "ok" },
          }
        : null,
      decodeError: decodeFailed ? { code: "decode_failed", message: "mock failure" } : null,
      steps: decodedImage
        ? [
            { step: "decode_image", status: "completed", durationMs: 1 },
            { step: "detect", status: "completed", durationMs: 1 },
          ]
        : [{ step: "decode_image", status: "failed", durationMs: 1 }],
      diagnostics: {
        decoderProvider: "test-decoder",
        decoderModel: "test-decoder-v1",
        detectorProvider: "local",
        detectorModel: "heuristic-price-tag-v1",
      },
    },
    metrics: {
      status: decodeFailed ? "failed" : "completed",
      detectedCount: detections.length,
      decodeFailed,
      detectExecuted: Boolean(decodedImage),
      durationMs: 2,
      aiUsedCount: 0,
      aiCostMicrousd: 0,
      decoderProvider: "test-decoder",
      decoderModel: "test-decoder-v1",
      detectorProvider: "local",
      detectorModel: "heuristic-price-tag-v1",
    },
    steps: decodedImage
      ? [
          { step: "decode_image", status: "completed", durationMs: 1 },
          { step: "detect", status: "completed", durationMs: 1 },
        ]
      : [{ step: "decode_image", status: "failed", durationMs: 1 }],
  };
}

function decodedImageFixture() {
  return {
    bytes: new Uint8Array(200 * 100),
    dimensions: { width: 200, height: 100 },
    pixelFormat: "grayscale",
    filename: "shelf.jpg",
    contentType: "application/x-pricevision-raw-grayscale",
    storagePath: "photos/shelf.jpg",
    decoderProvider: "test-decoder",
    decoderModel: "test-decoder-v1",
  };
}

test("builds evidence drafts from detector run detections", () => {
  const result = buildEvidenceDraftsFromDetectorRun(runResult({
    detections: [
      detection("tag-1", { x: 10, y: 12, width: 40, height: 18 }),
      detection("tag-2", { x: 80, y: 20, width: 50, height: 22 }, 1.4),
    ],
  }), {
    cropPadding: { x: 2, y: 3 },
    cropExtension: "webp",
  });

  assert.equal(result.drafts.length, 2);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.metrics, {
    detectedCount: 2,
    draftCount: 2,
    skippedCount: 0,
    imageAvailable: true,
    decodeFailed: false,
  });

  const first = result.drafts[0];
  assert.equal(first.itemId, "det-tag-1");
  assert.equal(first.row.company_id, "company-1");
  assert.equal(first.row.processing_run_id, "run-1");
  assert.equal(first.row.raw_name, "unknown");
  assert.equal(first.row.detector_provider, "local");
  assert.equal(first.row.detector_model, "heuristic-price-tag-v1");
  assert.equal(first.row.detector_confidence, 0.82);
  assert.equal(first.row.review_status, "pending");
  assert.equal(first.row.ai_used, false);
  assert.equal(first.row.photo_storage_path, "photos/shelf.jpg");
  assert.equal(first.row.photo_filename, "shelf.jpg");
  assert.equal(first.row.crop_width, 44);
  assert.equal(first.row.crop_height, 24);
  assert.match(first.row.crop_storage_path, /price-capture-evidence\/company-1\/run-1\/det-tag-1\//);
  assert.match(first.row.crop_storage_path, /\.webp$/);

  assert.equal(result.drafts[1].row.detector_confidence, 1);
});

test("skips detections that cannot produce a valid crop", () => {
  const result = buildEvidenceDraftsFromDetectorRun(runResult({
    detections: [
      detection("valid", { x: 10, y: 12, width: 40, height: 18 }),
      detection("invalid", { x: 250, y: 20, width: 50, height: 22 }),
    ],
  }));

  assert.equal(result.drafts.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].itemId, "det-invalid");
  assert.equal(result.skipped[0].reason, "invalid_crop");
  assert.deepEqual(result.metrics, {
    detectedCount: 2,
    draftCount: 1,
    skippedCount: 1,
    imageAvailable: true,
    decodeFailed: false,
  });
});

test("skips all detections when decoded image is unavailable", () => {
  const result = buildEvidenceDraftsFromDetectorRun(runResult({
    detections: [detection("tag-1", { x: 10, y: 12, width: 40, height: 18 })],
    decodedImage: null,
    decodeFailed: true,
  }));

  assert.deepEqual(result.drafts, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "missing_decoded_image");
  assert.deepEqual(result.metrics, {
    detectedCount: 1,
    draftCount: 0,
    skippedCount: 1,
    imageAvailable: false,
    decodeFailed: true,
  });
});

test("sanitizes unsafe detection ids before using them in evidence crop paths", () => {
  const result = buildEvidenceDraftsFromDetectorRun(runResult({
    detections: [detection("../bad tag", { x: 10, y: 12, width: 40, height: 18 })],
  }), {
    itemIdPrefix: " price tag ",
  });

  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].itemId, "price-tag-bad-tag");
  assert.doesNotMatch(result.drafts[0].row.crop_storage_path, /\.\./);
  assert.match(result.drafts[0].row.crop_storage_path, /price-tag-bad-tag/);
});
