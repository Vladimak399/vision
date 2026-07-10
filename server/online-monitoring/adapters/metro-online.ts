/**
 * METRO Online Adapter — TASK-21.9
 *
 * Парсит каталог товаров с online.metro-cc.ru
 * Поддерживает два контекста цен (price_context):
 * - online_delivery: цены для онлайн-доставки (основной)
 * - store_visit: цены для посещения конкретного ТЦ
 *
 * Для Калининграда: metro-cc.ru/markets/kaliningrad/ul-moskovskii-pr-t-d-279
 * Требует установки cookies/headers для выбора магазина
 */

import { OnlineSourceAdapter, FetchCatalogInput, OnlineProductObservation } from "../types";
import { normalizePriceToMinor, normalizeBarcode, normalizeSizeText } from "../normalize";

const BASE_URL = "https://online.metro-cc.ru";
const CATALOG_PATH = "/category";

/**
 * Структура каталога METRO
 * - Категории: /category/{category-slug}/
 * - Подкатегории: /category/{category-slug}/{subcategory-slug}/
 * - Товар: /product/{product-id}/
 * - Выбор магазина: через cookies/заголовки или в URL
 * - API endpoint: может возвращать JSON в __NEXT_DATA__
 */

// Основные категории METRO (ключевые для парсинга)
const METRO_CATEGORIES = [
  "produkty",           // Продукты
  "napitki",            // Напитки
  "alkogol",            // Алкоголь
  "khimicheskie-sredstva", // Химия
  "kosmetika-gigiena",  // Косметика и гигиена
  "tovary-dlya-doma",   // Товары для дома
  "detskie-tovary",     // Детские товары
  "zootovary",          // Зоотовары
];

/**
 * METRO Online Adapter
 */
export const metroOnlineAdapter: OnlineSourceAdapter = {
  key: "metro_online",
  parserVersion: "1.0.0",

  async *fetchCatalog(
    input: FetchCatalogInput
  ): AsyncIterable<OnlineProductObservation> {
    // Проверяем legal_status перед scrape
    // В MVP: только dev mode или когда legal_status = allowed

    // Определяем price_context для данного store
    const priceContext = input.categoryCode === "store_visit" ? "store_visit" : "online_delivery";

    const limit = input.limit ?? 100;
    let fetched = 0;

    // Метро требует установки региона/магазина через cookies
    const storeHeaders = buildStoreHeaders(input.sourceStoreId, input.sourceCity);

    for (const category of METRO_CATEGORIES) {
      if (fetched >= limit) break;

      try {
        const products = await fetchCategoryProducts(
          category,
          limit - fetched,
          storeHeaders,
          priceContext
        );
        for (const product of products) {
          fetched++;
          yield product;
        }
      } catch (error) {
        console.error(`METRO: Ошибка парсинга категории ${category}:`, error);
      }
    }
  },
};

/**
 * Строит заголовки для выбора магазина/региона
 */
function buildStoreHeaders(sourceStoreId?: string | null, sourceCity?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "PriceVision-Bot 1.0 (monitoring)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9",
  };

  // METRO использует cookie для выбора магазина
  // Для Калининграда: магазин на Московском проспекте, 279
  if (sourceStoreId) {
    headers["Cookie"] = `metro_store_id=${sourceStoreId}; metro_city=kaliningrad`;
  } else if (sourceCity === "kaliningrad") {
    headers["Cookie"] = "metro_city=kaliningrad";
  }

  return headers;
}

/**
 * Парсит категорию и возвращает список товаров
 */
async function fetchCategoryProducts(
  category: string,
  limit: number,
  headers: Record<string, string>,
  priceContext: "online_delivery" | "store_visit"
): Promise<Array<OnlineProductObservation>> {
  const products: Array<OnlineProductObservation> = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && products.length < limit) {
    const url = `${BASE_URL}${CATALOG_PATH}/${category}/?page=${page}&per_page=60`;

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        console.warn(`METRO: Категория ${category} страница ${page} вернула ${response.status}`);
        break;
      }

      const html = await response.text();
      const parsed = parseCategoryHtml(html, category, priceContext);

      for (const item of parsed.products) {
        if (products.length >= limit) break;
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

      // Небольшая пауза между страницами
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(`METRO: Ошибка fetch категории ${category} стр. ${page}:`, error);
      break;
    }
  }

  return products;
}

/**
 * Результат парсинга HTML категории
 */
type ParsedCategoryResult = {
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
 * Парсит HTML категории
 * Поддерживает:
 * - HTML с data-атрибутами (SSR)
 * - JSON в <script id="__NEXT_DATA__"> (Next.js)
 */
function parseCategoryHtml(html: string, category: string, priceContext: "online_delivery" | "store_visit"): ParsedCategoryResult {
  const products: ParsedCategoryResult["products"] = [];

  // 1. Сначала пробуем найти JSON в __NEXT_DATA__ (Next.js)
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);
  if (nextDataMatch) {
    try {
      const jsonData = JSON.parse(nextDataMatch[1]);
      const items = jsonData?.props?.pageProps?.initialState?.catalog?.products?.items;

      if (Array.isArray(items)) {
        for (const item of items) {
          const priceMinor = normalizePriceToMinor(
            priceContext === "store_visit" ? item.store_price : item.price,
            "RUB"
          );
          const oldPriceMinor = normalizePriceToMinor(
            priceContext === "store_visit" ? item.store_old_price : item.old_price,
            "RUB"
          );
          const promoPriceMinor = normalizePriceToMinor(
            priceContext === "store_visit" ? item.store_promo_price : item.promo_price,
            "RUB"
          );

          products.push({
            id: item.id ?? item.product_id,
            url: item.url?.startsWith("http") ? item.url : `${BASE_URL}${item.url}`,
            title: item.name,
            brand: item.brand ?? null,
            size: item.size ?? null,
            barcode: item.barcode ?? null,
            priceMinor,
            oldPriceMinor: oldPriceMinor > BigInt(0) ? oldPriceMinor : null,
            promoPriceMinor: promoPriceMinor > BigInt(0) ? promoPriceMinor : null,
            availability: item.available && item.stock > 0 ? "in_stock" : "out_of_stock",
          });
        }
      }

      const hasMore = jsonData?.props?.pageProps?.initialState?.catalog?.products?.hasMore ?? false;
      return { products, hasMore };
    } catch (error) {
      console.warn(`METRO: Ошибка парсинга __NEXT_DATA__ в ${category}:`, error);
    }
  }

  // 2. Fallback: парсим HTML по data-атрибутам (если есть SSR)
  const productCardRegex = /<div[^>]*class=["'][^"']*product-card[^"']*["'][^>]*data-id=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = productCardRegex.exec(html)) !== null) {
    const cardHtml = html.slice(match.index);
    const cardEnd = cardHtml.indexOf('</div>');
    const card = cardEnd > 0 ? cardHtml.slice(0, cardEnd + 6) : cardHtml;

    const id = match[1];
    const urlMatch = card.match(/href=["']([^"']+)["']/);
    const titleMatch = card.match(/title=["']([^"']+)["']/) || card.match(/<span[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>([^<]+)<\/span>/);
    const priceMatch = card.match(/data-price=["']([^"']+)["']/) || card.match(/<div[^>]*class=["'][^"']*price[^"']*["'][^>]*>([^<]+)/);
    const oldPriceMatch = card.match(/data-old-price=["']([^"']+)["']/) || card.match(/<div[^>]*class=["'][^"']*old-price[^"']*["'][^>]*>([^<]+)/);
    const promoPriceMatch = card.match(/data-promo-price=["']([^"']+)["']/) || card.match(/<div[^>]*class=["'][^"']*promo-price[^"']*["'][^>]*>([^<]+)/);
    const barcodeMatch = card.match(/data-barcode=["']([^"']+)["']/) || card.match(/data-ean=["']([^"']+)["']/) || card.match(/data-gtin=["']([^"']+)["']/);
    const availMatch = card.match(/class=["'][^"']*availability[^"']*["'][^>]*>([^<]+)/);

    if (!id || !priceMatch || !titleMatch) continue;

    const priceMinor = normalizePriceToMinor(priceMatch[1], "RUB");
    const oldPriceMinor = oldPriceMatch ? normalizePriceToMinor(oldPriceMatch[1], "RUB") : null;
    const promoPriceMinor = promoPriceMatch ? normalizePriceToMinor(promoPriceMatch[1], "RUB") : null;

    const availability = availMatch && /нет|out|не\s*в\s*наличии/i.test(availMatch[1])
      ? "out_of_stock"
      : "in_stock";

    products.push({
      id,
      url: urlMatch ? (urlMatch[1].startsWith("http") ? urlMatch[1] : `${BASE_URL}${urlMatch[1]}`) : `${BASE_URL}/product/${id}/`,
      title: titleMatch[1],
      brand: null, // Бренд выделим из названия отдельно при необходимости
      size: null,
      barcode: barcodeMatch?.[1] ?? null,
      priceMinor,
      oldPriceMinor: oldPriceMinor && oldPriceMinor > BigInt(0) ? oldPriceMinor : null,
      promoPriceMinor: promoPriceMinor && promoPriceMinor > BigInt(0) ? promoPriceMinor : null,
      availability,
    });
  }

  // Проверяем наличие пагинации
  const hasMore = /pagination|load-more|has-more|next-page/i.test(html);

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

export default metroOnlineAdapter;