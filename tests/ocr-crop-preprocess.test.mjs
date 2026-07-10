import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/ocr-crop-preprocess-test", { recursive: true, force: true });
mkdirSync(".tmp/ocr-crop-preprocess-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/ocr-crop-preprocess.ts",
  "--outDir",
  ".tmp/ocr-crop-preprocess-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  buildOcrCropPreprocessPlan,
} = require("../.tmp/ocr-crop-preprocess-test/price-capture/ocr-crop-preprocess.js");

after(() => {
  rmSync(".tmp/ocr-crop-preprocess-test", { recursive: true, force: true });
});

test("marks 70x10 detector bbox as too small and expands OCR input", () => {
  const plan = buildOcrCropPreprocessPlan({
    imageDimensions: { width: 1280, height: 720 },
    originalBBox: { x: 500, y: 220, width: 70, height: 10 },
  });

  assert.equal(plan.isProbablyTooSmallForOcr, true);
  assert.equal(plan.reviewReason, "detected_bbox_too_small_for_ocr");
  assert.equal(plan.expandedWidth >= 160, true);
  assert.equal(plan.expandedHeight >= 40, true);
  assert.equal(plan.ocrInputWidth >= 320, true);
  assert.equal(plan.ocrInputHeight >= 80, true);
  assert.equal(plan.wasExpanded, true);
  assert.equal(plan.wasUpscaled, true);
});

test("does not expand a sufficiently large price tag bbox unnecessarily", () => {
  const plan = buildOcrCropPreprocessPlan({
    imageDimensions: { width: 1280, height: 720 },
    originalBBox: { x: 100, y: 100, width: 400, height: 100 },
  });

  assert.equal(plan.isProbablyTooSmallForOcr, false);
  assert.equal(plan.reviewReason, null);
  assert.equal(plan.expandedWidth, 424);
  assert.equal(plan.expandedHeight, 124);
  assert.equal(plan.ocrInputWidth, 424);
  assert.equal(plan.ocrInputHeight, 124);
});

test("keeps expanded bbox within image bounds", () => {
  const plan = buildOcrCropPreprocessPlan({
    imageDimensions: { width: 200, height: 100 },
    originalBBox: { x: 185, y: 90, width: 10, height: 5 },
  });

  assert.equal(plan.expandedBBox.x >= 0, true);
  assert.equal(plan.expandedBBox.y >= 0, true);
  assert.equal(plan.expandedBBox.x + plan.expandedBBox.width <= 200, true);
  assert.equal(plan.expandedBBox.y + plan.expandedBBox.height <= 100, true);
});
