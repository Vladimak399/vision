import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-api-boundary-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-api-boundary-test", { recursive: true });
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
  "--outDir",
  ".tmp/detector-only-api-boundary-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  handleDetectorOnlyApiRequest,
  buildDetectorOnlyApiSuccessResponse,
} = require("../.tmp/detector-only-api-boundary-test/price-capture/detector-only-api-boundary.js");

after(() => {
  rmSync(".tmp/detector-only-api-boundary-test", { recursive: true, force: true });
});

function request(overrides = {}) {
  return {
    companyId: " company-1 ",
    storeId: " store-1 ",
    week: 1,
    runId: " run-1 ",
    capturedDate: " 2026-07-10 ",
    photo: {
      bytes: new Uint8Array([1, 2, 3]),
      filename: " shelf.jpg ",
      contentType: " IMAGE/JPEG ",
      storagePath: " photos/shelf.jpg ",
    },
    ...overrides,
  };
}

function processingResult({ runId = "run-1", detectedCount = 1, draftCount = 1, skipped = [] } = {}) {
  const detections = detectedCount > 0
    ? [
        {
          id: "tag-1",
          label: "price_tag",
          bbox: { x: 10, y: 12, width: 40, height: 18 },
          confidence: 0.8,
          provider: "mock-detector",
          model: "mock-detector-v1",
        },
      ]
    : [];

  const drafts = draftCount > 0
    ? [
        {
          itemId: "det-tag-1",
          row: {
            bbox: { x: 8, y: 10, width: 44, height: 22 },
            crop_storage_path: "evidence/company-1/runs/run-1/crops/det-tag-1.jpg",
            crop_width: 44,
            crop_height: 22,
            detector_provider: "mock-detector",
            detector_model: "mock-detector-v1",
            detector_confidence: 0.8,
            review_status: "pending",
            review_reason: "awaiting_local_ocr_or_match",
            ai_used: false,
            raw_name: "unknown",
            normalized_product_text: null,
            price_minor: null,
            currency: "RUB",
          },
        },
      ]
    : [];

  return {
    run: {
      companyId: "company-1",
      storeId: "store-1",
      week: 1,
      runId,
      photoStoragePath: "photos/shelf.jpg",
      photoFilename: "shelf.jpg",
      capturedDate: "2026-07-10",
    },
    detectorRun: {
      detections,
      steps: [
        { step: "decode_image", status: "completed", durationMs: 3 },
        { step: "detect", status: "completed", durationMs: 5 },
      ],
      metrics: {
        status: "completed",
        detectedCount,
        decodeFailed: false,
        detectExecuted: true,
        durationMs: 8,
        aiUsedCount: 0,
        aiCostMicrousd: 0,
        decoderProvider: "mock-decoder",
        decoderModel: "mock-decoder-v1",
        detectorProvider: "mock-detector",
        detectorModel: "mock-detector-v1",
      },
    },
    evidence: {
      drafts,
      skipped,
      metrics: {
        detectedCount,
        draftCount,
        skippedCount: skipped.length,
        imageAvailable: true,
        decodeFailed: false,
      },
    },
    drafts,
    skipped,
    summary: {
      status: "completed",
      detectedCount,
      draftCount,
      skippedCount: skipped.length,
      needsReviewCount: draftCount,
      decodeFailed: false,
      detectExecuted: true,
      imageAvailable: true,
      durationMs: 8,
      aiUsedCount: 0,
      aiCostMicrousd: 0,
      decoderProvider: "mock-decoder",
      decoderModel: "mock-decoder-v1",
      detectorProvider: "mock-detector",
      detectorModel: "mock-detector-v1",
    },
  };
}

function mockProcessor(assertInput) {
  return {
    async process(input) {
      assertInput?.(input);
      return processingResult({ runId: input.context.runId });
    },
  };
}

test("handles detector-only API request and returns report DTO", async () => {
  const response = await handleDetectorOnlyApiRequest(request(), {
    processor: mockProcessor((input) => {
      assert.deepEqual(input.context, {
        companyId: "company-1",
        storeId: "store-1",
        week: 1,
        runId: "run-1",
        capturedDate: "2026-07-10",
        photoFilename: "shelf.jpg",
        photoStoragePath: "photos/shelf.jpg",
      });
      assert.deepEqual([...input.image.bytes], [1, 2, 3]);
      assert.equal(input.image.filename, "shelf.jpg");
      assert.equal(input.image.contentType, "image/jpeg");
      assert.equal(input.image.storagePath, "photos/shelf.jpg");
    }),
  });

  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.report.schemaVersion, "detector-only-report-v1");
  assert.equal(response.report.run.runId, "run-1");
  assert.equal(response.report.summary.statusReason, "ok");
  assert.equal(response.report.summary.aiUsedCount, 0);
  assert.equal(response.report.detections.length, 1);
  assert.equal(response.report.drafts.length, 1);
});

test("normalizes byte arrays and ArrayBuffer inputs", async () => {
  const byteArrayResponse = await handleDetectorOnlyApiRequest(request({
    photo: {
      bytes: [4, 5, 6],
      filename: "array.jpg",
      contentType: "image/jpeg",
    },
  }), {
    processor: mockProcessor((input) => {
      assert.deepEqual([...input.image.bytes], [4, 5, 6]);
    }),
  });

  assert.equal(byteArrayResponse.ok, true);

  const buffer = new Uint8Array([7, 8, 9]).buffer;
  const arrayBufferResponse = await handleDetectorOnlyApiRequest(request({
    photo: {
      bytes: buffer,
      filename: "buffer.jpg",
      contentType: "image/jpeg",
    },
  }), {
    processor: mockProcessor((input) => {
      assert.deepEqual([...input.image.bytes], [7, 8, 9]);
    }),
  });

  assert.equal(arrayBufferResponse.ok, true);
});

test("returns invalid context errors before processor execution", async () => {
  let called = false;
  const response = await handleDetectorOnlyApiRequest(request({ companyId: " ", week: 1 }), {
    processor: {
      async process() {
        called = true;
        throw new Error("should not run");
      },
    },
  });

  assert.equal(called, false);
  assert.equal(response.ok, false);
  assert.equal(response.statusCode, 400);
  assert.equal(response.error.code, "invalid_context");
  assert.equal(response.error.message, "companyId is required.");

  const invalidWeek = await handleDetectorOnlyApiRequest(request({ week: 3 }));
  assert.equal(invalidWeek.ok, false);
  assert.equal(invalidWeek.error.code, "invalid_context");
  assert.equal(invalidWeek.error.details.week, 3);
});

test("returns invalid photo errors for empty or unsafe bytes", async () => {
  const empty = await handleDetectorOnlyApiRequest(request({
    photo: { bytes: new Uint8Array([]), filename: "empty.jpg" },
  }));

  assert.equal(empty.ok, false);
  assert.equal(empty.statusCode, 422);
  assert.equal(empty.error.code, "invalid_photo");

  const unsafe = await handleDetectorOnlyApiRequest(request({
    photo: { bytes: [0, 256], filename: "bad.jpg" },
  }));

  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.statusCode, 422);
  assert.equal(unsafe.error.code, "invalid_photo");
});

test("returns processing_failed if processor throws", async () => {
  const response = await handleDetectorOnlyApiRequest(request(), {
    processor: {
      async process() {
        throw new Error("mock processor failure");
      },
    },
  });

  assert.equal(response.ok, false);
  assert.equal(response.statusCode, 500);
  assert.equal(response.error.code, "processing_failed");
  assert.equal(response.error.details.errorMessage, "mock processor failure");
});

test("builds success response from processing result", () => {
  const response = buildDetectorOnlyApiSuccessResponse(processingResult());

  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.report.schemaVersion, "detector-only-report-v1");
  assert.equal(response.report.summary.statusReason, "ok");
});
