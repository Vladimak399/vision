import type { CatalogMatchCandidate } from "../catalog-matching";
import { runTextAiJson } from "./json-client";

export type AiCatalogMatchItem = {
  rawName: string | null;
  brand?: string | null;
  sizeText?: string | null;
  priceTagText?: string | null;
  productVisibleText?: string | null;
};

export type AiCatalogMatchDecision = {
  decision: "same_product" | "different_product" | "unsure";
  catalog_product_id: string | null;
  confidence: number;
  reason: string;
};

type AiCatalogMatchPayload = {
  decision?: string;
  catalog_product_id?: string | null;
  confidence?: number;
  reason?: string;
};

const SYSTEM_PROMPT = `
You help with retail competitor price monitoring in Russia.
Your task is to decide whether a recognized competitor shelf item matches one of our catalog products.

BUSINESS RULE (critical): flavor/aroma/taste does NOT matter for matching.
- "Milka with hazelnut Watermelon" and "Milka with hazelnut Peach" are the SAME product for monitoring.
- Ignore flavor/aroma words entirely (арбуз, персик, клубника, малина, вишня, лимон, лаванда, etc).
- Match by: brand + product type + size/weight + key physical variant (whole hazelnut vs cream filling etc).
- "Шоколад Милка ДВОЙНАЯ НАЧИНКА ВИШНЯ" matches a recognized "Milka Двойная начинка Миндаль и Клубника"
  because both are Milka chocolate with double filling — flavor (cherry vs almond+strawberry) is irrelevant.

Rules:
- Choose same_product when brand, product type, size/weight, and key variant are compatible.
- A different size or pack count is NOT the same product (90g vs 100g = different).
- A different brand is NOT the same product.
- Ignore: flavor, aroma, taste, pack quantity (1/10, 1/20), casing, transliteration (Milka=Милка), typos.
- If the recognized item is too generic (e.g. only brand, no product type) — return unsure.
- If NO candidate shares brand + product type — return different_product (item not in our catalog).
- Never invent a catalog product. Only choose from provided candidates.
- Return only JSON.

Allowed JSON shape:
{
  "decision": "same_product" | "different_product" | "unsure",
  "catalog_product_id": string | null,
  "confidence": number,
  "reason": string (in Russian)
}
`.trim();

export async function chooseCatalogMatchWithTextAi({
  item,
  candidates,
}: {
  item: AiCatalogMatchItem;
  candidates: CatalogMatchCandidate[];
}): Promise<AiCatalogMatchDecision> {
  if (candidates.length === 0) {
    return {
      decision: "unsure",
      catalog_product_id: null,
      confidence: 0,
      reason: "No local catalog candidates were provided.",
    };
  }

  const result = await runTextAiJson<AiCatalogMatchPayload>({
    system: SYSTEM_PROMPT,
    user: JSON.stringify({
      recognized_item: item,
      candidates: candidates.map((candidate) => ({
        catalog_product_id: candidate.product.id,
        name: candidate.product.name,
        brand: candidate.product.brand,
        size_text: candidate.product.size_text,
        local_score: candidate.score,
        local_reasons: candidate.reasons,
      })),
    }),
  });

  return normalizeDecision(result.data, candidates);
}

function normalizeDecision(payload: AiCatalogMatchPayload, candidates: CatalogMatchCandidate[]): AiCatalogMatchDecision {
  const allowedIds = new Set(candidates.map((candidate) => candidate.product.id));
  const decision = parseDecision(payload.decision);
  const candidateId = typeof payload.catalog_product_id === "string" ? payload.catalog_product_id : null;
  const confidence = clampConfidence(payload.confidence);
  const reason = typeof payload.reason === "string" && payload.reason.trim() ? payload.reason.trim() : "No reason returned.";

  if (decision !== "same_product") {
    return {
      decision,
      catalog_product_id: null,
      confidence,
      reason,
    };
  }

  if (!candidateId || !allowedIds.has(candidateId)) {
    return {
      decision: "unsure",
      catalog_product_id: null,
      confidence: 0,
      reason: "AI selected a catalog product outside the provided candidates.",
    };
  }

  return {
    decision,
    catalog_product_id: candidateId,
    confidence,
    reason,
  };
}

function parseDecision(value: unknown): AiCatalogMatchDecision["decision"] {
  if (value === "same_product" || value === "different_product" || value === "unsure") {
    return value;
  }

  return "unsure";
}

function clampConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
