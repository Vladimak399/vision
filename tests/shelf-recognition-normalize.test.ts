import assert from "node:assert/strict";
import test from "node:test";

import { normalizeItem } from "../server/shelf-recognition/normalize";

test("normalizes valid price-tag bbox and ruble price", () => {
  const item = normalizeItem({
    bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
    confidence: 0.9,
    link_confidence: 0.85,
    name: "Молоко 1 л",
    price: "89,99",
  });

  assert.deepEqual(item.bbox, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
  assert.equal(item.price_minor, 8999);
});

test("rejects bbox outside normalized image bounds", () => {
  const item = normalizeItem({
    bbox: { x: 0.9, y: 0.2, width: 0.2, height: 0.1 },
    name: "Молоко",
  });

  assert.equal(item.bbox, null);
});

test("normalizes Gemini-style 0-1000 bbox", () => {
  const item = normalizeItem({
    bbox: { x_min: 120, y_min: 250, x_max: 480, y_max: 370 },
    name: "Молоко",
  });

  assert.deepEqual(item.bbox, { x: 0.12, y: 0.25, width: 0.36, height: 0.12 });
});
