import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/product-text-evidence-test", { recursive: true, force: true });
mkdirSync(".tmp/product-text-evidence-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/product-text-evidence.ts",
  "--outDir",
  ".tmp/product-text-evidence-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  mergeProductTextIntoEvidenceDraft,
  mergeProductTextsIntoEvidenceDrafts,
} = require("../.tmp/product-text-evidence-test/price-capture/product-text-evidence.js");

after(() => {
  rmSync(".tmp/product-text-evidence-test", { recursive: true, force: true });
});

function draft(overrides = {}) {
  return {
    itemId: overrides.itemId ?? "det-1",
    cropPlan: {},
    row: {
      raw_name: overrides.rawName ?? "unknown",
      brand: null,
      size_text: null,
      price_tag_text: null,
      product_visible_text: null,
      normalized_product_text: null,
      ...overrides.row,
    },
  };
}

test("merges product text into an unknown evidence draft", () => {
  const merged = mergeProductTextIntoEvidenceDraft(draft(), {
    rawName: "Кофе Жокей Традиционный 250 г",
    normalizedProductText: "кофе жокей традиционный 250 г",
    productVisibleText: "Кофе Жокей Традиционный 250 г",
    priceTagText: "Кофе Жокей Традиционный 250 г\nЦена 99 90",
    brand: "Жокей",
    sizeText: "250 г",
  });

  assert.equal(merged.row.raw_name, "Кофе Жокей Традиционный 250 г");
  assert.equal(merged.row.normalized_product_text, "кофе жокей традиционный 250 г");
  assert.equal(merged.row.product_visible_text, "Кофе Жокей Традиционный 250 г");
  assert.equal(merged.row.price_tag_text, "Кофе Жокей Традиционный 250 г\nЦена 99 90");
  assert.equal(merged.row.brand, "Жокей");
  assert.equal(merged.row.size_text, "250 г");
});

test("does not overwrite existing raw name when updateRawName is false", () => {
  const merged = mergeProductTextIntoEvidenceDraft(
    draft({ rawName: "Existing name" }),
    { rawName: "New name", normalizedProductText: "new name" },
    { updateRawName: false },
  );

  assert.equal(merged.row.raw_name, "Existing name");
  assert.equal(merged.row.normalized_product_text, "new name");
});

test("merges product text items by itemId and returns metrics", () => {
  const result = mergeProductTextsIntoEvidenceDrafts({
    drafts: [draft({ itemId: "det-1" }), draft({ itemId: "det-2" })],
    productTextItems: [
      {
        itemId: "det-1",
        productText: {
          rawName: "Макароны Щебекинские",
          normalizedProductText: "макароны щебекинские",
        },
      },
    ],
  });

  assert.equal(result.drafts[0].row.raw_name, "Макароны Щебекинские");
  assert.equal(result.drafts[1].row.raw_name, "unknown");
  assert.deepEqual(result.metrics, {
    inputDraftCount: 2,
    productTextItemCount: 1,
    mergedDraftCount: 1,
    namedDraftCount: 1,
    normalizedDraftCount: 1,
  });
});
