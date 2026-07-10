import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/ocr-crop-test", { recursive: true, force: true });
mkdirSync(".tmp/ocr-crop-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/image-decoder.ts",
  "server/price-capture/local-ocr.ts",
  "server/price-capture/ocr-crop.ts",
  "--outDir",
  ".tmp/ocr-crop-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  buildLocalOcrResult,
  createUnsupportedLocalOcrEngine,
} = require("../.tmp/ocr-crop-test/price-capture/local-ocr.js");
const {
  buildOcrInputFromCropImage,
  createOcrCropImage,
  ocrCropImageToPhotoInput,
  runLocalOcrForDraftItems,
} = require("../.tmp/ocr-crop-test/price-capture/ocr-crop.js");

after(() => {
  rmSync(".tmp/ocr-crop-test", { recursive: true, force: true });
});

function decodedImage(overrides = {}) {
  return {
    bytes: overrides.bytes ?? new Uint8Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
    ]),
    dimensions: overrides.dimensions ?? { width: 4, height: 3 },
    pixelFormat: overrides.pixelFormat ?? "grayscale",
    filename: "shelf.png",
    contentType: "image/png",
    storagePath: "photos/shelf.png",
    decoderProvider: "test-decoder",
    decoderModel: "test-decoder-v1",
    diagnostics: { fixture: true },
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    itemId: overrides.itemId ?? "det-tag-1",
    cropPlan: overrides.cropPlan ?? {
      bbox: { x: 1, y: 1, width: 2, height: 2 },
      cropWidth: 2,
      cropHeight: 2,
      paddingPx: 0,
      wasClamped: false,
    },
    row: {
      crop_storage_path: "evidence/company/runs/run/crops/det-tag-1.png",
      ...overrides.row,
    },
    ...overrides,
  };
}

function detection(overrides = {}) {
  return {
    id: "tag-1",
    bbox: { x: 1, y: 1, width: 2, height: 2 },
    confidence: 0.8,
    provider: "detector",
    model: "detector-v1",
    label: "price_tag",
    ...overrides,
  };
}

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
};

test("extracts grayscale OCR crop bytes from decoded image and evidence draft crop plan", () => {
  const result = createOcrCropImage(decodedImage(), draft());

  assert.equal(result.error, null);
  assert.equal(result.cropImage.itemId, "det-tag-1");
  assert.deepEqual([...result.cropImage.bytes], [5, 6, 9, 10]);
  assert.deepEqual(result.cropImage.dimensions, { width: 2, height: 2 });
  assert.equal(result.cropImage.pixelFormat, "grayscale");
  assert.deepEqual(result.cropImage.sourceBBox, { x: 1, y: 1, width: 2, height: 2 });
  assert.equal(result.cropImage.filename, "det-tag-1.png");
  assert.equal(result.cropImage.contentType, "application/x-pricevision-raw-grayscale");
  assert.equal(result.cropImage.storagePath, "evidence/company/runs/run/crops/det-tag-1.png");
});

test("extracts RGB OCR crop bytes with channel stride preserved", () => {
  const rgb = new Uint8Array([
    0, 0, 0,   1, 1, 1,   2, 2, 2,
    3, 3, 3,   4, 4, 4,   5, 5, 5,
  ]);
  const result = createOcrCropImage(decodedImage({
    bytes: rgb,
    dimensions: { width: 3, height: 2 },
    pixelFormat: "rgb",
  }), draft({
    cropPlan: {
      bbox: { x: 1, y: 0, width: 2, height: 2 },
      cropWidth: 2,
      cropHeight: 2,
      paddingPx: 0,
      wasClamped: false,
    },
  }));

  assert.equal(result.error, null);
  assert.deepEqual([...result.cropImage.bytes], [
    1, 1, 1, 2, 2, 2,
    4, 4, 4, 5, 5, 5,
  ]);
  assert.deepEqual(result.cropImage.dimensions, { width: 2, height: 2 });
  assert.equal(result.cropImage.contentType, "application/x-pricevision-raw-rgb");
});

test("returns extraction errors for missing image, invalid byte length, or invalid crop", () => {
  const missingImage = createOcrCropImage(null, draft());
  assert.equal(missingImage.cropImage, null);
  assert.equal(missingImage.error.code, "missing_decoded_image");

  const invalidImage = createOcrCropImage(decodedImage({ bytes: new Uint8Array([1, 2]) }), draft());
  assert.equal(invalidImage.cropImage, null);
  assert.equal(invalidImage.error.code, "invalid_image");

  const invalidCrop = createOcrCropImage(decodedImage(), draft({
    cropPlan: {
      bbox: { x: 3, y: 2, width: 3, height: 2 },
      cropWidth: 3,
      cropHeight: 2,
      paddingPx: 0,
      wasClamped: false,
    },
  }));
  assert.equal(invalidCrop.cropImage, null);
  assert.equal(invalidCrop.error.code, "invalid_crop");
});

test("builds OcrInput from crop image without changing existing local-pipeline contract", () => {
  const crop = createOcrCropImage(decodedImage(), draft()).cropImage;
  const input = buildOcrInputFromCropImage({
    run,
    detection: detection(),
    draft: draft(),
    cropImage: crop,
  });

  assert.deepEqual(input.run, run);
  assert.equal(input.detection.id, "tag-1");
  assert.deepEqual(input.crop.bbox, { x: 1, y: 1, width: 2, height: 2 });
  assert.deepEqual(input.photo, ocrCropImageToPhotoInput(crop));
  assert.deepEqual([...input.photo.bytes], [5, 6, 9, 10]);
  assert.deepEqual(input.photo.dimensions, { width: 2, height: 2 });
});

test("runs no-op local OCR over draft items and records empty OCR results", async () => {
  const engine = createUnsupportedLocalOcrEngine();
  const result = await runLocalOcrForDraftItems({
    run,
    decodedImage: decodedImage(),
    items: [{ detection: detection(), draft: draft() }],
    ocr: engine,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.items[0].itemId, "det-tag-1");
  assert.equal(result.items[0].ocr.isEmpty, true);
  assert.equal(result.items[0].ocr.provider, "local");
  assert.deepEqual(result.metrics, {
    itemCount: 1,
    processedCount: 1,
    textResultCount: 0,
    emptyResultCount: 1,
    skippedCount: 0,
    failedCount: 0,
  });
});

test("runs injected OCR engine and captures recognized text", async () => {
  const engine = {
    provider: { provider: "test", model: "test-ocr" },
    async recognize(input) {
      assert.deepEqual([...input.photo.bytes], [5, 6, 9, 10]);
      return buildLocalOcrResult({
        provider: this.provider,
        text: "  Цена 99 90 ",
        confidence: 0.7,
      });
    },
  };

  const result = await runLocalOcrForDraftItems({
    run,
    decodedImage: decodedImage(),
    items: [{ detection: detection(), draft: draft() }],
    ocr: engine,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].ocr.text, "Цена 99 90");
  assert.equal(result.items[0].ocr.confidence, 0.7);
  assert.equal(result.metrics.textResultCount, 1);
  assert.equal(result.metrics.emptyResultCount, 0);
});

test("skips OCR when crop extraction fails and records OCR failures", async () => {
  const extractionSkipped = await runLocalOcrForDraftItems({
    run,
    decodedImage: null,
    items: [{ detection: detection(), draft: draft() }],
    ocr: createUnsupportedLocalOcrEngine(),
  });

  assert.equal(extractionSkipped.items.length, 0);
  assert.equal(extractionSkipped.skipped[0].reason, "missing_decoded_image");
  assert.equal(extractionSkipped.metrics.skippedCount, 1);

  const throwingEngine = {
    provider: { provider: "test", model: "throwing-ocr" },
    async recognize() {
      throw new Error("mock ocr failure");
    },
  };

  const failed = await runLocalOcrForDraftItems({
    run,
    decodedImage: decodedImage(),
    items: [{ detection: detection(), draft: draft() }],
    ocr: throwingEngine,
  });

  assert.equal(failed.items.length, 0);
  assert.equal(failed.skipped[0].reason, "ocr_failed");
  assert.equal(failed.skipped[0].errorMessage, "mock ocr failure");
  assert.equal(failed.metrics.failedCount, 1);
});
