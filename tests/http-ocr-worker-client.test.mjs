import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/http-ocr-worker-client-test", { recursive: true, force: true });
mkdirSync(".tmp/http-ocr-worker-client-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-ocr.ts",
  "server/price-capture/external-ocr-worker.ts",
  "server/price-capture/http-ocr-worker-client.ts",
  "--outDir",
  ".tmp/http-ocr-worker-client-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  OCR_WORKER_REQUEST_SCHEMA_VERSION,
  OCR_WORKER_RESPONSE_SCHEMA_VERSION,
  buildHttpOcrWorkerRequestBody,
  createHttpOcrWorkerClient,
  normalizeHttpOcrWorkerResponse,
} = require("../.tmp/http-ocr-worker-client-test/price-capture/http-ocr-worker-client.js");

after(() => {
  rmSync(".tmp/http-ocr-worker-client-test", { recursive: true, force: true });
});

test("builds HTTP OCR worker request body with base64 crop bytes", () => {
  const request = createWorkerRequest({ bytes: new Uint8Array([1, 2, 3, 4]), width: 2, height: 2 });
  const body = buildHttpOcrWorkerRequestBody(request);

  assert.equal(body.schemaVersion, OCR_WORKER_REQUEST_SCHEMA_VERSION);
  assert.equal(body.requestId, "run-1:det-1");
  assert.equal(body.image.bytesBase64, Buffer.from([1, 2, 3, 4]).toString("base64"));
  assert.equal(body.image.pixelFormat, "grayscale");
  assert.equal(body.image.width, 2);
  assert.equal(body.image.height, 2);
  assert.equal(body.context.companyId, "company-1");
  assert.equal(body.context.itemId, "det-1");
  assert.deepEqual(body.hints.languages, ["ru", "en"]);
});

test("infers RGB and RGBA crop payload formats", () => {
  const rgb = buildHttpOcrWorkerRequestBody(createWorkerRequest({ bytes: new Uint8Array(12), width: 2, height: 2 }));
  assert.equal(rgb.image.pixelFormat, "rgb");

  const rgba = buildHttpOcrWorkerRequestBody(createWorkerRequest({ bytes: new Uint8Array(16), width: 2, height: 2 }));
  assert.equal(rgba.image.pixelFormat, "rgba");
});

test("normalizes successful HTTP OCR worker response", () => {
  const normalized = normalizeHttpOcrWorkerResponse({
    schemaVersion: OCR_WORKER_RESPONSE_SCHEMA_VERSION,
    requestId: "run-1:det-1",
    ok: true,
    provider: "rapidocr-worker",
    model: "rapidocr-v1",
    text: "Цена 99 90",
    confidence: 1.2,
    blocks: [
      { text: " Цена 99 90 ", confidence: 0.8, bbox: { x: 1.9, y: 2.1, width: 30.8, height: 10.4 } },
      null,
      {},
    ],
    diagnostics: { durationMs: 12 },
  }, {
    requestId: "run-1:det-1",
    httpStatus: 200,
    durationMs: 13,
  });

  assert.equal(normalized.ok, true);
  assert.equal(normalized.text, "Цена 99 90");
  assert.equal(normalized.confidence, 1);
  assert.equal(normalized.provider.provider, "rapidocr-worker");
  assert.equal(normalized.provider.model, "rapidocr-v1");
  assert.equal(normalized.blocks.length, 1);
  assert.deepEqual(normalized.blocks[0], {
    text: "Цена 99 90",
    confidence: 0.8,
    bbox: { x: 1, y: 2, width: 30, height: 10 },
  });
  assert.equal(normalized.diagnostics.httpStatus, 200);
  assert.equal(normalized.diagnostics.durationMs, 12);
});

test("normalizes worker error and invalid schema responses", () => {
  const workerError = normalizeHttpOcrWorkerResponse({
    schemaVersion: OCR_WORKER_RESPONSE_SCHEMA_VERSION,
    ok: false,
    error: { code: "ocr_failed", message: "OCR failed" },
  }, {
    requestId: "run-1:det-1",
    httpStatus: 200,
    durationMs: 4,
  });

  assert.equal(workerError.ok, false);
  assert.equal(workerError.errorCode, "ocr_failed");
  assert.equal(workerError.errorMessage, "OCR failed");

  const invalidSchema = normalizeHttpOcrWorkerResponse({
    schemaVersion: "future-schema",
    ok: true,
    text: "ignored",
  }, {
    requestId: "run-1:det-1",
    httpStatus: 200,
    durationMs: 4,
  });

  assert.equal(invalidSchema.ok, false);
  assert.equal(invalidSchema.errorCode, "invalid_worker_schema");
});

test("HTTP OCR worker client posts JSON request and maps response", async () => {
  const calls = [];
  const client = createHttpOcrWorkerClient({
    url: "http://127.0.0.1:8765/ocr",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const body = JSON.parse(init.body);
      assert.equal(body.schemaVersion, OCR_WORKER_REQUEST_SCHEMA_VERSION);
      assert.equal(body.requestId, "run-1:det-1");
      return new Response(JSON.stringify({
        schemaVersion: OCR_WORKER_RESPONSE_SCHEMA_VERSION,
        requestId: body.requestId,
        ok: true,
        provider: "rapidocr-worker",
        model: "rapidocr-v1",
        text: "Кофе 99 90",
        confidence: 0.77,
        diagnostics: { durationMs: 9 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const response = await client.recognize(createWorkerRequest());

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:8765/ocr");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(response.ok, true);
  assert.equal(response.text, "Кофе 99 90");
  assert.equal(response.confidence, 0.77);
});

test("HTTP OCR worker client maps invalid JSON and request failures to worker errors", async () => {
  const invalidJsonClient = createHttpOcrWorkerClient({
    url: "http://127.0.0.1:8765/ocr",
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });

  const invalidJson = await invalidJsonClient.recognize(createWorkerRequest());
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.errorCode, "invalid_worker_json");

  const failingClient = createHttpOcrWorkerClient({
    url: "http://127.0.0.1:8765/ocr",
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });

  const failed = await failingClient.recognize(createWorkerRequest());
  assert.equal(failed.ok, false);
  assert.equal(failed.errorCode, "worker_request_failed");
  assert.match(failed.errorMessage, /connection refused/);
});

function createWorkerRequest(overrides = {}) {
  const bytes = overrides.bytes ?? new Uint8Array([1, 2, 3, 4]);
  const width = overrides.width ?? 2;
  const height = overrides.height ?? 2;

  return {
    requestId: "run-1:det-1",
    run: {
      companyId: "company-1",
      storeId: "store-1",
      week: 1,
      runId: "run-1",
    },
    item: {
      detectionId: "det-1",
      itemId: "det-1",
      detectionBBox: { x: 1, y: 2, width: 3, height: 4 },
      cropBBox: { x: 1, y: 2, width: 3, height: 4 },
    },
    image: {
      bytes,
      width,
      height,
      byteLength: bytes.byteLength,
      filename: "crop.png",
      contentType: "application/x-pricevision-raw-rgba",
      storagePath: "evidence/company/runs/run/crops/det-1.png",
    },
    hints: {
      languages: ["ru", "en"],
    },
  };
}
