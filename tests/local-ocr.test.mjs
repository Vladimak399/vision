import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/local-ocr-test", { recursive: true, force: true });
mkdirSync(".tmp/local-ocr-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-ocr.ts",
  "--outDir",
  ".tmp/local-ocr-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  UNSUPPORTED_LOCAL_OCR_PROVIDER,
  buildLocalOcrResult,
  createUnsupportedLocalOcrEngine,
  normalizeOcrBlocks,
  normalizeOcrConfidence,
  normalizeOcrText,
} = require("../.tmp/local-ocr-test/price-capture/local-ocr.js");

after(() => {
  rmSync(".tmp/local-ocr-test", { recursive: true, force: true });
});

test("normalizes OCR text without changing line boundaries", () => {
  assert.equal(normalizeOcrText("  Milk\t  2.5% \n  129   90 \u0000 "), "Milk 2.5%\n129 90");
  assert.equal(normalizeOcrText(null), "");
  assert.equal(normalizeOcrText(" \n\t "), "");
});

test("normalizes OCR confidence into nullable 0..1 range", () => {
  assert.equal(normalizeOcrConfidence(0.87555), 0.8756);
  assert.equal(normalizeOcrConfidence(2), 1);
  assert.equal(normalizeOcrConfidence(-1), 0);
  assert.equal(normalizeOcrConfidence(Number.NaN), null);
  assert.equal(normalizeOcrConfidence(undefined), null);
});

test("normalizes OCR blocks and drops empty or invalid data", () => {
  const blocks = normalizeOcrBlocks([
    {
      text: "  Цена   129,90 ",
      confidence: 1.5,
      bbox: { x: 10.2, y: 3.8, width: 20.1, height: 9.2 },
    },
    {
      text: "",
      confidence: 0.2,
      bbox: { x: 1, y: 2, width: 3, height: 4 },
    },
    {
      text: "bad bbox",
      confidence: -2,
      bbox: { x: 1, y: 2, width: 0, height: 4 },
    },
    null,
  ]);

  assert.deepEqual(blocks, [
    {
      text: "Цена 129,90",
      confidence: 1,
      bbox: { x: 10, y: 3, width: 21, height: 10 },
    },
    {
      text: "bad bbox",
      confidence: 0,
      bbox: null,
    },
  ]);
});

test("builds local OCR result from explicit text", () => {
  const result = buildLocalOcrResult({
    provider: { provider: " rapidocr ", model: " rapidocr-v1 " },
    text: "  Товар \n 99 90 ",
    confidence: 0.82,
    diagnostics: { language: "ru" },
  });

  assert.equal(result.text, "Товар\n99 90");
  assert.equal(result.confidence, 0.82);
  assert.equal(result.provider, "rapidocr");
  assert.equal(result.model, "rapidocr-v1");
  assert.deepEqual(result.blocks, []);
  assert.equal(result.isEmpty, false);
  assert.deepEqual(result.diagnostics, { language: "ru" });
});

test("builds local OCR result from blocks and averages block confidence", () => {
  const result = buildLocalOcrResult({
    provider: { provider: "local", model: "block-test" },
    blocks: [
      { text: "Name", confidence: 0.5 },
      { text: "129.90", confidence: 1 },
      { text: "ignored empty", confidence: null, bbox: { x: 0, y: 0, width: 1, height: 1 } },
    ],
  });

  assert.equal(result.text, "Name\n129.90\nignored empty");
  assert.equal(result.confidence, 0.75);
  assert.equal(result.isEmpty, false);
  assert.equal(result.blocks.length, 3);
});

test("creates unsupported local OCR engine compatible with OcrEngine", async () => {
  const engine = createUnsupportedLocalOcrEngine({ diagnostics: { hint: "install OCR adapter later" } });

  assert.deepEqual(UNSUPPORTED_LOCAL_OCR_PROVIDER, {
    provider: "local",
    model: "unsupported-ocr-v0",
    version: "PV-03-01",
  });
  assert.deepEqual(engine.provider, UNSUPPORTED_LOCAL_OCR_PROVIDER);

  const result = await engine.recognize({
    run: {
      companyId: "company-1",
      storeId: "store-1",
      week: 1,
      runId: "run-1",
    },
    photo: {
      bytes: new Uint8Array([1, 2, 3]),
      dimensions: { width: 1, height: 3 },
    },
    detection: {
      id: "tag-1",
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      confidence: 0.7,
      provider: "detector",
      model: "detector-v1",
    },
    crop: {
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      cropWidth: 1,
      cropHeight: 1,
      paddingPx: 0,
      wasClamped: false,
    },
  });

  assert.equal(result.text, "");
  assert.equal(result.confidence, null);
  assert.equal(result.provider, "local");
  assert.equal(result.model, "unsupported-ocr-v0");
  assert.deepEqual(result.blocks, []);
  assert.equal(result.isEmpty, true);
  assert.deepEqual(result.diagnostics, {
    reason: "unsupported_local_ocr",
    hint: "install OCR adapter later",
  });
});
