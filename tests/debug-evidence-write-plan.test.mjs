import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { test } from "node:test";

const outDir = ".tmp/debug-evidence-write-plan-test";

function compile() {
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "tsc",
    "server/price-capture/debug-evidence-write-plan.ts",
    "scripts/detector-only-debug-write-plan.ts",
    "scripts/detector-only-debug-persist.ts",
    "scripts/detector-only-debug-match.ts",
    "scripts/detector-only-debug.ts",
    "server/price-capture/controlled-evidence-test-row.ts",
    "server/price-capture/evidence-persistence.ts",
    "server/price-capture/evidence-contract.ts",
    "server/price-capture/crop-generator.ts",
    "server/price-capture/local-pipeline.ts",
    "server/price-capture/local-product-matcher.ts",
    "server/price-capture/debug-product-match-runner.ts",
    "server/price-capture/debug-match-catalog.ts",
    "server/price-capture/detector-only-report.ts",
    "server/price-capture/detector-only-api-boundary.ts",
    "server/price-capture/detector-only-orchestrator.ts",
    "server/price-capture/detector-run-service.ts",
    "server/price-capture/detector-evidence-drafts.ts",
    "server/price-capture/decoded-detector-pipeline.ts",
    "server/price-capture/sharp-image-decoder.ts",
    "server/price-capture/image-decoder.ts",
    "server/price-capture/heuristic-price-tag-detector.ts",
    "server/price-capture/ocr-crop.ts",
    "server/price-capture/ocr-evidence.ts",
    "server/price-capture/local-ocr.ts",
    "server/price-capture/external-ocr-worker.ts",
    "server/price-capture/http-ocr-worker-client.ts",
    "server/price-capture/local-price-parser.ts",
    "server/price-capture/price-evidence.ts",
    "server/price-capture/local-product-text-extractor.ts",
    "server/price-capture/product-text-evidence.ts",
    "server/catalog-matching.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--esModuleInterop",
    "--skipLibCheck",
  ], { stdio: "inherit" });
}

compile();

const planModule = await import(`../${outDir}/server/price-capture/debug-evidence-write-plan.js`);
const scriptModule = await import(`../${outDir}/scripts/detector-only-debug-write-plan.js`);

const basePayload = {
  company_id: "25d44227-b1db-4ae1-b550-86ff9ac5a368",
  store_id: "30b2d36e-83fb-4030-b353-3f9da43e6abe",
  week: 1,
  processing_run_id: "f8054bec-377b-428d-871e-357ebb086960",
  raw_name: "Кофе тестовый 250 г",
  brand: "PV_TEST",
  size_text: "250 г",
  price_minor: 12345,
  old_price_minor: null,
  promo_price_minor: null,
  currency: "RUB",
  price_tag_text: "Кофе тестовый 250 г 123,45",
  product_visible_text: "Кофе тестовый 250 г",
  confidence: 0.9,
  photo_storage_path: "photos/test.jpg",
  photo_filename: "test.jpg",
  captured_date: "2026-07-10",
  bbox: { x: 1, y: 2, width: 3, height: 4 },
  crop_storage_path: "evidence/crop.jpg",
  crop_width: 100,
  crop_height: 40,
  detector_provider: "local",
  detector_model: "heuristic",
  detector_confidence: 0.9,
  ocr_provider: "mock",
  ocr_model: "mock",
  ocr_text: "Кофе тестовый 250 г 123,45",
  ocr_confidence: 0.8,
  parsed_price_confidence: 0.9,
  normalized_product_text: "кофе тестовый 250 г",
  review_status: "pending",
  review_reason: "awaiting_review",
  ai_used: false,
  catalog_product_id: null,
  match_confidence: null,
  match_reason: null,
  matched_at: null,
};

function payload(overrides = {}) {
  return { ...basePayload, ...overrides };
}

test("buildDebugEvidenceWritePlan defaults to one selected evidence payload", () => {
  const plan = planModule.buildDebugEvidenceWritePlan({
    evidencePayloads: [payload(), payload({ raw_name: "Чай тестовый" })],
    nowIso: "2026-07-10T12:00:00.000Z",
  });

  assert.equal(plan.mode, "dry_run_only");
  assert.equal(plan.writeEnabled, false);
  assert.equal(plan.selectedItemCount, 1);
  assert.equal(plan.totalAvailableItemCount, 2);
  assert.equal(plan.truncated, true);
  assert.equal(plan.priceCaptureRunPayload.id, basePayload.processing_run_id);
  assert.equal(plan.priceCaptureRunPayload.detected_count, 1);
  assert.equal(plan.evidencePayloads.length, 1);
});

test("buildDebugEvidenceWritePlan honors max items within safety cap", () => {
  const plan = planModule.buildDebugEvidenceWritePlan({
    evidencePayloads: [payload(), payload({ raw_name: "Чай тестовый" })],
    maxItems: 2,
    nowIso: "2026-07-10T12:00:00.000Z",
  });

  assert.equal(plan.selectedItemCount, 2);
  assert.equal(plan.truncated, false);
  assert.equal(plan.priceCaptureRunPayload.detected_count, 2);
  assert.equal(plan.priceCaptureRunPayload.parsed_price_count, 2);
});

test("buildDebugEvidenceWritePlan rejects mixed processing runs", () => {
  assert.throws(
    () => planModule.buildDebugEvidenceWritePlan({
      evidencePayloads: [payload(), payload({ processing_run_id: "0b244b14-2a8d-4d5c-9a61-0d878fbcd333" })],
    }),
    /same processing_run_id/,
  );
});

test("appendEvidenceWritePlanToDebugJson appends plan from persistence payloads", () => {
  const json = JSON.stringify({
    ok: true,
    persistence: {
      items: [
        { payload: payload() },
        { payload: payload({ raw_name: "Чай тестовый" }) },
      ],
    },
  });

  const output = JSON.parse(scriptModule.appendEvidenceWritePlanToDebugJson(json, {
    maxItems: 2,
    pretty: false,
    nowIso: "2026-07-10T12:00:00.000Z",
  }));

  assert.equal(output.evidenceWritePlan.mode, "dry_run_only");
  assert.equal(output.evidenceWritePlan.selectedItemCount, 2);
  assert.equal(output.evidenceWritePlan.tablesInOrder[0], "price_capture_runs");
  assert.equal(output.evidenceWritePlan.cleanup.tablesInOrder[0], "competitor_shelf_items");
});

test("parseDetectorOnlyDebugWritePlanArgs forces persistence and matching", () => {
  const parsed = scriptModule.parseDetectorOnlyDebugWritePlanArgs([
    "photo.jpg",
    "--max-items=2",
    "--compact",
  ]);

  assert.equal(parsed.maxItems, 2);
  assert.equal(parsed.pretty, false);
  assert.ok(parsed.argv.includes("--dry-run-persistence"));
  assert.ok(parsed.argv.includes("--match-product"));
});
