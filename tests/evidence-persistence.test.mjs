import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function compileModules() {
  const outDir = await mkdtemp(join(tmpdir(), "pv-evidence-persistence-"));
  await execFileAsync("npx", [
    "tsc",
    "server/catalog-matching.ts",
    "server/price-capture/crop-generator.ts",
    "server/price-capture/evidence-contract.ts",
    "server/price-capture/local-pipeline.ts",
    "server/price-capture/evidence-persistence.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--target",
    "es2022",
    "--esModuleInterop",
    "--skipLibCheck",
  ]);

  try {
    return await import(join(outDir, "server/price-capture/evidence-persistence.js"));
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

function createDraft(overrides = {}) {
  const row = {
    company_id: "company-1",
    store_id: "store-1",
    week: 1,
    processing_run_id: "run-1",
    raw_name: "Кофе Жокей Традиционный 250 г",
    brand: null,
    size_text: "250 г",
    price_minor: 9990,
    old_price_minor: 12990,
    promo_price_minor: 9990,
    currency: "RUB",
    price_tag_text: "Кофе Жокей Традиционный 250 г\nАкция 99,90",
    product_visible_text: "Кофе Жокей Традиционный 250 г",
    confidence: 0.84,
    photo_storage_path: "photos/test.png",
    photo_filename: "test.png",
    captured_date: "2026-07-10",
    bbox: { x: 10, y: 20, width: 120, height: 60 },
    crop_storage_path: "evidence/company-1/runs/run-1/crops/item-1.png",
    crop_width: 120,
    crop_height: 60,
    detector_provider: "local",
    detector_model: "heuristic-price-tag-v1",
    detector_confidence: 0.84,
    ocr_provider: "mock-worker",
    ocr_model: "mock-ocr-v1",
    ocr_text: "Кофе Жокей Традиционный 250 г\nАкция 99,90",
    ocr_confidence: 0.91,
    parsed_price_confidence: 0.88,
    normalized_product_text: "кофе жокей традиционный 250 г",
    review_status: "pending",
    review_reason: "awaiting_local_ocr_or_match",
    ai_used: false,
    ...overrides,
  };

  return {
    itemId: overrides.itemId ?? "item-1",
    cropPlan: {
      bbox: row.bbox,
      cropWidth: row.crop_width,
      cropHeight: row.crop_height,
      paddingPx: 1,
      wasClamped: false,
    },
    row,
  };
}

const strongMatch = {
  candidates: [],
  selectedCatalogProductId: "catalog-coffee-jockey-250g",
  matchConfidence: 0.92345,
  matchReason: "name_tokens|size",
  reviewRequired: false,
};

const reviewMatch = {
  candidates: [],
  selectedCatalogProductId: null,
  matchConfidence: 0.41,
  matchReason: "low_confidence_review",
  reviewRequired: true,
};

test("builds competitor_shelf_items insert payload with match fields", async () => {
  const { buildCompetitorShelfItemInsertPayload } = await compileModules();
  const draft = createDraft();

  const payload = buildCompetitorShelfItemInsertPayload({
    draft,
    match: strongMatch,
    matchedAt: "2026-07-10T12:00:00.000Z",
  });

  assert.equal(payload.company_id, "company-1");
  assert.equal(payload.processing_run_id, "run-1");
  assert.equal(payload.raw_name, "Кофе Жокей Традиционный 250 г");
  assert.equal(payload.price_minor, 9990);
  assert.deepEqual(payload.bbox, { x: 10, y: 20, width: 120, height: 60 });
  assert.equal(payload.catalog_product_id, "catalog-coffee-jockey-250g");
  assert.equal(payload.match_confidence, 0.9235);
  assert.equal(payload.match_reason, "name_tokens|size");
  assert.equal(payload.matched_at, "2026-07-10T12:00:00.000Z");
  assert.equal(payload.review_status, "pending");
  assert.equal(payload.review_reason, "auto_matched");
  assert.equal(payload.ai_used, false);
});

test("keeps review-required matches as pending dry-run payloads", async () => {
  const { buildCompetitorShelfItemInsertPayload } = await compileModules();
  const draft = createDraft();

  const payload = buildCompetitorShelfItemInsertPayload({
    draft,
    match: reviewMatch,
    matchedAt: "2026-07-10T12:00:00.000Z",
  });

  assert.equal(payload.catalog_product_id, null);
  assert.equal(payload.match_confidence, 0.41);
  assert.equal(payload.match_reason, "low_confidence_review");
  assert.equal(payload.matched_at, null);
  assert.equal(payload.review_reason, "low_confidence_review");
});

test("builds dry-run persistence report with metrics and no writes", async () => {
  const { buildEvidencePersistenceDryRunReport } = await compileModules();
  const matchedDraft = createDraft();
  const reviewDraft = createDraft({
    itemId: "item-2",
    raw_name: "Неизвестный товар",
    normalized_product_text: "неизвестный товар",
    price_minor: null,
    old_price_minor: null,
    promo_price_minor: null,
    ocr_text: "Неизвестный товар",
  });

  const report = buildEvidencePersistenceDryRunReport({
    drafts: [matchedDraft, reviewDraft],
    matches: [
      { itemId: "item-1", match: strongMatch },
      { itemId: "item-2", match: reviewMatch },
    ],
    matchedAt: "2026-07-10T12:00:00.000Z",
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.table, "competitor_shelf_items");
  assert.equal(report.writeEnabled, false);
  assert.deepEqual(report.metrics, {
    inputDraftCount: 2,
    insertPayloadCount: 2,
    matchedCount: 1,
    needsReviewCount: 1,
    unmatchedCount: 1,
    pricedCount: 1,
    ocrTextCount: 2,
    aiUsedCount: 0,
  });
  assert.equal(report.items[0].operation, "insert");
  assert.equal(report.items[0].writeEnabled, false);
  assert.equal(report.items[0].catalogProductId, "catalog-coffee-jockey-250g");
  assert.equal(report.items[1].reviewRequired, true);
  assert.equal(report.items[1].payload.catalog_product_id, null);
});

test("exposes explicit no-write guard and dry-run writer", async () => {
  const { createDryRunEvidenceWriter, getEvidencePersistenceWriteGuard } = await compileModules();
  const draft = createDraft();

  const guard = getEvidencePersistenceWriteGuard();
  assert.equal(guard.writeEnabled, false);
  assert.equal(guard.reason, "persistence_dry_run_only");
  assert.match(guard.message, /dry-run/i);

  const writer = createDryRunEvidenceWriter();
  const result = await writer.write({
    run: {
      companyId: "company-1",
      storeId: "store-1",
      week: 1,
      runId: "run-1",
    },
    draft,
    match: strongMatch,
  });

  assert.equal(result.itemId, "item-1");
  assert.equal(result.rowId, null);
  assert.equal(result.cropStoragePath, draft.row.crop_storage_path);
  assert.equal(result.reviewRequired, false);
});
