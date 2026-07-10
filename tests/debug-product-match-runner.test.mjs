import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/debug-product-match-runner-test", { recursive: true, force: true });
mkdirSync(".tmp/debug-product-match-runner-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-product-matcher.ts",
  "server/price-capture/debug-match-catalog.ts",
  "server/price-capture/debug-product-match-runner.ts",
  "--outDir",
  ".tmp/debug-product-match-runner-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { runDebugProductMatching } = require("../.tmp/debug-product-match-runner-test/price-capture/debug-product-match-runner.js");

const run = {
  companyId: "company-debug",
  storeId: "store-debug",
  week: 1,
  runId: "run-debug-match",
  capturedDate: "2026-07-10",
};

after(() => {
  rmSync(".tmp/debug-product-match-runner-test", { recursive: true, force: true });
});

test("matches extracted product text against built-in debug catalog", async () => {
  const result = await runDebugProductMatching({
    run,
    items: [{
      itemId: "item-1",
      productText: {
        rawName: "Кофе Жокей Традиционный 250 г",
        normalizedProductText: "кофе жокей традиционный 250 г",
        sizeText: "250 г",
      },
      parsedPrice: {
        priceMinor: 9990,
        currency: "RUB",
        confidence: 0.8,
      },
    }],
  });

  assert.equal(result.catalogSource, "built-in-debug-catalog-v1");
  assert.equal(result.provider.model, "catalog-fuzzy-matcher-v1");
  assert.equal(result.metrics.inputDraftCount, 1);
  assert.equal(result.metrics.matchedCount, 1);
  assert.equal(result.metrics.selectedCount, 1);
  assert.equal(result.metrics.needsReviewCount, 0);
  assert.equal(result.items[0].selectedCatalogProductId, "debug-coffee-jockey-traditional-250g");
  assert.equal(result.items[0].reviewRequired, false);
  assert.ok(result.items[0].candidates[0].score >= 0.82);
});

test("keeps unknown product text in review state", async () => {
  const result = await runDebugProductMatching({
    run,
    items: [{
      itemId: "item-unknown",
      productText: {
        rawName: "Непонятный товар без совпадения",
        normalizedProductText: "непонятный товар без совпадения",
      },
    }],
  });

  assert.equal(result.metrics.inputDraftCount, 1);
  assert.equal(result.metrics.selectedCount, 0);
  assert.equal(result.metrics.needsReviewCount, 1);
  assert.equal(result.items[0].selectedCatalogProductId, null);
  assert.equal(result.items[0].reviewRequired, true);
});
