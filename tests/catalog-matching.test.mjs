import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { after, test } from "node:test";
import { createRequire } from "node:module";

rmSync(".tmp/catalog-matching-test", { recursive: true, force: true });
mkdirSync(".tmp/catalog-matching-test", { recursive: true });
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", [
  "tsc",
  "server/catalog-matching.ts",
  "--outDir",
  ".tmp/catalog-matching-test",
  "--module",
  "commonjs",
  "--target",
  "es2022",
  "--skipLibCheck",
], { stdio: "inherit", shell: true });

const require = createRequire(import.meta.url);
const { buildCatalogMatchKey, getCatalogMatchCandidates } = require("../.tmp/catalog-matching-test/catalog-matching.js");

after(() => {
  rmSync(".tmp/catalog-matching-test", { recursive: true, force: true });
});

const catalog = [
  { id: "nivea-cream-250", name: "Nivea крем для душа кокос 250 мл", brand: "Nivea", size_text: "250 мл" },
  { id: "nivea-cream-400", name: "Nivea крем для душа кокос 400 мл", brand: "Nivea", size_text: "400 мл" },
  { id: "nivea-cream-250-aloe", name: "Nivea крем для душа алоэ 250 мл", brand: "Nivea", size_text: "250 мл" },
  { id: "ariel-powder-3kg", name: "Ariel порошок автомат Color пакет 3 кг", brand: "Ariel", size_text: "3 кг" },
  { id: "ariel-caps-15", name: "Ariel капсулы Color 15 шт", brand: "Ariel", size_text: "15 шт" },
  { id: "palmolive-gel-250", name: "Palmolive гель для душа Олива 250 мл", brand: "Palmolive", size_text: "250 мл" },
  { id: "dove-soap-100", name: "Dove мыло крем 100 г", brand: "Dove", size_text: "100 г" },
  { id: "colgate-paste-100", name: "Colgate зубная паста мята туба 100 мл", brand: "Colgate", size_text: "100 мл" },
  { id: "persil-gel-bottle-1l", name: "Persil гель автомат лаванда бутылка 1 л", brand: "Persil", size_text: "1 л" },
  { id: "persil-gel-doypack-1l", name: "Persil гель автомат лаванда дойпак 1 л", brand: "Persil", size_text: "1 л" },
  { id: "yashkino-waffle-200", name: "Яшкино вафли классические 200 г", brand: "Яшкино", size_text: "200 г" },
  { id: "milka-choc-90", name: "Milka шоколад молочный 90 г", brand: "Milka", size_text: "90 г" },
];

function best(input) {
  return getCatalogMatchCandidates(input, catalog, { limit: 5 })[0];
}

function decision(candidate, second) {
  if (!candidate || candidate.score < 0.66) return "no candidate";
  const hasReviewReason = candidate.reasons.some((reason) => reason.endsWith("_review"));
  if (!hasReviewReason && candidate.score >= 0.9 && (!second || candidate.score - second.score >= 0.08)) return "auto";
  return "suggested";
}

test("household and hygiene brands match exact base products", () => {
  for (const [rawName, id] of [
    ["Nivea крем душ кокос 250 мл", "nivea-cream-250"],
    ["Ariel порошок автомат color 3 кг", "ariel-powder-3kg"],
    ["Palmolive гель душ олива 250 мл", "palmolive-gel-250"],
    ["Dove мыло крем 100 г", "dove-soap-100"],
    ["Colgate зубная паста мята 100 мл", "colgate-paste-100"],
    ["Persil гель автомат лаванда бутылка 1 л", "persil-gel-bottle-1l"],
  ]) {
    assert.equal(best({ rawName })?.product.id, id, rawName);
  }
});

test("brand in rawName is enough when brand field is empty", () => {
  const candidate = best({ rawName: "Colgate зубная паста мята 100 мл", brand: null });
  assert.equal(candidate.product.id, "colgate-paste-100");
  assert.match(candidate.reasons.join(","), /brand/);
});

test("same base product with different flavors keeps product_family review instead of losing score", () => {
  const candidate = best({ rawName: "Nivea крем для душа алоэ 250 мл" });
  assert.equal(candidate.product.id, "nivea-cream-250-aloe");

  const otherVariant = getCatalogMatchCandidates({ rawName: "Nivea крем для душа алоэ 250 мл" }, [catalog[0]], { limit: 1 })[0];
  assert.ok(otherVariant.score >= 0.66);
  assert.ok(otherVariant.reasons.includes("product_family"));
  assert.ok(otherVariant.reasons.includes("different_variant_same_base_review"));
  assert.notEqual(decision(otherVariant), "auto");
});

test("different volumes of same product prefer exact size and review missing size", () => {
  assert.equal(best({ rawName: "Nivea крем для душа кокос 400 мл" }).product.id, "nivea-cream-400");
  const candidates = getCatalogMatchCandidates({ rawName: "Nivea крем для душа кокос" }, catalog, { limit: 3 });
  assert.ok(candidates[0].reasons.includes("multiple_catalog_sizes_review"));
  assert.notEqual(decision(candidates[0], candidates[1]), "auto");
});

test("same brand and volume but different package goes to review", () => {
  const candidate = best({ rawName: "Persil гель автомат лаванда пакет 1 л" });
  assert.equal(candidate.product.id, "persil-gel-bottle-1l");
  assert.ok(candidate.reasons.includes("packaging_mismatch_review"));
  assert.notEqual(decision(candidate), "auto");
});

test("partial OCR stays below auto threshold", () => {
  const candidates = getCatalogMatchCandidates({ rawName: "Ariel" }, catalog, { limit: 2 });
  assert.equal(decision(candidates[0], candidates[1]), "no candidate");
});

test("single-token alias key is not generated", () => {
  assert.equal(buildCatalogMatchKey({ rawName: "Ariel" }), "");
});
