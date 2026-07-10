import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/local-price-parser-test", { recursive: true, force: true });
mkdirSync(".tmp/local-price-parser-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "server/price-capture/crop-generator.ts",
  "server/price-capture/evidence-contract.ts",
  "server/price-capture/local-pipeline.ts",
  "server/price-capture/local-price-parser.ts",
  "--outDir",
  ".tmp/local-price-parser-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--esModuleInterop",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const {
  RUSSIAN_PRICE_PARSER_PROVIDER,
  createRussianPriceParser,
  normalizePriceText,
  parseRussianPriceText,
  parsedPriceToEvidenceCandidate,
} = require("../.tmp/local-price-parser-test/price-capture/local-price-parser.js");

after(() => {
  rmSync(".tmp/local-price-parser-test", { recursive: true, force: true });
});

test("normalizes OCR price text", () => {
  assert.equal(normalizePriceText(" Цена\t99  90\u0000\n руб "), "Цена 99 90\nrуб".replace("r", "р"));
  assert.equal(normalizePriceText(null), "");
});

test("parses common Russian shelf price formats", () => {
  const spaced = parseRussianPriceText("Цена 99 90 руб");
  assert.equal(spaced.isEmpty, false);
  assert.equal(spaced.priceMinor, 9990);
  assert.equal(spaced.currency, "RUB");
  assert.equal(spaced.oldPriceMinor, null);

  const comma = parseRussianPriceText("Молоко 2.5% 99,90 ₽");
  assert.equal(comma.isEmpty, false);
  assert.equal(comma.priceMinor, 9990);

  const dot = parseRussianPriceText("Кофе 1 299.90 руб");
  assert.equal(dot.isEmpty, false);
  assert.equal(dot.priceMinor, 129990);

  const colon = parseRussianPriceText("Цена: 45:50");
  assert.equal(colon.isEmpty, false);
  assert.equal(colon.priceMinor, 4550);
});

test("detects old and promo prices from OCR labels", () => {
  const result = parseRussianPriceText("Старая цена 129,90\nНовая цена акция 99,90");

  assert.equal(result.isEmpty, false);
  assert.equal(result.priceMinor, 9990);
  assert.equal(result.oldPriceMinor, 12990);
  assert.equal(result.promoPriceMinor, 9990);
  assert.equal(result.diagnostics.selectedKind, "promo");
  assert.equal(result.candidates.some((candidate) => candidate.kind === "old"), true);
  assert.equal(result.candidates.some((candidate) => candidate.kind === "promo"), true);
});

test("skips non-price numbers such as percentages, weights, and empty input", () => {
  const empty = parseRussianPriceText(" ");
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.priceMinor, null);
  assert.equal(empty.diagnostics.reason, "empty_text");

  const noPrice = parseRussianPriceText("Молоко 2.5% 900 г");
  assert.equal(noPrice.isEmpty, true);
  assert.equal(noPrice.diagnostics.reason, "no_price_candidate");
});

test("implements PriceParser interface", async () => {
  const parser = createRussianPriceParser();
  assert.deepEqual(RUSSIAN_PRICE_PARSER_PROVIDER, {
    provider: "local",
    model: "ru-price-parser-heuristic-v1",
    version: "PV-04-02",
  });
  assert.deepEqual(parser.provider, RUSSIAN_PRICE_PARSER_PROVIDER);

  const parsed = await parser.parse({
    run: { companyId: "company-1", storeId: "store-1", week: 1, runId: "run-1" },
    detection: {
      id: "det-1",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      confidence: 0.8,
      provider: "detector",
      model: "detector-v1",
    },
    ocr: {
      text: "Цена 149,50",
      confidence: 0.9,
      provider: "mock-ocr",
      model: "mock-ocr-v1",
    },
  });

  assert.equal(parsed.priceMinor, 14950);
  assert.equal(parsed.currency, "RUB");
});

test("returns null from parser interface when no price exists", async () => {
  const parser = createRussianPriceParser();
  const parsed = await parser.parse({
    run: { companyId: "company-1", storeId: "store-1", week: 1, runId: "run-1" },
    detection: {
      id: "det-1",
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      confidence: 0.8,
      provider: "detector",
      model: "detector-v1",
    },
    ocr: { text: "Только товар без цены", confidence: null, provider: "mock", model: "mock" },
  });

  assert.equal(parsed, null);
});

test("converts parsed price result into evidence candidate", () => {
  const parsed = parseRussianPriceText("Акция 77,70");
  const evidence = parsedPriceToEvidenceCandidate(parsed);

  assert.deepEqual(evidence, {
    priceMinor: 7770,
    oldPriceMinor: null,
    promoPriceMinor: 7770,
    currency: "RUB",
    confidence: parsed.confidence,
  });
  assert.equal(parsedPriceToEvidenceCandidate(null), null);
});
