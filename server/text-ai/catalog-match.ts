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
You help with retail competitor monitoring.
Your task is to decide whether a recognized competitor shelf item matches one of our catalog products.

Rules:
- Choose same_product only when brand, product type, size, and key variant are compatible.
- A different flavor or aroma may still be acceptable only when the business rule says flavor should not block price monitoring.
- A different size or pack count is not the same product.
- A different brand is not the same product.
- If evidence is weak or ambiguous, return unsure.
- Never invent a catalog product.
- Return only JSON.

Allowed JSON shape:
{
  "decision": "same_product" | "different_product" | "unsure",
  "catalog_product_id": string | null,
  "confidence": number,
  "reason": string
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
