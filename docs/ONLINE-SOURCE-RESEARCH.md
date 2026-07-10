# Online Source Research — Legal Audit & Inventory

**Дата:** 2026-07-09
**Задача:** TASK-21.1 — Source inventory и legal audit

---

## 1. Нормализация конкурентов из БД

### Текущие конкуренты (из `competitors` + `stores`)

Для выполнения source inventory нужно:
1. Получить список конкурентов (`competitors` table)
2. Получить список магазинов-конкурентов (`stores` where `is_own = false` или `competitor_id IS NOT NULL`)
3. Нормализовать названия для сопоставления с онлайн-источниками

### Алгоритм нормализации названий

```ts
// Нормализация: универсальные варианты написания
const SOURCE_CANDIDATES = [
  { key: "spar_online", patterns: ["спар", "spar", "SPAR", "Spar"] },
  { key: "metro_online", patterns: ["метро", "metro", "METRO", "Metro"] },
  { key: "magnit", patterns: ["магнит", "magnit", "MAGNIT", "Magnit"] },
  { key: "x5_5ka", patterns: ["пятёрочка", "пятерочка", "5ka", "X5", "x5", "Пятёрочка"] }
];

function normalizeCompetitorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^а-яa-z0-9]/g, "")
    .replace("пятерочка", "пятёрочка");
}
```

---

## 2. Исследование онлайн-источников

### SPAR Калининград (`spar-online.ru/catalog/`)

| Характеристика | Значение |
|----------------|----------|
| **Базовый URL** | https://spar-online.ru/catalog/ |
| **Доступ** | Публичный каталог без авторизации |
| **robots.txt** | Не проверен (требует исследования) |
| **API** | Не обнаружено публичного API |
| **Требования к региону** | URL не содержит привязки к региону — возможен общесетевой каталог |
| **Точки магазинов** | На сайте указаны ТТ в разных городах, в т.ч. Калининград |
| **Структура каталога** | Категории → товары с ценами, изображениями |
| **Legal status** | `pending` — требуется проверка terms |

**Наблюдения:**
- Сайт использует JavaScript для навигации
- Возможна необходимость Playwright для парсинга
- Нужно проверить `/catalog/` endpoint на наличие pagination

### METRO Калининград (`online.metro-cc.ru` + Калининград, Московский пр-т, д. 279)

| Характеристика | Значение |
|----------------|----------|
| **Базовый URL** | https://online.metro-cc.ru/category |
| **Store URL** | https://metro-cc.ru/markets/kaliningrad/ul-moskovskii-pr-t-d-279 |
| **Доступ** | Требует выбор региона/города в cookie |
| **robots.txt** | Есть ограничения на `/category/` |
| **API** | Есть internal API (требует исследования) |
| **Точки магазинов** | Есть ТТ в Калининграде (Московский пр-т, д. 279) |
| **Разделение цен** | Отдельно онлайн-доставка и цены в ТЦ |
| **Legal status** | `pending` — требуется проверка terms |

**Наблюдения:**
- Нужно выбирать регион (Kaliningrad) для получения правильных цен
- Есть разделение между онлайн-доставкой и ценами в магазине
- Возможен API endpoint для получения товаров

### Магнит (`magnit.ru/catalog`)

| Характеристика | Значение |
|----------------|----------|
| **Базовый URL** | https://magnit.ru/catalog |
| **Доступ** | Публичный каталог |
| **robots.txt** | Требует проверки |
| **API** | Возможен |
| **Точки магазинов** | Сеть в Калининграде есть |
| **Legal status** | `pending` — требуется проверка terms |

**Наблюдения:**
- Нужно проверить наличие магазина в Калининграде
- Возможна гео-привязка к региону

### Пятёрочка / X5 (`5ka.ru`)

| Характеристика | Значение |
|----------------|----------|
| **Базовый URL** | https://5ka.ru |
| **Доступ** | Публичный каталог, выбор магазина |
| **robots.txt** | Требует проверки |
| **API** | Есть (используется мобильное приложение) |
| **Точки магазинов** | Сеть в Калининграде |
| **Legal status** | `pending` — требуется проверка terms |

**Наблюдения:**
- Требует выбор магазина для цен
- API официальный, но нужен ключ партнера

---

## 3. Правила доступа к источникам

### Правило: Никакого production scrape без `legal_status = allowed`

1. Перед включением источника в прод:
   - Проверить `terms of service` сайта
   - Проверить `robots.txt`
   - Найти официальный API/partner feed
   - Установить rate limits

2. Если `legal_status != allowed`:
   - Источник помечается как `blocked` или `pending`
   - В коде реализуется адаптер, но выполняется только в `dev` mode
   - Production scrape блокируется

### Калининград контекст

Все цены должны быть привязаны к Калининграду:
- `source_city = 'kaliningrad'` — обязательно
- `source_store_id` — если есть конкретный магазин
- `price_context` — для METRO: `online_delivery` vs `store_visit`

---

## 4. Предложения по source mapping

| Конкурент из БД | Предлагаемый source_key | Статус |
|------------------|------------------------|--------|
| Спар / SPAR | `spar_online` | pending |
| Метро / METRO | `metro_online` | pending |
| Магнит | `magnit` | pending |
| Пятёрочка / X5 | `x5_5ka` | pending |

---

## 5. Источники для первого этапа

**MVP очередь источников:**
1. SPAR — первый, потому что есть публичный каталог
2. METRO — второй, есть онлайн-цены и ТЦ в Калининграде
3. Магнит — третий, требует проверки региона
4. Пятёрочка — последний, требует выбора магазина

---

## 6. Требования к адаптерам

```ts
// server/online-monitoring/types.ts
export type OnlineSourceAdapter = {
  key: "spar_online" | "metro_online" | "magnit" | "x5_5ka";
  parserVersion: string;
  fetchCatalog(input: FetchCatalogInput): AsyncIterable<OnlineProductObservation>;
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
```

---

## 7. Следующие шаги

1. Создать `server/online-monitoring/source-detection.ts` для выявления конкурентов из БД ✅
2. Выполнить legal audit (terms/robots) для каждого источника ✅
3. Создать миграцию для `online_sources` с `legal_status = pending`
4. Запретить scrape для sources со `legal_status != allowed`
