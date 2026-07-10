import { createSupabaseServiceRoleClient } from "../lib/supabase/service-role";

type Week = 1 | 2;

/**
 * Режим получения цен для экспорта.
 * - photo_only: только фото-данные из competitor_shelf_items
 * - online_only: только онлайн-цены из online_prices
 * - online_preferred: онлайн + fallback на фото
 * - latest: объединённые цены (самое свежее наблюдение)
 */
export type PriceObservationMode = "photo_only" | "online_only" | "online_preferred" | "latest";

export type PriceObservation = {
  catalogProductId: string;
  storeId: string;
  priceMinor: number;
  source: "photo" | "online";
  observedAt: string | null;
};

export type PriceObservationMap = Map<string, Map<string, PriceObservation>>;

/**
 * Загружает последние цены по выбранному режиму.
 * Возвращает Map<catalog_product_id, Map<store_id, PriceObservation>>
 */
export async function getLatestPrices(
  companyId: string,
  week: Week,
  mode: PriceObservationMode = "latest",
): Promise<PriceObservationMap> {
  const supabase = createSupabaseServiceRoleClient();
  const priceMap: PriceObservationMap = new Map();

  if (mode === "online_only" || mode === "online_preferred" || mode === "latest") {
    const { data: onlinePrices } = await supabase
      .from("online_prices")
      .select("catalog_product_id, store_id, price_minor, observed_at")
      .eq("company_id", companyId)
      .not("catalog_product_id", "is", null)
      .not("price_minor", "is", null)
      .order("observed_at", { ascending: false });

    if (onlinePrices) {
      for (const row of onlinePrices) {
        if (priceMap.get(row.catalog_product_id)?.has(row.store_id)) continue;

        const storeMap = priceMap.get(row.catalog_product_id) ?? new Map();
        storeMap.set(row.store_id, {
          catalogProductId: row.catalog_product_id,
          storeId: row.store_id,
          priceMinor: Number(row.price_minor),
          source: "online",
          observedAt: row.observed_at,
        });
        priceMap.set(row.catalog_product_id, storeMap);
      }
    }
  }

  if (mode === "photo_only" || mode === "latest" || mode === "online_preferred") {
    const { data: photoPrices } = await supabase
      .from("competitor_shelf_items")
      .select("catalog_product_id, store_id, price_minor, captured_date")
      .eq("company_id", companyId)
      .eq("week", week)
      .not("catalog_product_id", "is", null)
      .not("price_minor", "is", null)
      .order("captured_date", { ascending: false });

    if (photoPrices) {
      for (const row of photoPrices) {
        if (!row.catalog_product_id) continue;

        // В режиме online_preferred не перезаписываем онлайн-цены
        if (mode === "online_preferred" && priceMap.get(row.catalog_product_id)?.has(row.store_id)) continue;

        const storeMap = priceMap.get(row.catalog_product_id) ?? new Map();
        if (storeMap.has(row.store_id)) continue;

        storeMap.set(row.store_id, {
          catalogProductId: row.catalog_product_id,
          storeId: row.store_id,
          priceMinor: Number(row.price_minor),
          source: "photo",
          observedAt: row.captured_date,
        });
        priceMap.set(row.catalog_product_id, storeMap);
      }
    }
  }

  return priceMap;
}