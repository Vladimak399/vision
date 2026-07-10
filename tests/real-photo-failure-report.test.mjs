import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRealPhotoFailureReport,
  debugWritePlanJsonToPhotoSummary,
} from "../server/price-capture/real-photo-failure-report.ts";
import { parseRealPhotoFailureReportArgs } from "../scripts/real-photo-failure-report.ts";

test("buildRealPhotoFailureReport flags detector and OCR failures", () => {
  const report = buildRealPhotoFailureReport({
    photos: [
      { photo: "shelf-1.jpg", detectedCount: 0, draftCount: 0, evidenceWritePlanCount: 0 },
      { photo: "shelf-2.jpg", detectedCount: 2, draftCount: 2, ocrTextCount: 0, evidenceWritePlanCount: 2 },
    ],
  });

  assert.equal(report.schemaVersion, "real-photo-failure-report-v1");
  assert.equal(report.photoCount, 2);
  assert.ok(report.blockingCount >= 2);
  assert.ok(report.failures.some((failure) => failure.kind === "detector_no_detections"));
  assert.ok(report.failures.some((failure) => failure.kind === "ocr_empty"));
  assert.ok(report.nextActions.some((action) => action.includes("detector")));
});

test("buildRealPhotoFailureReport flags price, product text, and match warnings", () => {
  const report = buildRealPhotoFailureReport({
    photos: [
      {
        photo: "shelf-3.jpg",
        detectedCount: 3,
        draftCount: 3,
        ocrTextCount: 3,
        pricedCount: 0,
        namedCount: 0,
        matchedCount: 0,
        evidenceWritePlanCount: 1,
        matchItems: [
          {
            itemId: "item-1",
            selectedCatalogProductId: null,
            matchConfidence: 0.42,
            reviewRequired: true,
            matchReason: "weak_match_review",
          },
        ],
      },
    ],
    lowMatchConfidenceThreshold: 0.7,
  });

  assert.ok(report.failures.some((failure) => failure.kind === "price_not_parsed"));
  assert.ok(report.failures.some((failure) => failure.kind === "product_text_missing"));
  assert.ok(report.failures.some((failure) => failure.kind === "match_missing"));
  assert.ok(report.failures.some((failure) => failure.kind === "match_needs_review"));
  assert.ok(report.failures.some((failure) => failure.kind === "match_low_confidence"));
});

test("debugWritePlanJsonToPhotoSummary extracts key counters", () => {
  const summary = debugWritePlanJsonToPhotoSummary({
    photo: "photo-output.json",
    json: JSON.stringify({
      ok: true,
      report: {
        summary: {
          detectedCount: 2,
          draftCount: 2,
          ocr: { textCount: 1 },
          price: { pricedCount: 1 },
          productText: { namedCount: 1 },
        },
      },
      match: {
        metrics: { selectedCount: 1, needsReviewCount: 1 },
        items: [
          {
            itemId: "item-1",
            selectedCatalogProductId: "catalog-1",
            matchConfidence: 0.91,
            reviewRequired: false,
          },
        ],
      },
      evidenceWritePlan: {
        evidencePayloads: [{ raw_name: "Кофе" }],
      },
    }),
  });

  assert.equal(summary.detectedCount, 2);
  assert.equal(summary.ocrTextCount, 1);
  assert.equal(summary.pricedCount, 1);
  assert.equal(summary.matchedCount, 1);
  assert.equal(summary.evidenceWritePlanCount, 1);
  assert.equal(summary.matchItems?.[0]?.selectedCatalogProductId, "catalog-1");
});

test("parseRealPhotoFailureReportArgs parses files and thresholds", () => {
  const args = parseRealPhotoFailureReportArgs([
    "a.json",
    "b.json",
    "--min-detections",
    "3",
    "--low-match-threshold=0.8",
    "--compact",
  ]);

  assert.deepEqual(args.files, ["a.json", "b.json"]);
  assert.equal(args.expectedMinimumDetectionsPerPhoto, 3);
  assert.equal(args.lowMatchConfidenceThreshold, 0.8);
  assert.equal(args.compact, true);
});
