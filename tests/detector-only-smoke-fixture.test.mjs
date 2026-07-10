import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-smoke-fixture-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-smoke-fixture-test", { recursive: true });
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
  ".tmp/detector-only-smoke-fixture-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const {
  handleDetectorOnlyApiRequest,
} = require("../.tmp/detector-only-smoke-fixture-test/price-capture/detector-only-api-boundary.js");

after(() => {
  rmSync(".tmp/detector-only-smoke-fixture-test", { recursive: true, force: true });
});

test("smoke processes synthetic encoded PNG through sharp decode, heuristic detector, and report DTO", async () => {
  const png = await createSyntheticShelfPng();

  const response = await handleDetectorOnlyApiRequest({
    companyId: "company-smoke",
    storeId: "store-smoke",
    week: 1,
    runId: "run-smoke-1",
    capturedDate: "2026-07-10",
    photo: {
      bytes: new Uint8Array(png),
      filename: "synthetic-shelf.png",
      contentType: "image/png",
      storagePath: "photos/synthetic-shelf.png",
    },
    evidence: {
      cropExtension: "png",
      cropPadding: { pixels: 1 },
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.report.schemaVersion, "detector-only-report-v1");
  assert.equal(response.report.run.runId, "run-smoke-1");
  assert.equal(response.report.run.companyId, "company-smoke");
  assert.equal(response.report.run.storeId, "store-smoke");
  assert.equal(response.report.summary.status, "completed");
  assert.equal(response.report.summary.statusReason, "ok");
  assert.equal(response.report.summary.decodeFailed, false);
  assert.equal(response.report.summary.detectExecuted, true);
  assert.equal(response.report.summary.aiUsedCount, 0);
  assert.equal(response.report.summary.aiCostMicrousd, 0);
  assert.equal(response.report.summary.decoderProvider, "sharp");
  assert.equal(response.report.summary.detectorProvider, "local");
  assert.ok(response.report.summary.detectedCount >= 1);
  assert.ok(response.report.summary.draftCount >= 1);
  assert.equal(response.report.summary.needsReviewCount, response.report.summary.draftCount);

  const firstDetection = response.report.detections[0];
  assert.equal(firstDetection.label, "price_tag");
  assert.equal(firstDetection.provider, "local");
  assert.ok(firstDetection.confidence > 0);
  assert.ok(firstDetection.bbox.width >= 12);
  assert.ok(firstDetection.bbox.height >= 8);

  const firstDraft = response.report.drafts[0];
  assert.equal(firstDraft.review.status, "pending");
  assert.equal(firstDraft.ai.used, false);
  assert.equal(firstDraft.product.rawName, "unknown");
  assert.match(firstDraft.crop.storagePath, /^evidence\/company-smoke\/runs\/run-smoke-1\/crops\/det-heuristic-tag-\d+\.png$/);
  assert.ok(firstDraft.crop.width >= firstDetection.bbox.width);
  assert.ok(firstDraft.crop.height >= firstDetection.bbox.height);

  assert.deepEqual(response.report.steps.map((step) => step.step), ["decode_image", "detect"]);
  assert.equal(JSON.stringify(response.report).includes("bytes"), false);
});

async function createSyntheticShelfPng() {
  const svg = `
    <svg width="160" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect x="12" y="18" width="54" height="20" fill="#ffffff"/>
      <rect x="92" y="58" width="46" height="18" fill="#ffffff"/>
    </svg>
  `;

  return sharp({
    create: {
      width: 160,
      height: 100,
      channels: 3,
      background: { r: 16, g: 16, b: 16 },
    },
  })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
