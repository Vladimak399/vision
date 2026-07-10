/**
 * Adapter Registry for Online Monitoring — TASK-21.3
 *
 * Реестр адаптеров для онлайн-источников.
 * Позволяет регистрировать и получать адаптеры по source_key.
 */

import type { OnlineSourceAdapter, FetchCatalogInput } from "./types";

// Регистрация адаптеров при импорте
import sparOnlineAdapter from "./adapters/spar-online";
import metroOnlineAdapter from "./adapters/metro-online";
import magnitAdapter from "./adapters/magnit";
import x55kaAdapter from "./adapters/x5-5ka";

type AdapterRegistryEntry = {
  adapter: OnlineSourceAdapter;
  enabled: boolean;
};

const registry = new Map<string, AdapterRegistryEntry>();

/**
 * Register an adapter for a source key.
 * Используется адаптерами при инициализации модуля.
 */
export function registerAdapter(adapter: OnlineSourceAdapter, enabled = true): void {
  registry.set(adapter.key, { adapter, enabled });
}

/**
 * Get a registered adapter by source key.
 * Returns undefined if not registered or disabled.
 */
export function getAdapter(
  sourceKey: "spar_online" | "metro_online" | "magnit" | "x5_5ka"
): OnlineSourceAdapter | undefined {
  const entry = registry.get(sourceKey);
  if (!entry || !entry.enabled) {
    return undefined;
  }
  return entry.adapter;
}

/**
 * Check if an adapter is registered and enabled.
 */
export function isAdapterAvailable(
  sourceKey: "spar_online" | "metro_online" | "magnit" | "x5_5ka"
): boolean {
  return getAdapter(sourceKey) !== undefined;
}

/**
 * Get all registered adapter keys.
 */
export function getRegisteredKeys(): string[] {
  return Array.from(registry.keys());
}

/**
 * Get all enabled adapter keys.
 */
export function getEnabledKeys(): string[] {
  return Array.from(registry.entries())
    .filter(([, entry]) => entry.enabled)
    .map(([key]) => key);
}

/**
 * Iterate over all enabled adapters.
 * Возвращает AsyncIterable, который можно использовать в цикле for await...of.
 */
export async function* iterateEnabledAdapters(): AsyncIterable<{
  key: string;
  fetchCatalog: (input: FetchCatalogInput) => AsyncIterable<import("./types").OnlineProductObservation>;
}> {
  for (const [key, entry] of registry.entries()) {
    if (entry.enabled) {
      yield {
        key,
        fetchCatalog: entry.adapter.fetchCatalog.bind(entry.adapter),
      };
    }
  }
}