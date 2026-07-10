import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

rmSync(".tmp/decoded-detector-pipeline-test", { recursive: true, force: true });
mkdirSync(".tmp/decoded-detector-pipeline-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/image-decoder.ts",
  "server/price-capture/sharp-image-decoder.ts",
  "server/price-capture/heuristic-price-tag-detector.ts",
  "server/price-capture/decoded-detector-pipeline.ts",
  "--outDir",
  ".tmp/decoded-detector-pipeline-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const {
  createSharpHeuristicDetectorPipeline,
  detectPriceTagsFromEncodedImage,
} = require("../.tmp/decoded-detector-pipeline-test/price-capture/decoded-detector-pipeline.js");
const {
  createSharpImageDecoder,
} = require("../.tmp/decoded-detector-pipeline-test/price-capture/sharp-image-decoder.js");

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
};

function makeRgbaImage(width, height, fill = [20, 20, 20, 255]) {
  const bytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    bytes[index * 4] = fill[0];
    bytes[index * 4 + 1] = fill[1];
    bytes[index * 4 + 2] = fill[2];
    bytes[index * 4 + 3] = fill[3];
  }
  return bytes;
}

function drawRectRgba(bytes, imageWidth, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      const offset = (row * imageWidth + col) * 4;
      bytes[offset] = color[0];
      bytes[offset + 1] = color[1];
      bytes[offset + 2] = color[2];
      bytes[offset + 3] = color[3];
    }
  }
}

async function encodePngFromRgba(bytes, width, height) {
  return sharp(bytes, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

after(() => {
  rmSync(".tmp/decoded-detector-pipeline-test", { recursive: true, force: true });
});

test("decodes encoded PNG and runs heuristic price-tag detector", async () => {
  const width = 160;
  const height = 100;
  const rgba = makeRgbaImage(width, height);

  drawRectRgba(rgba, width, 20, 20, 54, 24, [245, 245, 245, 255]);
  drawRectRgba(rgba, width, 24, 25, 18, 2, [20, 20, 20, 255]);
  drawRectRgba(rgba, width, 24, 30, 25, 2, [20, 20, 20, 255]);

  drawRectRgba(rgba, width, 96, 52, 42, 18, [245, 245, 245, 255]);
  drawRectRgba(rgba, width, 100, 57, 18, 2, [20, 20, 20, 255]);

  const png = await encodePngFromRgba(rgba, width, height);
  const { decoder, detector } = createSharpHeuristicDetectorPipeline({
    decoder: { pixelFormat: "rgba" },
    detector: { minWidthPx: 20, minHeightPx: 12, minAreaPx: 250 },
  });

  const result = await detectPriceTagsFromEncodedImage({
    run,
    image: {
      bytes: new Uint8Array(png),
      filename: "shelf.png",
      contentType: "image/png",
      storagePath: "photos/shelf.png",
    },
    decoder,
    detector,
  });

  const boxes = result.detections
    .map((detection) => detection.bbox)
    .sort((a, b) => a.x - b.x);

  assert.equal(result.decodeError, null);
  assert.equal(result.decodedImage.pixelFormat, "rgba");
  assert.equal(result.detectorResult.provider.model, "heuristic-price-tag-v1");
  assert.equal(result.diagnostics.decoderProvider, "sharp");
  assert.equal(result.diagnostics.detectorProvider, "local");
  assert.deepEqual(result.steps.map((step) => [step.step, step.status]), [
    ["decode_image", "completed"],
    ["detect", "completed"],
  ]);
  assert.deepEqual(boxes, [
    { x: 20, y: 20, width: 54, height: 24 },
    { x: 96, y: 52, width: 42, height: 18 },
  ]);
});

test("stops before detector when image decoding fails", async () => {
  const detector = {
    provider: { provider: "test", model: "throwing-detector" },
    async detect() {
      throw new Error("detector should not run after decode failure");
    },
  };

  const result = await detectPriceTagsFromEncodedImage({
    run,
    image: {
      bytes: new Uint8Array([1, 2, 3, 4, 5]),
      filename: "broken.jpg",
      contentType: "image/jpeg",
    },
    decoder: createSharpImageDecoder(),
    detector,
  });

  assert.deepEqual(result.detections, []);
  assert.equal(result.decodedImage, null);
  assert.equal(result.detectorResult, null);
  assert.equal(result.decodeError.code, "decode_failed");
  assert.deepEqual(result.steps.map((step) => [step.step, step.status]), [
    ["decode_image", "failed"],
  ]);
});
