import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/image-decoder-test", { recursive: true, force: true });
mkdirSync(".tmp/image-decoder-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/image-decoder.ts",
  "--outDir",
  ".tmp/image-decoder-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  createRawPixelDecodedImage,
  decodedImageToDetectorPhotoInput,
  createUnsupportedEncodedImageDecoder,
} = require("../.tmp/image-decoder-test/price-capture/image-decoder.js");

after(() => {
  rmSync(".tmp/image-decoder-test", { recursive: true, force: true });
});

test("wraps valid raw grayscale pixels as decoded image", () => {
  const bytes = new Uint8Array(20 * 10).fill(128);
  const result = createRawPixelDecodedImage({
    bytes,
    dimensions: { width: 20, height: 10 },
    pixelFormat: "grayscale",
    filename: "synthetic.raw",
    storagePath: "photos/synthetic.raw",
  });

  assert.equal(result.error, null);
  assert.ok(result.image);
  assert.equal(result.image.bytes, bytes);
  assert.deepEqual(result.image.dimensions, { width: 20, height: 10 });
  assert.equal(result.image.pixelFormat, "grayscale");
  assert.equal(result.image.contentType, "application/x-pricevision-raw-grayscale");
  assert.equal(result.image.decoderProvider, "local");
  assert.equal(result.image.decoderModel, "raw-pixel-boundary-v1");
});

test("validates RGB and RGBA raw pixel buffer length", () => {
  const rgb = createRawPixelDecodedImage({
    bytes: new Uint8Array(4 * 5 * 3),
    dimensions: { width: 4, height: 5 },
    pixelFormat: "rgb",
  });
  const rgba = createRawPixelDecodedImage({
    bytes: new Uint8Array(4 * 5 * 4),
    dimensions: { width: 4, height: 5 },
    pixelFormat: "rgba",
  });

  assert.equal(rgb.error, null);
  assert.equal(rgb.image.pixelFormat, "rgb");
  assert.equal(rgba.error, null);
  assert.equal(rgba.image.pixelFormat, "rgba");
});

test("rejects invalid raw pixel dimensions and lengths", () => {
  const invalidDimensions = createRawPixelDecodedImage({
    bytes: new Uint8Array(10),
    dimensions: { width: 0, height: 5 },
    pixelFormat: "grayscale",
  });
  const invalidLength = createRawPixelDecodedImage({
    bytes: new Uint8Array(10),
    dimensions: { width: 4, height: 5 },
    pixelFormat: "grayscale",
  });

  assert.equal(invalidDimensions.image, null);
  assert.equal(invalidDimensions.error.code, "invalid_dimensions");
  assert.equal(invalidLength.image, null);
  assert.equal(invalidLength.error.code, "invalid_raw_pixel_length");
  assert.equal(invalidLength.error.diagnostics.expectedLength, 20);
});

test("maps decoded image into detector photo input", () => {
  const decoded = createRawPixelDecodedImage({
    bytes: new Uint8Array(6),
    dimensions: { width: 3, height: 2 },
    pixelFormat: "grayscale",
    filename: "synthetic.raw",
    storagePath: "photos/synthetic.raw",
  }).image;

  const photo = decodedImageToDetectorPhotoInput(decoded);

  assert.deepEqual(photo, {
    bytes: decoded.bytes,
    dimensions: { width: 3, height: 2 },
    storagePath: "photos/synthetic.raw",
    filename: "synthetic.raw",
  });
});

test("unsupported encoded decoder returns explicit boundary error", async () => {
  const decoder = createUnsupportedEncodedImageDecoder();
  const result = await decoder.decode({
    bytes: new Uint8Array([255, 216, 255, 224]),
    filename: "shelf.jpg",
    contentType: "image/jpeg",
    storagePath: "photos/shelf.jpg",
  });

  assert.equal(result.image, null);
  assert.equal(result.error.code, "unsupported_encoded_image");
  assert.match(result.error.message, /not implemented/);
  assert.equal(result.error.diagnostics.contentType, "image/jpeg");
  assert.equal(result.error.diagnostics.nextStep.includes("decoder adapter"), true);
});
