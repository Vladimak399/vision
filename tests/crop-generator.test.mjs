import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/crop-generator-test", { recursive: true, force: true });
mkdirSync(".tmp/crop-generator-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/price-capture/crop-generator.ts",
  "--outDir",
  ".tmp/crop-generator-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { createCropPlan, buildCropStoragePath, serializeCropEvidence } = require("../.tmp/crop-generator-test/crop-generator.js");

after(() => {
  rmSync(".tmp/crop-generator-test", { recursive: true, force: true });
});

test("creates a padded crop plan inside image bounds", () => {
  const plan = createCropPlan({
    image: { width: 1000, height: 800 },
    bbox: { x: 100.4, y: 200.2, width: 300.1, height: 100.6 },
    padding: { pixels: 10 },
  });

  assert.deepEqual(plan, {
    bbox: { x: 90, y: 190, width: 321, height: 121 },
    cropWidth: 321,
    cropHeight: 121,
    paddingPx: 10,
    wasClamped: false,
  });
});

test("clamps padded crop to image bounds", () => {
  const plan = createCropPlan({
    image: { width: 400, height: 300 },
    bbox: { x: 360, y: 260, width: 80, height: 70 },
    padding: { pixels: 25 },
  });

  assert.deepEqual(plan, {
    bbox: { x: 335, y: 235, width: 65, height: 65 },
    cropWidth: 65,
    cropHeight: 65,
    paddingPx: 25,
    wasClamped: true,
  });
});

test("uses ratio padding when it is larger than fixed padding", () => {
  const plan = createCropPlan({
    image: { width: 500, height: 500 },
    bbox: { x: 100, y: 100, width: 100, height: 50 },
    padding: { pixels: 4, ratio: 0.2 },
  });

  assert.equal(plan.paddingPx, 20);
  assert.deepEqual(plan.bbox, { x: 80, y: 80, width: 140, height: 90 });
});

test("returns null for invalid bbox or image dimensions", () => {
  assert.equal(createCropPlan({ image: { width: 0, height: 800 }, bbox: { x: 1, y: 1, width: 10, height: 10 } }), null);
  assert.equal(createCropPlan({ image: { width: 100, height: 100 }, bbox: { x: 1, y: 1, width: 0, height: 10 } }), null);
  assert.equal(createCropPlan({ image: { width: 100, height: 100 }, bbox: { x: Number.NaN, y: 1, width: 10, height: 10 } }), null);
  assert.equal(createCropPlan({ image: { width: 100, height: 100 }, bbox: { x: 200, y: 200, width: 10, height: 10 } }), null);
});

test("builds stable sanitized crop storage path", () => {
  assert.equal(
    buildCropStoragePath({
      companyId: "company/1",
      runId: "run 42",
      itemId: "item:abc",
      sourceFilename: "shelf.PNG",
    }),
    "evidence/company-1/runs/run-42/crops/item-abc.png",
  );
});

test("serializes crop evidence using DB column names", () => {
  const plan = createCropPlan({
    image: { width: 100, height: 100 },
    bbox: { x: 10, y: 20, width: 30, height: 40 },
  });

  assert.deepEqual(serializeCropEvidence(plan), {
    bbox: { x: 10, y: 20, width: 30, height: 40 },
    crop_width: 30,
    crop_height: 40,
  });
});
