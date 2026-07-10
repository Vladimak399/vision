/**
 * Types for Online Monitoring Module — TASK-21.1
 */

export type OnlineSourceAdapter = {
  key: "spar_online" | "metro_online" | "magnit" | "x5_5ka";
  parserVersion: string;
  fetchCatalog(input: FetchCatalogInput): AsyncIterable<OnlineProductObservation>;
};

export type FetchCatalogInput = {
  companyId: string;
  storeId: string;
  sourceStoreId?: string | null;
  sourceCity?: string | null;
  categoryCode?: string;
  limit?: number;
};

export type OnlineProductObservation = {
  sourceProductId: string;
  url: string;
  title: string;
  brand: string | null;
  sizeText: string | null;
  barcode: string | null;
  priceMinor: bigint;
  oldPriceMinor: bigint | null;
  promoPriceMinor: bigint | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  observedAt: Date;
  rawPayloadHash: string;
};

export type OnlineSourceStatus = "pending" | "allowed" | "blocked";

/**
 * Run statistics for online source parsing
 */
export type RunStats = {
  fetched: number;
  productsUpserted: number;
  pricesInserted: number;
  matched: number;
  unmatched: number;
  errors: number;
};

/**
 * Run trigger types
 */
export type RunTrigger = "cron" | "manual" | "retry";

/**
 * Run status types
 */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/**
 * Event level for run logging
 */
export type RunEventLevel = "info" | "warn" | "error";

/**
 * Online source run record
 */
export type OnlineSourceRun = {
  id: string;
  companyId: string;
  sourceId: string;
  sourceStoreId: string | null;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  parserVersion: string;
  stats: RunStats;
  errorSummary: string | null;
};

/**
 * Run event record
 */
export type OnlineSourceRunEvent = {
  id: string;
  companyId: string;
  runId: string;
  level: RunEventLevel;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type SourceCandidate = {
  key: string;
  displayName: string;
  matchConfidence: "high" | "medium" | "low";
  sourceUrl: string;
  legalStatus: OnlineSourceStatus;
  regionsAvailable: string[];
  notes: string;
};
