import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/heuristic-price-tag-detector-test", { recursive: true, force: true });
mkdirSync(".tmp/heuristic-price-tag-detector-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/heuristic-price-tag-detector.ts",
  "--outDir",
  ".tmp/heuristic-price-tag-detector-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { createHeuristicPriceTagDetector } = require("../.tmp/heuristic-price-tag-detector-test/price-capture/heuristic-price-tag-detector.js");

after(() => {
  rmSync(".tmp/heuristic-price-tag-detector-test", { recursive: true, force: true });
});

function makeGrayscaleImage(width, height, fill = 35) {
  return new Uint8Array(width * height).fill(fill);
}

function drawRect(bytes, imageWidth, x, y, width, height, value) {
  for (let row = y; row < y + height; row += 1) {
    const offset = row * imageWidth;
    for (let col = x; col < x + width; col += 1) {
      bytes[offset + col] = value;
    }
  }
}

function drawTextLikeMarks(bytes, imageWidth, x, y) {
  drawRect(bytes, imageWidth, x + 4, y + 5, 18, 2, 20);
  drawRect(bytes, imageWidth, x + 4, y + 10, 25, 2, 20);
  drawRect(bytes, imageWidth, x + 34, y + 8, 14, 2, 20);
}

function photo(bytes, width, height) {
  return {
    bytes,
    dimensions: { width, height },
    filename: "synthetic-gray.raw",
    storagePath: "photos/synthetic-gray.raw",
  };
}

const run = {
  companyId: "company-1",
  storeId: "store-1",
  week: 1,
  runId: "run-1",
};

test("detects bright price-tag-like rectangles in synthetic grayscale input", async () => {
  const width = 160;
  const height = 100;
  const bytes = makeGrayscaleImage(width, height);

  drawRect(bytes, width, 20, 20, 54, 24, 245);
  drawTextLikeMarks(bytes, width, 20, 20);
  drawRect(bytes, width, 96, 52, 42, 18, 245);
  drawTextLikeMarks(bytes, width, 96, 52);
  drawRect(bytes, width, 5, 5, 4, 3, 245);

  const detector = createHeuristicPriceTagDetector({ minWidthPx: 20, minHeightPx: 12, minAreaPx: 250 });
  const result = await detector.detect({ run, photo: photo(bytes, width, height) });

  const boxes = result.detections
    .map((detection) => detection.bbox)
    .sort((a, b) => a.x - b.x);

  assert.deepEqual(boxes, [
    { x: 20, y: 20, width: 54, height: 24 },
    { x: 96, y: 52, width: 42, height: 18 },
  ]);
  assert.equal(result.provider.provider, "local");
  assert.equal(result.provider.model, "heuristic-price-tag-v1");
  assert.equal(result.diagnostics.reason, "ok");
});

test("supports RGB input and maxDetections", async () => {
  const width = 80;
  const height = 40;
  const gray = makeGrayscaleImage(width, height);
  drawRect(gray, width, 5, 5, 28, 14, 250);
  drawRect(gray, width, 42, 10, 28, 14, 250);

  const rgb = new Uint8Array(width * height * 3);
  for (let index = 0; index < gray.length; index += 1) {
    rgb[index * 3] = gray[index];
    rgb[index * 3 + 1] = gray[index];
    rgb[index * 3 + 2] = gray[index];
  }

  const detector = createHeuristicPriceTagDetector({ maxDetections: 1, minAreaPx: 120 });
  const result = await detector.detect({ run, photo: photo(rgb, width, height) });

  assert.equal(result.detections.length, 1);
  assert.equal(result.diagnostics.pixelFormat, "rgb");
});

test("returns empty result for encoded image bytes instead of guessing", async () => {
  const detector = createHeuristicPriceTagDetector();
  const result = await detector.detect({
    run,
    photo: photo(new Uint8Array([255, 216, 255, 224, 1, 2, 3]), 100, 80),
  });

  assert.deepEqual(result.detections, []);
  assert.equal(result.diagnostics.reason, "unsupported_encoded_image_bytes");
});

test("returns empty result for invalid dimensions", async () => {
  const detector = createHeuristicPriceTagDetector();
  const result = await detector.detect({
    run,
    photo: photo(new Uint8Array([1, 2, 3]), 0, 80),
  });

  assert.deepEqual(result.detections, []);
  assert.equal(result.diagnostics.reason, "invalid_dimensions");
});
