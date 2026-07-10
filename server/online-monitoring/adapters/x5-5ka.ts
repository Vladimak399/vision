/**
 * X5 / 5ka Adapter — TASK-21.9
 *
 * Парсит каталог товаров с 5ka.ru (Пятёрочка)
 * 5ka.ru использует API для получения товаров
 * Требует установку магазина/города для корректных цен
 */

import { OnlineSourceAdapter, FetchCatalogInput, OnlineProductObservation } from "../types";
import { normalizePriceToMinor, normalizeBarcode, normalizeSizeText } from "../normalize";

const BASE_URL = "https://5ka.ru";
const API_BASE = "https://5ka.ru/api/v2";

/**
 * Структура 5ka.ru
 * - API каталогов: /api/v2/categories/
 * - API товаров: /api/v2/special_offers/ или /api/v2/products/
 * - Магазин выбирается через special_offers?store=xxx или headers
 * - Для конкретного магазина в Калининграде нужен store_id
 */

interface FiveKaApiResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any[];
  next?: string;
  count?: number;
  previous?: string | null;
}

// Основные категории 5ка
const FIVE_KA_CATEGORIES = [
  "produkty",           // Продукты
  "napitki",            // Напитки
  "alkogol",            // Алкоголь
  "bytovaya-himiya",    // Бытовая химия
  "gigiena-kosmetika",  // Гигиена и косметика
  "tovary-dlya-doma",   // Товары для дома
  "detskie-tovary",     // Детские товары
  "zootovary",          // Зоотовары
];

/**
 * X5 / 5ka Adapter
 */
export const x55kaAdapter: OnlineSourceAdapter = {
  key: "x5_5ka",
  parserVersion: "1.0.0",

  async *fetchCatalog(
    input: FetchCatalogInput
  ): AsyncIterable<OnlineProductObservation> {
    // Проверяем legal_status перед scrape

    const limit = input.limit ?? 100;
    let fetched = 0;

    // 5ka требует store_id для цен конкретного магазина
    const storeId = input.sourceStoreId; // store_id конкретного магазина Пятёрочки в Калининграде
    const headers = buildHeaders(storeId);

    // Сначала получаем список категорий через API
    const categories = await fetchCategories(headers);

    for (const category of categories) {
      if (fetched >= limit) break;

      try {
        const products = await fetchCategoryProducts(
          category.parent_group_code,
          limit - fetched,
          headers,
          storeId
        );
        for (const product of products) {
          fetched++;
          yield product;
        }
      } catch (error) {
        console.error(`5ka: Ошибка парсинга категории ${category.parent_group_code}:`, error);
      }
    }
  },
};

/**
 * Строит заголовки для API 5ka
 */
function buildHeaders(storeId?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "PriceVision-Bot 1.0 (monitoring)",
    "Accept": "application/json",
    "Accept-Language": "ru-RU,ru;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
  };

  // 5ka использует store в query params или cookie
  if (storeId) {
    headers["Cookie"] = `store=${storeId}; city=kaliningrad`;
  }

  return headers;
}

/**
 * Получает список категорий через API
 */
async function fetchCategories(headers: Record<string, string>): Promise<Array<{parent_group_code: string; parent_group_name: string}>> {
  try {
    const response = await fetch(`${API_BASE}/categories/`, { headers });
    if (!response.ok) {
      console.warn(`5ka: Categories API вернул ${response.status}, используем fallback`);
      return FIVE_KA_CATEGORIES.map(code => ({ parent_group_code: code, parent_group_name: code }));
    }
    const data = await response.json();
    // API возвращает массив категорий с parent_group_code
    return data?.categories ?? data ?? FIVE_KA_CATEGORIES.map(code => ({ parent_group_code: code, parent_group_name: code }));
  } catch (error) {
    console.warn("5ka: Ошибка получения категорий, используем fallback");
    return FIVE_KA_CATEGORIES.map(code => ({ parent_group_code: code, parent_group_name: code }));
  }
}

/**
 * Парсит категорию и возвращает список товаров
 */
async function fetchCategoryProducts(
  categoryCode: string,
  limit: number,
  headers: Record<string, string>,
  storeId?: string | null
): Promise<Array<OnlineProductObservation>> {
  const products: Array<OnlineProductObservation> = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && products.length < limit) {
    // 5ka API для товаров категории
    // Используем special_offers с фильтром по категории и магазину
    const url = new URL(`${API_BASE}/special_offers/`);
    url.searchParams.set("categories", categoryCode);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", "50");
    if (storeId) {
      url.searchParams.set("store", storeId);
    }

    try {
      const response = await fetch(url.toString(), { headers });

      if (!response.ok) {
        console.warn(`5ka: Категория ${categoryCode} страница ${page} вернула ${response.status}`);
        break;
      }

      const json = await response.json();
      const parsed = parseApiResponse(json);

      for (const item of parsed.products.slice(0, limit - products.length)) {
        products.push({
          sourceProductId: item.id,
          url: item.url,
          title: item.title,
          brand: item.brand,
          sizeText: normalizeSizeText(item.size),
          barcode: normalizeBarcode(item.barcode),
          priceMinor: item.priceMinor,
          oldPriceMinor: item.oldPriceMinor,
          promoPriceMinor: item.promoPriceMinor,
          availability: item.availability,
          observedAt: new Date(),
          rawPayloadHash: hashString(`${item.id}-${item.priceMinor}-${item.title}`),
        });
      }

      hasMore = parsed.hasMore;
      page++;

      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error) {
      console.error(`5ka: Ошибка fetch ${url}:`, error);
      break;
    }
  }

  return products;
}

/**
 * Результат парсинга API ответа
 */
type ParsedApiResult = {
  products: Array<{
    id: string;
    url: string;
    title: string;
    brand: string | null;
    size: string | null;
    barcode: string | null;
    priceMinor: bigint;
    oldPriceMinor: bigint | null;
    promoPriceMinor: bigint | null;
    availability: "in_stock" | "out_of_stock" | "unknown";
  }>;
  hasMore: boolean;
};

/**
 * Парсит JSON ответ от 5ka API
 */
function parseApiResponse(json: FiveKaApiResponse): ParsedApiResult {
  const products: ParsedApiResult["products"] = [];

  // 5ka API возвращает { results: [...], count: N, next: "url", previous: null }
  const items = json?.results ?? json?.items ?? json?.products ?? json?.data ?? [];

  if (!Array.isArray(items)) {
    return { products, hasMore: false };
  }

  for (const item of items) {
    // Товар может быть вложен в product
    const product = item.product ?? item;
    const id = product.id ?? product.sku ?? product.code ?? item.id;
    if (!id) continue;

    // Цены в 5ka: price (обычная), old_price (старая), promo_price (промо)
    const price = product.price ?? product.regular_price ?? product.current_price;
    const oldPrice = product.old_price ?? product.prev_price;
    const promoPrice = product.promo_price ?? product.discount_price ?? product.sale_price;

    const priceMinor = normalizePriceToMinor(price);
    const oldPriceMinor = oldPrice && oldPrice !== price ? normalizePriceToMinor(oldPrice) : null;
    const promoPriceMinor = promoPrice && promoPrice !== price ? normalizePriceToMinor(promoPrice) : null;

    // Наличие
    const availability = product.available === false || product.stock === 0
      ? "out_of_stock"
      : "in_stock";

    // URL товара
    const url = product.url ?? product.link ?? `${BASE_URL}/product/${id}/`;

    products.push({
      id: String(id),
      url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
      title: product.name ?? product.title ?? "",
      brand: product.brand ?? product.brand_name ?? null,
      size: product.size ?? product.weight ?? product.volume ?? product.unit ?? null,
      barcode: product.barcode ?? product.ean ?? product.gtin ?? product.upc ?? null,
      priceMinor,
      oldPriceMinor: oldPriceMinor && oldPriceMinor > BigInt(0) ? oldPriceMinor : null,
      promoPriceMinor: promoPriceMinor && promoPriceMinor > BigInt(0) ? promoPriceMinor : null,
      availability,
    });
  }

  const hasMore = !!json?.next;

  return { products, hasMore };
}

/**
 * Хеширует строку для rawPayloadHash
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export default x55kaAdapter;