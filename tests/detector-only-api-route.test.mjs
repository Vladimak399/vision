import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/detector-only-api-route-test", { recursive: true, force: true });
mkdirSync(".tmp/detector-only-api-route-test", { recursive: true });
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
  "app/app/price-capture/api/detector-only/route.ts",
  "--outDir",
  ".tmp/detector-only-api-route-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  DETECTOR_ONLY_API_ROUTE_FEATURE_FLAG,
  buildDetectorOnlyApiRequestFromRouteBody,
  isDetectorOnlyApiRouteEnabled,
  isDetectorOnlyRouteBody,
} = require("../.tmp/detector-only-api-route-test/app/app/price-capture/api/detector-only/route.js");

after(() => {
  rmSync(".tmp/detector-only-api-route-test", { recursive: true, force: true });
});

test("exposes detector-only API route feature flag", () => {
  assert.equal(DETECTOR_ONLY_API_ROUTE_FEATURE_FLAG, "PRICEVISION_DETECTOR_ONLY_API_ENABLED");
  assert.equal(isDetectorOnlyApiRouteEnabled("1"), true);
  assert.equal(isDetectorOnlyApiRouteEnabled("true"), true);
  assert.equal(isDetectorOnlyApiRouteEnabled("TRUE"), true);
  assert.equal(isDetectorOnlyApiRouteEnabled("0"), false);
  assert.equal(isDetectorOnlyApiRouteEnabled(undefined), false);
});

test("accepts only JSON object route bodies", () => {
  assert.equal(isDetectorOnlyRouteBody({}), true);
  assert.equal(isDetectorOnlyRouteBody({ storeId: "store-1" }), true);
  assert.equal(isDetectorOnlyRouteBody(null), false);
  assert.equal(isDetectorOnlyRouteBody(undefined), false);
  assert.equal(isDetectorOnlyRouteBody([]), false);
  assert.equal(isDetectorOnlyRouteBody("{}"), false);
});

test("maps route JSON body into detector-only API boundary request", () => {
  const apiRequest = buildDetectorOnlyApiRequestFromRouteBody({
    storeId: "store-1",
    week: 2,
    runId: "run-1",
    capturedDate: "2026-07-10",
    photo: {
      bytes: [1, 2, 3],
      filename: "shelf.jpg",
      contentType: "image/jpeg",
      storagePath: "photos/shelf.jpg",
    },
    evidence: {
      cropExtension: "webp",
      cropPadding: { pixels: 2 },
    },
  }, "company-1");

  assert.deepEqual(apiRequest, {
    companyId: "company-1",
    storeId: "store-1",
    week: 2,
    runId: "run-1",
    capturedDate: "2026-07-10",
    photo: {
      bytes: [1, 2, 3],
      filename: "shelf.jpg",
      contentType: "image/jpeg",
      storagePath: "photos/shelf.jpg",
    },
    evidence: {
      cropExtension: "webp",
      cropPadding: { pixels: 2 },
    },
  });
});

test("builds invalid boundary request shape when required route fields are missing", () => {
  const apiRequest = buildDetectorOnlyApiRequestFromRouteBody(null, "company-1");

  assert.equal(apiRequest.companyId, "company-1");
  assert.equal(apiRequest.storeId, "");
  assert.equal(apiRequest.week, undefined);
  assert.deepEqual(apiRequest.photo, {
    bytes: [],
    filename: null,
    contentType: null,
    storagePath: null,
  });
});
