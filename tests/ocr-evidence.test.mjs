import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/ocr-evidence-test", { recursive: true, force: true });
mkdirSync(".tmp/ocr-evidence-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-ocr.ts",
  "server/price-capture/ocr-crop.ts",
  "server/price-capture/ocr-evidence.ts",
  "--outDir",
  ".tmp/ocr-evidence-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { buildLocalOcrResult } = require("../.tmp/ocr-evidence-test/price-capture/local-ocr.js");
const {
  mergeLocalOcrRunIntoEvidenceDrafts,
  mergeOcrResultIntoEvidenceDraft,
} = require("../.tmp/ocr-evidence-test/price-capture/ocr-evidence.js");

after(() => {
  rmSync(".tmp/ocr-evidence-test", { recursive: true, force: true });
});

function draft(overrides = {}) {
  return {
    itemId: overrides.itemId ?? "det-tag-1",
    cropPlan: {
      bbox: { x: 1, y: 2, width: 30, height: 12 },
      cropWidth: 30,
      cropHeight: 12,
      paddingPx: 0,
      wasClamped: false,
    },
    row: {
      raw_name: "unknown",
      price_tag_text: null,
      ocr_provider: null,
      ocr_model: null,
      ocr_text: null,
      ocr_confidence: null,
      ...overrides.row,
    },
    ...overrides,
  };
}

function ocr(overrides = {}) {
  return buildLocalOcrResult({
    provider: { provider: "test-ocr", model: "test-ocr-v1" },
    text: "  Цена 129 90 ",
    confidence: 1.4,
    ...overrides,
  });
}

test("merges OCR provider, text, and confidence into evidence draft row", () => {
  const merged = mergeOcrResultIntoEvidenceDraft(draft(), ocr());

  assert.equal(merged.itemId, "det-tag-1");
  assert.equal(merged.row.ocr_provider, "test-ocr");
  assert.equal(merged.row.ocr_model, "test-ocr-v1");
  assert.equal(merged.row.ocr_text, "Цена 129 90");
  assert.equal(merged.row.ocr_confidence, 1);
  assert.equal(merged.row.raw_name, "Цена 129 90");
  assert.equal(merged.row.price_tag_text, "Цена 129 90");
});

test("does not overwrite known raw_name or existing price_tag_text unless fields are empty", () => {
  const merged = mergeOcrResultIntoEvidenceDraft(
    draft({
      row: {
        raw_name: "Known product",
        price_tag_text: "Existing tag",
      },
    }),
    ocr({ text: "OCR product" }),
  );

  assert.equal(merged.row.raw_name, "Known product");
  assert.equal(merged.row.price_tag_text, "Existing tag");
  assert.equal(merged.row.ocr_text, "OCR product");
});

test("can keep raw_name unchanged when update option is disabled", () => {
  const merged = mergeOcrResultIntoEvidenceDraft(
    draft(),
    ocr({ text: "OCR product" }),
    { updateUnknownRawName: false, fillPriceTagText: false },
  );

  assert.equal(merged.row.raw_name, "unknown");
  assert.equal(merged.row.price_tag_text, null);
  assert.equal(merged.row.ocr_text, "OCR product");
});

test("merges local OCR run results into matching drafts and preserves unmatched drafts", () => {
  const drafts = [draft({ itemId: "det-tag-1" }), draft({ itemId: "det-tag-2" })];
  const ocrRun = {
    items: [
      {
        itemId: "det-tag-1",
        ocr: ocr({ text: "Milk 99 90", confidence: 0.6 }),
      },
    ],
    skipped: [{ itemId: "det-tag-3", reason: "invalid_crop" }],
    metrics: {
      itemCount: 3,
      processedCount: 1,
      textResultCount: 1,
      emptyResultCount: 0,
      skippedCount: 1,
      failedCount: 0,
    },
  };

  const result = mergeLocalOcrRunIntoEvidenceDrafts({ drafts, ocrRun });

  assert.equal(result.drafts.length, 2);
  assert.equal(result.drafts[0].row.ocr_text, "Milk 99 90");
  assert.equal(result.drafts[1].row.ocr_text, null);
  assert.deepEqual(result.metrics, {
    inputDraftCount: 2,
    mergedDraftCount: 1,
    ocrProcessedCount: 1,
    ocrTextResultCount: 1,
    ocrEmptyResultCount: 0,
    ocrSkippedCount: 1,
    ocrFailedCount: 0,
  });
});
