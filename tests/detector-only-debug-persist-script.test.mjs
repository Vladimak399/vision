import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, ".tmp", "detector-debug-persist-test");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  execFileSync(
    "npx",
    [
      "tsc",
      "scripts/detector-only-debug-persist.ts",
      "scripts/detector-only-debug-match.ts",
      "scripts/detector-only-debug.ts",
      "server/catalog-matching.ts",
      "server/price-capture/crop-generator.ts",
      "server/price-capture/evidence-contract.ts",
      "server/price-capture/local-pipeline.ts",
      "server/price-capture/evidence-persistence.ts",
      "server/price-capture/local-product-matcher.ts",
      "server/price-capture/debug-product-match-runner.ts",
      "server/price-capture/debug-match-catalog.ts",
      "server/price-capture/detector-only-api-boundary.ts",
      "server/price-capture/detector-only-orchestrator.ts",
      "server/price-capture/detector-only-report.ts",
      "server/price-capture/detector-run-service.ts",
      "server/price-capture/detector-evidence-drafts.ts",
      "server/price-capture/decoded-detector-pipeline.ts",
      "server/price-capture/sharp-image-decoder.ts",
      "server/price-capture/image-decoder.ts",
      "server/price-capture/heuristic-price-tag-detector.ts",
      "server/price-capture/local-ocr.ts",
      "server/price-capture/external-ocr-worker.ts",
      "server/price-capture/http-ocr-worker-client.ts",
      "server/price-capture/ocr-crop.ts",
      "server/price-capture/ocr-evidence.ts",
      "server/price-capture/local-price-parser.ts",
      "server/price-capture/price-evidence.ts",
      "server/price-capture/local-product-text-extractor.ts",
      "server/price-capture/product-text-evidence.ts",
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );

  return import(path.join(outDir, "scripts", "detector-only-debug-persist.js"));
}

function mockDebugResponse() {
  return {
    ok: true,
    statusCode: 200,
    report: {
      run: {
        companyId: "company-1",
        storeId: "store-1",
        week: 1,
        runId: "run-1",
        photoStoragePath: "photo.jpg",
        photoFilename: "photo.jpg",
        capturedDate: "2026-07-10",
      },
      drafts: [
        {
          itemId: "item-1",
          bbox: { x: 1, y: 2, width: 40, height: 20 },
          crop: {
            storagePath: "evidence/company-1/runs/run-1/crops/item-1.jpg",
            width: 40,
            height: 20,
          },
          detector: {
            provider: "local",
            model: "heuristic-price-tag-v1",
            confidence: 0.91,
          },
          review: {
            status: "pending",
            reason: "awaiting_local_ocr_or_match",
          },
          ai: { used: false },
          product: {
            rawName: "Кофе Жокей Традиционный 250 г",
            normalizedProductText: "кофе жокей традиционный 250 г",
            productVisibleText: "Кофе Жокей Традиционный 250 г",
            brand: null,
            sizeText: "250 г",
            priceMinor: 9990,
            oldPriceMinor: 12990,
            promoPriceMinor: 9990,
            parsedPriceConfidence: 0.88,
            currency: "RUB",
          },
          ocr: {
            provider: "mock-worker",
            model: "mock-ocr-worker-v1",
            text: "Кофе Жокей Традиционный 250 г\nАкция 99,90",
            confidence: 0.9,
          },
        },
      ],
    },
    match: {
      catalogSource: "debug-built-in-catalog-v1",
      metrics: {
        inputDraftCount: 1,
        catalogSize: 1,
        matchedCount: 1,
        selectedCount: 1,
        needsReviewCount: 0,
        noCandidateCount: 0,
      },
      items: [
        {
          itemId: "item-1",
          selectedCatalogProductId: "debug-coffee-jockey-traditional-250g",
          matchConfidence: 0.94,
          matchReason: "name_tokens|size",
          reviewRequired: false,
          candidates: [],
        },
      ],
    },
  };
}

test("appends persistence dry-run section to debug JSON", async () => {
  const mod = await compile();
  const json = mod.appendPersistenceDryRunToDebugJson(JSON.stringify(mockDebugResponse()), {
    pretty: false,
    env: { PRICEVISION_EVIDENCE_PERSISTENCE_MODE: "dry_run" },
  });
  const response = JSON.parse(json);

  assert.equal(response.persistence.mode, "dry_run");
  assert.equal(response.persistence.writeEnabled, false);
  assert.equal(response.persistence.guard.writeEnabled, false);
  assert.equal(response.persistence.guard.configuredMode, "dry_run");
  assert.equal(response.persistence.metrics.insertPayloadCount, 1);
  assert.equal(response.persistence.metrics.matchedCount, 1);
  assert.equal(response.persistence.items[0].payload.catalog_product_id, "debug-coffee-jockey-traditional-250g");
  assert.equal(response.persistence.items[0].payload.match_confidence, 0.94);
  assert.equal(response.persistence.items[0].payload.matched_at, null);
  assert.equal(response.persistence.items[0].payload.price_minor, 9990);
});

test("blocks non-dry-run persistence mode through env guard", async () => {
  const mod = await compile();
  const guard = mod.resolveDetectorOnlyPersistenceGuard({
    PRICEVISION_EVIDENCE_PERSISTENCE_MODE: "write",
  });

  assert.equal(guard.writeEnabled, false);
  assert.equal(guard.envVar, "PRICEVISION_EVIDENCE_PERSISTENCE_MODE");
  assert.equal(guard.configuredMode, "write");
  assert.match(guard.message, /blocked/);
});

test("converts report draft to evidence draft", async () => {
  const mod = await compile();
  const response = mockDebugResponse();
  const context = mod.reportRunToContext(response.report.run);
  const draft = mod.reportDraftToEvidenceDraft(context, response.report.drafts[0]);

  assert.equal(draft.itemId, "item-1");
  assert.equal(draft.row.company_id, "company-1");
  assert.equal(draft.row.crop_storage_path, "evidence/company-1/runs/run-1/crops/item-1.jpg");
  assert.equal(draft.row.ocr_text, "Кофе Жокей Традиционный 250 г\nАкция 99,90");
  assert.equal(draft.row.price_minor, 9990);
  assert.equal(draft.row.review_status, "pending");
});
