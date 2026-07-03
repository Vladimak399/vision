export type UserRole = "admin" | "manager" | "reviewer";

export type SessionStatus = "draft" | "uploading" | "processing" | "review" | "completed" | "failed" | "cancelled";
export type PhotoStatus = "uploaded" | "queued" | "processing" | "processed" | "failed" | "expired";
export type ItemStatus = "recognized" | "matched" | "needs_review" | "unmatched" | "confirmed" | "rejected";
export type DecisionType = "auto" | "accepted" | "corrected" | "rejected";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type Money = {
  amountMinor: number;
  currency: string;
};

export type BBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CatalogProduct = {
  id: string;
  companyId: string;
  externalSku: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  ownPrice: Money | null;
  isActive: boolean;
};

export type MonitoringSession = {
  id: string;
  companyId: string;
  storeId: string;
  status: SessionStatus;
  startedAt: string | null;
  completedAt: string | null;
  version: number;
};

export type RecognizedItem = {
  id: string;
  companyId: string;
  sessionId: string;
  photoId: string;
  rawName: string;
  normalizedName: string | null;
  brand: string | null;
  sizeText: string | null;
  price: Money | null;
  confidence: number;
  bbox: BBox | null;
  status: ItemStatus;
};

export type MatchCandidate = {
  catalogProductId: string;
  score: number;
  decision: DecisionType;
};

export type AppStatus = "idle" | "loading" | "success" | "error";
