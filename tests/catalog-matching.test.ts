import assert from "node:assert/strict";
import test from "node:test";

import { getCatalogMatchCandidates, normalizeSize, tokenizeForMatch } from "../server/catalog-matching";

const products = [
  { id: "1", name: "Яшкино вафли голландские с карамелью 290 г коробка", brand: "Яшкино", size_text: "290 г", is_active: true },
  { id: "2", name: "Яшкино вафли голландские с карамелью 140 г коробка", brand: "Яшкино", size_text: "140 г", is_active: true },
  { id: "3", name: "Milka шоколад молочный 90 г", brand: "Milka", size_text: "90 г", is_active: true },
  { id: "4", name: "Milka шоколад клубника 90 г", brand: "Milka", size_text: "90 г", is_active: true },
  { id: "5", name: "Мартин семечки полосатые с морской солью 200 г пакет", brand: "Мартин", size_text: "200 г", is_active: true },
  { id: "6", name: "Мартин семечки полосатые с морской солью 100 г пакет", brand: "Мартин", size_text: "100 г", is_active: true },
  { id: "7", name: "Мартин семечки полосатые с морской солью 200 г банка", brand: "Мартин", size_text: "200 г", is_active: true },
];

test("нормализует русские токены и размеры", () => {
  assert.equal(normalizeSize("0,2 кг"), "200g");
  assert.equal(normalizeSize("900 мл"), "900ml");
  assert.deepEqual(tokenizeForMatch("Семечки солёные 200г").filter((t) => ["семечка", "соленый", "200g"].includes(t)).length >= 2, true);
});

test("находит точный товар с учетом бренда и веса", () => {
  const [best] = getCatalogMatchCandidates({ rawName: "Яшкино вафли голландские карамель 290 г" }, products);
  assert.equal(best.product.id, "1");
  assert.ok(best.score >= 0.8);
  assert.ok(best.reasons.includes("size"));
});

test("не сопоставляет только по одному слову", () => {
  const candidates = getCatalogMatchCandidates({ rawName: "вафли" }, products);
  assert.equal(candidates.length, 0);
});

test("штрафует разные объемы одного бренда", () => {
  const candidates = getCatalogMatchCandidates({ rawName: "Мартин семечки полосатые морская соль 100 г пакет" }, products);
  assert.equal(candidates[0].product.id, "6");
  assert.ok(candidates[0].score > (candidates.find((c) => c.product.id === "5")?.score ?? 0));
});

test("учитывает упаковку одного товара", () => {
  const candidates = getCatalogMatchCandidates({ rawName: "Мартин семечки полосатые морская соль 200 г банка" }, products);
  assert.equal(candidates[0].product.id, "7");
  assert.ok(candidates[0].reasons.includes("package"));
});

test("допускает другой аромат той же базовой позиции как кандидат на проверку", () => {
  const [best] = getCatalogMatchCandidates({ rawName: "Milka шоколад ваниль 90 г" }, products);
  assert.ok(best);
  assert.equal(best.product.brand, "Milka");
  assert.ok(best.reasons.includes("different_variant_same_base_review") || best.reasons.includes("product_family"));
});

test("отказывается от слабого совпадения", () => {
  const candidates = getCatalogMatchCandidates({ rawName: "неизвестный товар конкурента 500 мл" }, products);
  assert.equal(candidates.length, 0);
});
