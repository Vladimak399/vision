/**
 * Magnit Adapter — TASK-21.9
 *
 * Парсит каталог товаров с magnit.ru/catalog
 * Для Калининграда нужен выбор региона/магазина
 * Использует API или HTML парсинг
 */

import { OnlineSourceAdapter, FetchCatalogInput, OnlineProductObservation } from "../types";
import { normalizePriceToMinor, normalizeBarcode, normalizeSizeText } from "../normalize";

const BASE_URL = "https://magnit.ru";
const CATALOG_PATH = "/catalog";

/**
 * Структура каталога Магнит
 * - Категории: /catalog/{category}/
 * - API endpoints для получения товаров
 * - Требует установку региона через cookies/headers
 */

interface MagnitApiResponse {
  data?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items?: any[];
    has_more?: boolean;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  products?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results?: any[];
  has_more?: boolean;
  pagination?: {
    has_next?: boolean;
  };
}

// Основные категории Магнит
const MAGNIT_CATEGORIES = [
  "produkty",           // Продукты
  "napitki",            // Напитки
  "alkogol",            // Алкоголь
  "khimicheskie-sredstva", // Химия
  "gigiena-kosmetika",  // Гигиена и косметика
  "tovary-dlya-doma",   // Товары для дома
  "detskie-tovary",     // Детские товары
  "zootovary",          // Зоотовары
];

/**
 * Magnit Adapter
 */
export const magnitAdapter: OnlineSourceAdapter = {
  key: "magnit",
  parserVersion: "1.0.0",

  async *fetchCatalog(
    input: FetchCatalogInput
  ): AsyncIterable<OnlineProductObservation> {
    // Проверяем legal_status перед scrape
    // В MVP: только dev mode или когда legal_status = allowed

    const limit = input.limit ?? 100;
    let fetched = 0;

    // Магнит требует установки региона
    const regionHeaders = buildRegionHeaders(input.sourceCity);

    for (const category of MAGNIT_CATEGORIES) {
      if (fetched >= limit) break;

      try {
        const products = await fetchCategoryProducts(
          category,
          limit - fetched,
          regionHeaders
        );
        for (const product of products) {
          fetched++;
          yield product;
        }
      } catch (error) {
        console.error(`Magnit: Ошибка парсинга категории ${category}:`, error);
      }
    }
  },
};

/**
 * Строит заголовки для выбора региона/магазина
 */
function buildRegionHeaders(sourceCity?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "PriceVision-Bot 1.0 (monitoring)",
    "Accept": "application/json, text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru-RU,ru;q=0.9",
    "X-Requested-With": "XMLHttpRequest",
  };

  // Магнит использует cookie для региона
  // Калининград: region_id = 39 (примерный код)
  if (sourceCity === "kaliningrad") {
    headers["Cookie"] = "region_id=39; region_name=Калининград; city_id=39";
  }

  return headers;
}

/**
 * Парсит категорию и возвращает список товаров
 */
async function fetchCategoryProducts(
  category: string,
  limit: number,
  headers: Record<string, string>
): Promise<Array<OnlineProductObservation>> {
  const products: Array<OnlineProductObservation> = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && products.length < limit) {
    // Пробуем API endpoint сначала
    const apiUrl = `${BASE_URL}${CATALOG_PATH}/${category}/?page=${page}&limit=60&format=json`;

    try {
      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        // Fallback на HTML
        const htmlUrl = `${BASE_URL}${CATALOG_PATH}/${category}/?page=${page}`;
        const htmlResponse = await fetch(htmlUrl, {
          headers: { ...headers, "Accept": "text/html" }
        });

        if (!htmlResponse.ok) {
          console.warn(`Magnit: Категория ${category} страница ${page} вернула ${htmlResponse.status}`);
          break;
        }

        const html = await htmlResponse.text();
        const parsed = parseCategoryHtml(html, category);

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
        await sleep(500);
        continue;
      }

      // Парсим JSON ответ
      const json = await response.json();
      const parsed = parseApiResponse(json, category);

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
      await sleep(300);
    } catch (error) {
      console.error(`Magnit: Ошибка fetch ${apiUrl}:`, error);
      break;
    }
  }

  return products;
}

/**
 * Результат парсинга
 */
type ParsedResult = {
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
 * Парсит JSON ответ от API Магнит
 */
function parseApiResponse(json: MagnitApiResponse, category: string): ParsedResult {
  const products: ParsedResult["products"] = [];

  // Магнит может возвращать разные структуры
  // Попробуем разные варианты
  let items = json?.data?.items
    ?? json?.products
    ?? json?.items
    ?? json?.results
    ?? [];

  if (!Array.isArray(items)) {
    items = [];
  }

  for (const item of items) {
    const id = item.id || item.product_id || item.sku || item.offer_id;
    if (!id) continue;

    // Цены могут быть в разных полях
    const price = item.price?.value ?? item.price ?? item.regular_price ?? item.current_price;
    const oldPrice = item.price?.old_value ?? item.old_price ?? item.regular_price;
    const promoPrice = item.price?.promo_value ?? item.promo_price ?? item.discount_price;

    const priceMinor = normalizePriceToMinor(price);
    const oldPriceMinor = oldPrice && oldPrice !== price ? normalizePriceToMinor(oldPrice) : null;
    const promoPriceMinor = promoPrice && promoPrice !== price ? normalizePriceToMinor(promoPrice) : null;

    const availability = item.available === false || item.stock === 0
      ? "out_of_stock"
      : "in_stock";

    products.push({
      id: String(id),
      url: item.url || item.link || `${BASE_URL}/product/${id}/`,
      title: item.name || item.title || item.product_name || "",
      brand: item.brand || item.brand_name || null,
      size: item.size || item.weight || item.volume || item.package || null,
      barcode: item.barcode || item.ean || item.gtin || item.upc || null,
      priceMinor,
      oldPriceMinor: oldPriceMinor && oldPriceMinor > BigInt(0) ? oldPriceMinor : null,
      promoPriceMinor: promoPriceMinor && promoPriceMinor > BigInt(0) ? promoPriceMinor : null,
      availability,
    });
  }

  const hasMore = json?.data?.has_more ?? json?.has_more ?? json?.pagination?.has_next ?? false;

  return { products, hasMore };
}

/**
 * Парсит HTML категории (fallback)
 */
function parseCategoryHtml(html: string, category: string): ParsedResult {
  const products: ParsedResult["products"] = [];

  // Ищем JSON данные в script тегах
  const scriptMatches = html.matchAll(
    /<script[^>]*type=["']application\/json["'][^>]*>([^<]+)<\/script>/gi
  );

  for (const match of scriptMatches) {
    try {
      const jsonData = JSON.parse(match[1]);
      if (jsonData?.products || jsonData?.items || jsonData?.data?.items) {
        return parseApiResponse(jsonData, category);
      }
    } catch {
      // игнорируем ошибки парсинга
    }
  }

  // Ищем в __NUXT__ или __NEXT_DATA__ (Nuxt/Next.js)
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});/);
  const nextMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([^<]+)<\/script>/);

  if (nuxtMatch) {
    try {
      const data = JSON.parse(nuxtMatch[1]);
      const state = data?.state || data?.data?.[0];
      if (state?.catalog?.products) {
        return parseApiResponse(state.catalog, category);
      }
    } catch {}
  }

  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const items = data?.props?.pageProps?.initialState?.catalog?.products?.items
        ?? data?.props?.pageProps?.products;
      if (items) {
        return parseApiResponse({ items }, category);
      }
    } catch {}
  }

  // Fallback: парсим HTML карточки товаров
  const cardRegex = /<div[^>]*class=["'][^"']*product[^"']*["'][^>]*data-id=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null) {
    const id = match[1];
    const cardHtml = html.slice(match.index);
    const cardEnd = cardHtml.indexOf('</div>');
    const card = cardEnd > 0 ? cardHtml.slice(0, cardEnd + 6) : cardHtml;

    const titleMatch = card.match(/<[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>([^<]+)</i)
      || card.match(/title=["']([^"']+)["']/)
      || card.match(/alt=["']([^"']+)["']/);

    const priceMatch = card.match(/data-price=["']([^"']+)["']/)
      || card.match(/<[^>]*class=["'][^"']*price[^"']*["'][^>]*>([^<]+)</i);

    const oldPriceMatch = card.match(/data-old-price=["']([^"']+)["']/)
      || card.match(/<[^>]*class=["'][^"']*old-price[^"']*["'][^>]*>([^<]+)</i);

    const promoPriceMatch = card.match(/data-promo-price=["']([^"']+)["']/)
      || card.match(/<[^>]*class=["'][^"']*promo-price[^"']*["'][^>]*>([^<]+)</i);

    const barcodeMatch = card.match(/data-barcode=["']([^"']+)["']/)
      || card.match(/data-ean=["']([^"']+)["']/)
      || card.match(/data-gtin=["']([^"']+)["']/);

    const urlMatch = card.match(/href=["']([^"']+)["']/);

    const availability = /out-of-stock|Нет в наличии|unavailable/i.test(card)
      ? "out_of_stock"
      : "in_stock";

    if (!id || !titleMatch || !priceMatch) continue;

    const priceMinor = normalizePriceToMinor(priceMatch[1]);
    const oldPriceMinor = oldPriceMatch ? normalizePriceToMinor(oldPriceMatch[1]) : null;
    const promoPriceMinor = promoPriceMatch ? normalizePriceToMinor(promoPriceMatch[1]) : null;

    products.push({
      id,
      url: urlMatch ? (urlMatch[1].startsWith("http") ? urlMatch[1] : `${BASE_URL}${urlMatch[1]}`) : `${BASE_URL}/product/${id}/`,
      title: titleMatch[1],
      brand: null,
      size: null,
      barcode: barcodeMatch?.[1] ?? null,
      priceMinor,
      oldPriceMinor: oldPriceMinor && oldPriceMinor > BigInt(0) ? oldPriceMinor : null,
      promoPriceMinor: promoPriceMinor && promoPriceMinor > BigInt(0) ? promoPriceMinor : null,
      availability,
    });
  }

  const hasMore = /pagination|load-more|has-more|Следующая/i.test(html);

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

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default magnitAdapter;