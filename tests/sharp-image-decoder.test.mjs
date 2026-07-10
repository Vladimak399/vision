import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

rmSync(".tmp/sharp-image-decoder-test", { recursive: true, force: true });
mkdirSync(".tmp/sharp-image-decoder-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/image-decoder.ts",
  "server/price-capture/sharp-image-decoder.ts",
  "--outDir",
  ".tmp/sharp-image-decoder-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const {
  createSharpImageDecoder,
} = require("../.tmp/sharp-image-decoder-test/price-capture/sharp-image-decoder.js");
const {
  decodedImageToDetectorPhotoInput,
} = require("../.tmp/sharp-image-decoder-test/price-capture/image-decoder.js");

after(() => {
  rmSync(".tmp/sharp-image-decoder-test", { recursive: true, force: true });
});

test("decodes PNG into RGBA raw pixels by default", async () => {
  const png = await sharp({
    create: {
      width: 3,
      height: 2,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  }).png().toBuffer();

  const decoder = createSharpImageDecoder();
  const result = await decoder.decode({
    bytes: new Uint8Array(png),
    filename: "sample.png",
    contentType: "image/png",
    storagePath: "photos/sample.png",
  });

  assert.equal(result.error, null);
  assert.ok(result.image);
  assert.deepEqual(result.image.dimensions, { width: 3, height: 2 });
  assert.equal(result.image.pixelFormat, "rgba");
  assert.equal(result.image.bytes.byteLength, 3 * 2 * 4);
  assert.equal(result.image.contentType, "application/x-pricevision-raw-rgba");
  assert.equal(result.image.decoderProvider, "sharp");
  assert.equal(result.image.decoderModel, "sharp-image-decoder-v1");
  assert.equal(result.image.filename, "sample.png");
  assert.equal(result.image.storagePath, "photos/sample.png");
  assert.equal(result.image.diagnostics.inputFormat, "png");
});

test("decodes JPEG into RGB raw pixels when requested", async () => {
  const jpeg = await sharp({
    create: {
      width: 4,
      height: 3,
      channels: 3,
      background: { r: 200, g: 210, b: 220 },
    },
  }).jpeg().toBuffer();

  const decoder = createSharpImageDecoder({ pixelFormat: "rgb" });
  const result = await decoder.decode({
    bytes: new Uint8Array(jpeg),
    filename: "sample.jpg",
    contentType: "image/jpeg",
  });

  assert.equal(result.error, null);
  assert.ok(result.image);
  assert.deepEqual(result.image.dimensions, { width: 4, height: 3 });
  assert.equal(result.image.pixelFormat, "rgb");
  assert.equal(result.image.bytes.byteLength, 4 * 3 * 3);
  assert.equal(result.image.contentType, "application/x-pricevision-raw-rgb");
  assert.equal(result.image.diagnostics.inputFormat, "jpeg");
});

test("maps decoded sharp image to detector photo input", async () => {
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  }).png().toBuffer();

  const result = await createSharpImageDecoder().decode({
    bytes: new Uint8Array(png),
    filename: "tag.png",
    storagePath: "photos/tag.png",
  });

  const photo = decodedImageToDetectorPhotoInput(result.image);

  assert.equal(photo.bytes, result.image.bytes);
  assert.deepEqual(photo.dimensions, { width: 2, height: 2 });
  assert.equal(photo.filename, "tag.png");
  assert.equal(photo.storagePath, "photos/tag.png");
});

test("returns decode_failed for invalid encoded bytes", async () => {
  const result = await createSharpImageDecoder().decode({
    bytes: new Uint8Array([1, 2, 3, 4, 5]),
    filename: "broken.jpg",
    contentType: "image/jpeg",
  });

  assert.equal(result.image, null);
  assert.equal(result.error.code, "decode_failed");
  assert.equal(result.error.diagnostics.decoderProvider, "sharp");
  assert.equal(result.error.diagnostics.filename, "broken.jpg");
  assert.equal(result.error.diagnostics.contentType, "image/jpeg");
});
