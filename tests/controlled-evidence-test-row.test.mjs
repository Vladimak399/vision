import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { test } from "node:test";

const outDir = ".tmp/controlled-evidence-test-row-test";

function compile() {
  mkdirSync(outDir, { recursive: true });
  execFileSync("npx", [
    "tsc",
    "server/price-capture/crop-generator.ts",
    "server/price-capture/evidence-contract.ts",
    "server/price-capture/evidence-persistence.ts",
    "server/price-capture/controlled-evidence-test-row.ts",
    "scripts/controlled-evidence-test-row.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--skipLibCheck",
  ], { stdio: "inherit" });
}

compile();

const controlled = await import(`../${outDir}/server/price-capture/controlled-evidence-test-row.js`);

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-07-10T13:30:00.000Z";

test("buildControlledEvidenceTestRowPlan builds linked run and evidence payloads", () => {
  const plan = controlled.buildControlledEvidenceTestRowPlan({
    companyId: COMPANY_ID,
    storeId: STORE_ID,
    runId: RUN_ID,
    marker: "manual-check",
    nowIso: NOW,
    capturedDate: "2026-07-10",
    week: 2,
  });

  assert.equal(plan.marker, "PV_CONTROLLED_EVIDENCE_TEST_ROW_manual-check");
  assert.equal(plan.priceCaptureRunPayload.id, RUN_ID);
  assert.equal(plan.priceCaptureRunPayload.company_id, COMPANY_ID);
  assert.equal(plan.priceCaptureRunPayload.store_id, STORE_ID);
  assert.equal(plan.priceCaptureRunPayload.week, 2);
  assert.equal(plan.priceCaptureRunPayload.detected_count, 1);
  assert.equal(plan.priceCaptureRunPayload.status, "completed");

  assert.equal(plan.evidencePayload.company_id, COMPANY_ID);
  assert.equal(plan.evidencePayload.store_id, STORE_ID);
  assert.equal(plan.evidencePayload.processing_run_id, RUN_ID);
  assert.equal(plan.evidencePayload.price_minor, 12345);
  assert.equal(plan.evidencePayload.catalog_product_id, null);
  assert.equal(plan.evidencePayload.review_reason, "controlled_test_row_do_not_use_for_reports");
  assert.ok(plan.evidencePayload.raw_name.startsWith(plan.marker));
  assert.ok(plan.evidencePayload.ocr_text.includes(plan.marker));
});

test("buildControlledEvidenceTestRowPlan returns cleanup selector in safe order", () => {
  const plan = controlled.buildControlledEvidenceTestRowPlan({
    companyId: COMPANY_ID,
    storeId: STORE_ID,
    runId: RUN_ID,
    marker: "cleanup-check",
    nowIso: NOW,
  });

  assert.deepEqual(plan.cleanup.tablesInOrder, ["competitor_shelf_items", "price_capture_runs"]);
  assert.equal(plan.cleanup.evidenceWhere.processing_run_id, RUN_ID);
  assert.equal(plan.cleanup.evidenceWhere.raw_name_starts_with, plan.marker);
  assert.equal(plan.cleanup.runWhere.id, RUN_ID);
  assert.equal(plan.cleanup.runWhere.photo_filename, `${plan.marker}.jpg`);
});

test("buildControlledEvidenceTestRowPlan rejects non UUID company/store/run IDs", () => {
  assert.throws(
    () => controlled.buildControlledEvidenceTestRowPlan({
      companyId: "company-1",
      storeId: STORE_ID,
      nowIso: NOW,
    }),
    /companyId must be a UUID/,
  );

  assert.throws(
    () => controlled.buildControlledEvidenceTestRowPlan({
      companyId: COMPANY_ID,
      storeId: "store-1",
      nowIso: NOW,
    }),
    /storeId must be a UUID/,
  );

  assert.throws(
    () => controlled.buildControlledEvidenceTestRowPlan({
      companyId: COMPANY_ID,
      storeId: STORE_ID,
      runId: "run-1",
      nowIso: NOW,
    }),
    /runId must be a UUID/,
  );
});
