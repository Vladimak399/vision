/**
 * SPAR Online Adapter — TASK-21.4
 *
 * Парсит каталог товаров с spar-online.ru/catalog/
 * Использует fetch для HTML + Playwright fallback при необходимости
 */

import { OnlineSourceAdapter, FetchCatalogInput, OnlineProductObservation } from "../types";
import { normalizePriceToMinor, normalizeBarcode, normalizeSizeText } from "../normalize";

const BASE_URL = "https://spar-online.ru";
const CATALOG_PATH = "/catalog/";

/**
 * Структура каталога SPAR
 * - Категории: /catalog/{category}/
 * - Подкатегории: /catalog/{category}/{subcategory}/
 * - Товар: /product/{id}/ или /catalog/{id}/
 */

// Категории SPAR (ключевые для парсинга)
const SPAR_CATEGORIES = [
  "bakaleya", // Бакалея
  "ovoshchi-frukty", // Овощи и фрукты
  "moloko-yogurt", // Молоко и йогурты
  "syomga", // Сыры и колбасы
  "chay-kofe", // Чай и кофе
  "sladosti", // Сладости
  "napitki", // Напитки
  "khimия", // Химия (для мониторинга)
];

/**
 * SPAR Online Adapter
 */
export const sparOnlineAdapter: OnlineSourceAdapter = {
  key: "spar_online",
  parserVersion: "1.0.0",

  async *fetchCatalog(
    input: FetchCatalogInput
  ): AsyncIterable<OnlineProductObservation> {
    // Проверяем legal_status перед scrape (заглушка - в реальном коде проверяем БД)
    // В MVP: только dev mode или когда legal_status = allowed

    const limit = input.limit ?? 100;
    let fetched = 0;

    for (const category of SPAR_CATEGORIES) {
      if (fetched >= limit) break;

      try {
        const products = await fetchCategoryProducts(category, limit - fetched);
        for (const product of products) {
          fetched++;
          yield product;
        }
      } catch (error) {
        // Логируем ошибку, но не останавливаем парсинг
        console.error(`SPAR: Ошибка парсинга категории ${category}:`, error);
      }
    }
  },
};

/**
 * Парсит категорию и возвращает список товаров
 */
async function fetchCategoryProducts(
  category: string,
  limit: number
): Promise<Array<OnlineProductObservation>> {
  const products: Array<OnlineProductObservation> = [];
  const url = `${BASE_URL}${CATALOG_PATH}${category}/`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PriceVision-Bot 1.0 (monitoring)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9",
      },
    });

    if (!response.ok) {
      console.warn(`SPAR: Категория ${category} вернула ${response.status}`);
      return products;
    }

    const html = await response.text();
    const parsed = parseCategoryHtml(html, category);

    for (const item of parsed.products.slice(0, limit)) {
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

    // TODO: Обработка pagination
    // if (parsed.hasMore && products.length < limit) {
    //   // Рекурсивно парсим следующую страницу
    // }
  } catch (error) {
    // Если fetch не сработал, пробуем Playwright fallback
    console.warn(`SPAR: fetch не удался, пробуем Playwright fallback`);
    // return fetchCategoryProductsWithPlaywright(category, limit);
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
 * Парсит HTML категории (без Playwright)
 * Ищет data-атрибуты и JSON встроенный в страницу
 */
function parseCategoryHtml(html: string, category: string): ParsedCategoryResult {
  const products: ParsedCategoryResult["products"] = [];

  // SPAR использует Vue/React - ищем initial state или JSON в script
  // Пример: window.__INITIAL_STATE__ или data-атрибуты

  // Попытка найти JSON в script тегах
  const scriptMatch = html.match(
    /<script[^>]*type=["']application\/json["'][^>]*>([^<]+)<\/script>/
  );

  if (scriptMatch) {
    try {
      const jsonData = JSON.parse(scriptMatch[1]);
      // TODO: Разобрать структуру данных SPAR
      console.log(`SPAR: Found JSON data in ${category}`);
    } catch {
      // JSON не валиден, используем fallback
    }
  }

  // Парсим товары по селекторам (если есть SSR)
  const productMatches = html.matchAll(
    /<div[^>]*class=["'][^"']*product[^"']*["'][^>]*data-id=["']([^"']+)["][^>]*data-price=["']([^"']+)["][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["][^>]*title=["']([^"']+)["]/gi
  );

  for (const match of productMatches) {
    const id = match[1];
    const priceStr = match[2];
    const productUrl = match[3];
    const title = match[4];

    const priceMinor = normalizePriceToMinor(priceStr, "RUB");

    products.push({
      id,
      url: productUrl.startsWith("http") ? productUrl : `${BASE_URL}${productUrl}`,
      title,
      brand: null, // TODO: extract from title
      size: null, // TODO: extract from title or data-size
      barcode: null, // TODO: extract from data-barcode or page
      priceMinor,
      oldPriceMinor: null,
      promoPriceMinor: null,
      availability: "in_stock", // TODO: extract from data-availability
    });
  }

  // Проверяем наличие pagination
  const hasMore = /pagination|load-more|has-more/i.test(html);

  return { products, hasMore };
}

/**
 * Хеширует строку для rawPayloadHash
 * В реальном коде используем crypto или xxhash
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/**
 * Playwright fallback для динамических страниц
 * В реальном коде используем @playwright/test или playwright
 */
async function fetchCategoryProductsWithPlaywright(
  category: string,
  limit: number
): Promise<OnlineProductObservation[]> {
  // Placeholder для Playwright реализации
  // В MVP: вынесем в отдельный worker с headless browser

  // Пример структуры:
  // const browser = await chromium.launch();
  // const page = await browser.newPage();
  // await page.goto(url);
  // const products = await page.$$eval('.product-card', cards => ...);
  // await browser.close();

  return [];
}

export default sparOnlineAdapter;