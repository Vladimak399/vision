/**
 * Source Detection Module — TASK-21.1
 *
 * Выявление источников онлайн-мониторинга из списка конкурентов в БД.
 * Нормализует названия конкурентов и предлагает привязку к известным source_key.
 *
 * ВАЖНО: Production scrape разрешён только при legal_status = 'allowed'.
 */

import { createSupabaseServerClient } from "../../lib/supabase/server";
import { getPrimaryCompanyMembership } from "../primary-membership";

export type CompetitorFromDB = {
  id: string;
  name: string;
  createdAt: string;
};

export type StoreFromDB = {
  id: string;
  name: string;
  address: string | null;
  isOwn: boolean;
  competitorId: string | null;
};

export type SourceCandidate = {
  key: string;
  displayName: string;
  matchConfidence: "high" | "medium" | "low";
  sourceUrl: string;
  legalStatus: "pending" | "allowed" | "blocked";
  regionsAvailable: string[];
  notes: string;
};

type NormalizedSourceMapping = {
  sourceKey: string;
  patterns: readonly string[];
  baseUrl: string;
  legalStatus: "pending" | "allowed" | "blocked";
};

const SOURCE_MAPPINGS: NormalizedSourceMapping[] = [
  {
    sourceKey: "spar_online",
    patterns: ["спар", "spar"],
    baseUrl: "https://spar-online.ru/catalog/",
    legalStatus: "pending",
  },
  {
    sourceKey: "metro_online",
    patterns: ["метро", "metro"],
    baseUrl: "https://online.metro-cc.ru/category",
    legalStatus: "pending",
  },
  {
    sourceKey: "magnit",
    patterns: ["магнит", "magnit"],
    baseUrl: "https://magnit.ru/catalog",
    legalStatus: "pending",
  },
  {
    sourceKey: "x5_5ka",
    patterns: ["пятёрочка", "пятерочка", "5ка", "5ka", "x5"],
    baseUrl: "https://5ka.ru",
    legalStatus: "pending",
  },
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^а-яa-z0-9]/g, "")
    .replace(/пятерочка/g, "пятёрочка");
}

function isCompetitorOwn(store: StoreFromDB): boolean {
  return store.isOwn || store.competitorId === null;
}

export async function getCompetitors(): Promise<CompetitorFromDB[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("competitors")
    .select("id, name, created_at")
    .order("name", { ascending: true })
    .returns<Array<{ id: string; name: string; created_at: string }>>();

  if (error) {
    throw new Error(`Не удалось получить список конкурентов: ${error.message}`);
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.created_at,
  }));
}

export async function getStores(): Promise<StoreFromDB[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("stores")
    .select("id, name, address, is_own, competitor_id")
    .order("name", { ascending: true })
    .returns<
      Array<{
        id: string;
        name: string;
        address: string | null;
        is_own: boolean;
        competitor_id: string | null;
      }>
    >();

  if (error) {
    throw new Error(`Не удалось получить список магазинов: ${error.message}`);
  }

  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    isOwn: s.is_own,
    competitorId: s.competitor_id,
  }));
}

export async function detectSourceCandidates(): Promise<SourceCandidate[]> {
  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    throw new Error("Пользователь не имеет доступа к компании");
  }

  const competitors = await getCompetitors();
  const stores = await getStores();

  const competitorStores = stores.filter((s) => !isCompetitorOwn(s));

  const candidates: SourceCandidate[] = [];
  const seenKeys = new Set<string>();

  for (const store of competitorStores) {
    const normalized = normalizeName(store.name);

    for (const mapping of SOURCE_MAPPINGS) {
      for (const pattern of mapping.patterns) {
        const normalizedPattern = normalizeName(pattern);
        if (normalized.includes(normalizedPattern)) {
          if (!seenKeys.has(mapping.sourceKey)) {
            candidates.push({
              key: mapping.sourceKey,
              displayName: mapping.sourceKey.replace("_", " ").toUpperCase(),
              matchConfidence: "high",
              sourceUrl: mapping.baseUrl,
              legalStatus: mapping.legalStatus,
              regionsAvailable: [],
              notes: `Найден по названию магазина: ${store.name}`,
            });
            seenKeys.add(mapping.sourceKey);
          }
          break;
        }
      }
    }
  }

  for (const competitor of competitors) {
    const normalized = normalizeName(competitor.name);

    for (const mapping of SOURCE_MAPPINGS) {
      for (const pattern of mapping.patterns) {
        const normalizedPattern = normalizeName(pattern);
        if (normalized.includes(normalizedPattern)) {
          if (!seenKeys.has(mapping.sourceKey)) {
            candidates.push({
              key: mapping.sourceKey,
              displayName: mapping.sourceKey.replace("_", " ").toUpperCase(),
              matchConfidence: "medium",
              sourceUrl: mapping.baseUrl,
              legalStatus: mapping.legalStatus,
              regionsAvailable: [],
              notes: `Найден по названию конкурента: ${competitor.name}`,
            });
            seenKeys.add(mapping.sourceKey);
          }
          break;
        }
      }
    }
  }

  return candidates;
}

export function isSourceAllowed(legalStatus: string): boolean {
  return legalStatus === "allowed";
}

export async function getSourceInventory(): Promise<{
  competitors: CompetitorFromDB[];
  competitorStores: StoreFromDB[];
  sourceCandidates: SourceCandidate[];
}> {
  const competitors = await getCompetitors();
  const stores = await getStores();

  return {
    competitors,
    competitorStores: stores.filter((s) => !isCompetitorOwn(s)),
    sourceCandidates: [],
  };
}
