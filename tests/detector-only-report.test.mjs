import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-report-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-report-test", { recursive: true });
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
  "--outDir",
  ".tmp/detector-only-report-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  buildDetectorOnlyRunReport,
  serializeDetectorOnlyRunReport,
} = require("../.tmp/detector-only-report-test/price-capture/detector-only-report.js");

after(() => {
  rmSync(".tmp/detector-only-report-test", { recursive: true, force: true });
});

function baseProcessingResult(overrides = {}) {
  const detections = overrides.detections ?? [
    {
      id: " tag-1 ",
      label: " price_tag ",
      bbox: { x: 10, y: 12, width: 40, height: 18 },
      confidence: 1.4,
      provider: "test-detector",
      model: "test-detector-v1",
    },
  ];

  const drafts = overrides.drafts ?? [
    {
      itemId: "det-tag-1",
      row: {
        bbox: { x: 8, y: 10, width: 44, height: 22 },
        crop_storage_path: "evidence/company-1/runs/run-1/crops/det-tag-1.webp",
        crop_width: 44,
        crop_height: 22,
        detector_provider: "test-detector",
        detector_model: "test-detector-v1",
        detector_confidence: 0.9,
        review_status: "pending",
        review_reason: "awaiting_local_ocr_or_match",
        ai_used: false,
        raw_name: "unknown",
        normalized_product_text: null,
        price_minor: null,
        currency: "RUB",
      },
    },
  ];

  const skipped = overrides.skipped ?? [];
  const summary = {
    status: overrides.status ?? "completed",
    detectedCount: detections.length,
    draftCount: drafts.length,
    skippedCount: skipped.length,
    needsReviewCount: drafts.length,
    decodeFailed: overrides.decodeFailed ?? false,
    detectExecuted: overrides.detectExecuted ?? true,
    imageAvailable: overrides.imageAvailable ?? true,
    durationMs: 17,
    aiUsedCount: 0,
    aiCostMicrousd: 0,
    decoderProvider: "test-decoder",
    decoderModel: "test-decoder-v1",
    detectorProvider: "test-detector",
    detectorModel: "test-detector-v1",
    ...overrides.summary,
  };

  return {
    run: {
      companyId: "company-1",
      storeId: "store-1",
      week: 1,
      runId: "run-1",
      photoStoragePath: "photos/shelf.jpg",
      photoFilename: "shelf.jpg",
      capturedDate: "2026-07-10",
    },
    detectorRun: {
      detections,
      steps: overrides.steps ?? [
        { step: "decode_image", status: "completed", durationMs: 3 },
        { step: "detect", status: "completed", durationMs: 5, errorMessage: " " },
      ],
      pipeline: {
        decodedImage: {
          bytes: new Uint8Array([1, 2, 3]),
        },
      },
      metrics: summary,
    },
    evidence: {
      drafts,
      skipped,
      metrics: {
        detectedCount: detections.length,
        draftCount: drafts.length,
        skippedCount: skipped.length,
        imageAvailable: summary.imageAvailable,
        decodeFailed: summary.decodeFailed,
      },
    },
    drafts,
    skipped,
    summary,
  };
}

test("builds compact detector-only report DTO", () => {
  const report = buildDetectorOnlyRunReport(baseProcessingResult());

  assert.equal(report.schemaVersion, "detector-only-report-v1");
  assert.deepEqual(report.run, {
    companyId: "company-1",
    storeId: "store-1",
    week: 1,
    runId: "run-1",
    photoStoragePath: "photos/shelf.jpg",
    photoFilename: "shelf.jpg",
    capturedDate: "2026-07-10",
  });
  assert.equal(report.summary.statusReason, "ok");
  assert.equal(report.summary.aiUsedCount, 0);
  assert.equal(report.summary.aiCostMicrousd, 0);

  assert.deepEqual(report.detections, [
    {
      index: 0,
      id: "tag-1",
      label: "price_tag",
      bbox: { x: 10, y: 12, width: 40, height: 18 },
      confidence: 1,
      provider: "test-detector",
      model: "test-detector-v1",
    },
  ]);

  assert.deepEqual(report.drafts, [
    {
      index: 0,
      itemId: "det-tag-1",
      bbox: { x: 8, y: 10, width: 44, height: 22 },
      crop: {
        storagePath: "evidence/company-1/runs/run-1/crops/det-tag-1.webp",
        width: 44,
        height: 22,
      },
      detector: {
        provider: "test-detector",
        model: "test-detector-v1",
        confidence: 0.9,
      },
      review: {
        status: "pending",
        reason: "awaiting_local_ocr_or_match",
      },
      ai: {
        used: false,
      },
      product: {
        rawName: "unknown",
        normalizedProductText: null,
        priceMinor: null,
        currency: "RUB",
      },
    },
  ]);
  assert.deepEqual(report.skipped, []);
  assert.deepEqual(report.steps, [
    { index: 0, step: "decode_image", status: "completed", durationMs: 3, errorMessage: null },
    { index: 1, step: "detect", status: "completed", durationMs: 5, errorMessage: null },
  ]);
});

test("reports status reasons for decode failures, skipped crops, and empty detection runs", () => {
  const decodeFailed = buildDetectorOnlyRunReport(baseProcessingResult({
    status: "failed",
    decodeFailed: true,
    detectExecuted: false,
    imageAvailable: false,
    detections: [],
    drafts: [],
    summary: { detectedCount: 0, draftCount: 0, skippedCount: 0, needsReviewCount: 0 },
    steps: [{ step: "decode_image", status: "failed", durationMs: -4, errorMessage: "mock failure" }],
  }));

  assert.equal(decodeFailed.summary.statusReason, "decode_failed");
  assert.deepEqual(decodeFailed.steps, [
    { index: 0, step: "decode_image", status: "failed", durationMs: 0, errorMessage: "mock failure" },
  ]);

  const partial = buildDetectorOnlyRunReport(baseProcessingResult({
    skipped: [
      {
        detectionId: "bad",
        itemId: "det-bad",
        reason: "invalid_crop",
        bbox: { x: 300, y: 20, width: 40, height: 18 },
      },
    ],
  }));

  assert.equal(partial.summary.statusReason, "partial_invalid_crops");
  assert.equal(partial.skipped[0].reason, "invalid_crop");

  const empty = buildDetectorOnlyRunReport(baseProcessingResult({
    detections: [],
    drafts: [],
    summary: { detectedCount: 0, draftCount: 0, skippedCount: 0, needsReviewCount: 0 },
  }));

  assert.equal(empty.summary.statusReason, "no_detections");
});

test("serializes report without leaking decoded image bytes or full pipeline objects", () => {
  const json = serializeDetectorOnlyRunReport(baseProcessingResult());
  const parsed = JSON.parse(json);

  assert.equal(parsed.schemaVersion, "detector-only-report-v1");
  assert.equal(parsed.drafts.length, 1);
  assert.equal(parsed.detections.length, 1);
  assert.equal(parsed.detectorRun, undefined);
  assert.equal(parsed.pipeline, undefined);
  assert.equal(parsed.decodedImage, undefined);
  assert.equal(json.includes("bytes"), false);
});

test("normalizes blank detection ids and labels to null", () => {
  const report = buildDetectorOnlyRunReport(baseProcessingResult({
    detections: [
      {
        id: " ",
        label: " ",
        bbox: { x: 1, y: 2, width: 3, height: 4 },
        confidence: -0.5,
        provider: "detector",
        model: "detector-v1",
      },
    ],
    drafts: [],
    summary: { draftCount: 0, needsReviewCount: 0 },
  }));

  assert.equal(report.detections[0].id, null);
  assert.equal(report.detections[0].label, null);
  assert.equal(report.detections[0].confidence, 0);
});
