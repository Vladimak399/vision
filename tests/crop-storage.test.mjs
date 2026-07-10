import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/crop-storage-test", { recursive: true, force: true });
mkdirSync(".tmp/crop-storage-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/crop-storage.ts",
  "--outDir",
  ".tmp/crop-storage-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { createCropPlan } = require("../.tmp/crop-storage-test/crop-generator.js");
const { createCropUploadPlan, uploadCropEvidence, CROP_EVIDENCE_BUCKET } = require("../.tmp/crop-storage-test/crop-storage.js");

after(() => {
  rmSync(".tmp/crop-storage-test", { recursive: true, force: true });
});

function sampleCropPlan() {
  const plan = createCropPlan({
    image: { width: 100, height: 80 },
    bbox: { x: 10, y: 15, width: 30, height: 20 },
  });
  assert.ok(plan);
  return plan;
}

test("creates upload plan with DB-ready evidence", () => {
  const plan = createCropUploadPlan({
    companyId: "company-1",
    runId: "run-1",
    itemId: "item-1",
    cropPlan: sampleCropPlan(),
    cropBytes: new Uint8Array([1, 2, 3]),
    sourceFilename: "shelf.png",
  });

  assert.ok(plan);
  assert.equal(plan.bucket, CROP_EVIDENCE_BUCKET);
  assert.equal(plan.path, "evidence/company-1/runs/run-1/crops/item-1.png");
  assert.equal(plan.contentType, "image/png");
  assert.equal(plan.upsert, false);
  assert.deepEqual(Array.from(plan.body), [1, 2, 3]);
  assert.deepEqual(plan.evidence, {
    bbox: { x: 10, y: 15, width: 30, height: 20 },
    crop_storage_path: "evidence/company-1/runs/run-1/crops/item-1.png",
    crop_width: 30,
    crop_height: 20,
  });
});

test("supports ArrayBuffer input, explicit bucket, explicit content type, and upsert", () => {
  const bytes = new Uint8Array([4, 5, 6]).buffer;
  const plan = createCropUploadPlan({
    companyId: "company-1",
    runId: "run-1",
    itemId: "item-1",
    cropPlan: sampleCropPlan(),
    cropBytes: bytes,
    extension: "webp",
    bucket: "custom-bucket",
    contentType: "image/custom",
    upsert: true,
  });

  assert.ok(plan);
  assert.equal(plan.bucket, "custom-bucket");
  assert.equal(plan.path.endsWith(".webp"), true);
  assert.equal(plan.contentType, "image/custom");
  assert.equal(plan.upsert, true);
  assert.deepEqual(Array.from(plan.body), [4, 5, 6]);
});

test("returns null for empty crop bytes", () => {
  const plan = createCropUploadPlan({
    companyId: "company-1",
    runId: "run-1",
    itemId: "item-1",
    cropPlan: sampleCropPlan(),
    cropBytes: new Uint8Array([]),
  });

  assert.equal(plan, null);
});

test("uploads crop evidence through storage client interface", async () => {
  const uploadCalls = [];
  const storage = {
    from(bucket) {
      return {
        async upload(path, body, options) {
          uploadCalls.push({ bucket, path, body: Array.from(body), options });
          return { data: { path }, error: null };
        },
      };
    },
  };

  const plan = createCropUploadPlan({
    companyId: "company-1",
    runId: "run-1",
    itemId: "item-1",
    cropPlan: sampleCropPlan(),
    cropBytes: new Uint8Array([7, 8]),
    extension: "jpg",
  });

  const result = await uploadCropEvidence(storage, plan);

  assert.equal(result.path, "evidence/company-1/runs/run-1/crops/item-1.jpg");
  assert.deepEqual(uploadCalls, [{
    bucket: CROP_EVIDENCE_BUCKET,
    path: "evidence/company-1/runs/run-1/crops/item-1.jpg",
    body: [7, 8],
    options: { contentType: "image/jpeg", upsert: false },
  }]);
});

test("throws readable storage upload errors", async () => {
  const storage = {
    from() {
      return {
        async upload() {
          return { data: null, error: { message: "bucket not found" } };
        },
      };
    },
  };

  const plan = createCropUploadPlan({
    companyId: "company-1",
    runId: "run-1",
    itemId: "item-1",
    cropPlan: sampleCropPlan(),
    cropBytes: new Uint8Array([1]),
  });

  await assert.rejects(() => uploadCropEvidence(storage, plan), /bucket not found/);
});
