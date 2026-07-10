# EXECUTION-ROADMAP — задачи для исполнителей (других нейросетей)

**Это рабочий документ.** Главная нейросеть (архитектор) пишет сюда задачи.
Исполнительная нейросеть берёт задачу, делает, пишет отчёт в `docs/WORKLOG.md`.
Когда задача готова — возвращаешься к архитектору за следующей.

---

## ⚠️ САМОЕ ВАЖНОЕ ДЛЯ ИСПОЛНИТЕЛЯ

**ОБЯЗАТЕЛЬНО запиши результат в `docs/WORKLOG.md` перед завершением.**
Без записи в WORKLOG задача считается НЕ сданной.
Всегда обновляй статус задачи в `docs/EXECUTION-ROADMAP.md` (TODO → IN PROGRESS → DONE).

Если задача заблокирована — всё равно запиши в WORKLOG что сделал и почему стоп.

**Как работать исполнителю:**
1. Прочитай `HANDOFF.md` (контекст проекта) и этот файл (текущие задачи)
2. Возьми **первую задачу со статусом TODO** (по порядку ID)
3. Сделай её строго по инструкции
4. **ОБЯЗАТЕЛЬНО запусти typecheck:**
   ```bash
   npx tsc --noEmit 2>&1 | grep -v "precision\|golden-dataset"
   ```
   Должно быть пусто. Если есть новые ошибки — исправь их.
5. Заполни отчёт в `docs/WORKLOG.md` (шаблон там), укажи результат typecheck
6. Обнови статус задачи в этом файле: `**Статус:** DONE` → `**Статус:** DONE`
7. Скажи пользователю: «Готово, задача X. Вернись к архитектору за проверкой.»

**Когда звать архитектора (прервать задачу):**
- Инструкция непонятна или противоречит коду
- Нужна правка архитектуры/модели данных
- Все задачи TODO закончились
- Нашёл баг, который не входит в текущую задачу

---

## Состояние проекта (контекст для исполнителя)

**Цель приложения:** жена фотографирует полки конкурентов → распознаёт товары/цены → сопоставляет с каталогом → выгружает Excel для Яны.

**Что РАБОТАЕТ (не трогать):**
- Каталог в БД: 2202 товаров, 116 магазинов
- Распознавание фото через Gemini (`recognizeShelfPhoto`)
- Батч-matching (`batchMatchCatalogItems`) — 1 запрос на всё фото
- Парсер шаблона Яны (`template-parser.ts`)
- Страница импорта шаблона (`/app/template-import`)

**Текущая архитектура (двухэтапная, в разработке):**
- Этап 1: фото → распознавание → таблица `competitor_shelf_items`
- Этап 2: кнопка «сопоставить» → батч-matching → заполнение `catalog_product_id`
- Этап 3: экспорт в формате Яны

**Ключевые файлы:**
| Файл | Что делает |
|------|-----------|
| `server/price-capture.ts` | Серверный action (нужно переделать под 2 этапа) |
| `server/text-ai/catalog-match-batch.ts` | Батч-matching (готов, не трогать) |
| `server/shelf-recognition/index.ts` | Распознавание с fallback (готов, не трогать) |
| `server/template-parser.ts` | Парсит Excel Яны (готов, не трогать) |
| `app/app/price-capture/` | UI загрузки фото (нужно переделать) |

**Переменные окружения в `.env.local`:**
- `GEMINI_API_KEY` — основной AI (бесплатно, с лимитом 15 req/мин)
- `OPENROUTER_API_KEY` — fallback AI (платно, $0.10/1M токенов)
- `SUPABASE_SERVICE_ROLE_KEY` — для записи в БД

**Команды:**
- `npm run dev` — запуск (порт 3000)
- `npx tsc --noEmit` — typecheck (должен быть чистым, кроме старых ошибок в precision/golden-dataset)
- `supabase db query --linked "SQL"` — выполнить SQL на проде

---

## ЗАДАЧИ

### TASK-01: Vision fallback Gemini→OpenRouter ✅ СДЕЛАНО архитектором
**Статус:** DONE (сделано в предыдущей сессии, проверь что работает)
**Файл:** `server/shelf-recognition/index.ts`
**Что:** При лимите Gemini (429) автоматически переключается на OpenRouter.
**Проверка:** `recognizeShelfPhoto` должен пытаться Gemini, при 429 — OpenRouter.

---

### TASK-02: Переделать price-capture под двухэтапную модель ✅ DONE
**Статус:** DONE
**Приоритет:** ВЫСОКИЙ (блокирует всё осталье)

**Зачем:** Сейчас price-capture делает распознавание + matching + запись в одну кучу. Нужно разделить: Этап 1 (распознавание → `competitor_shelf_items`) отдельно, Этап 2 (matching) отдельно.

**Файлы:**
- `server/price-capture.ts` — переписать
- `app/app/price-capture/price-capture-form.tsx` — обновить UI

**Инструкция:**

1. **Перепиши `captureCompetitorPricesAction` в `server/price-capture.ts`:**
   - Этап 1 ТОЛЬКО: принимает неделю + storeId + фото
   - Для каждого фото: грузит в storage → `recognizeShelfPhoto()` → пишет ВСЕ распознанные товары в `competitor_shelf_items`
   - НЕ делает matching (убери `batchMatchCatalogItems`, `getCatalogMatchCandidates`)
   - Возвращает: `{ ok, week, storeId, storeName, recognized, saved, errors }`
   - Поля для insert в `competitor_shelf_items`: company_id, week, store_id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, price_tag_text, product_visible_text, confidence, photo_storage_path, captured_date

2. **Обнови тип `PriceCaptureResult`** — убери matched/needsReview/notInCatalog, добавь recognized/saved.

3. **Обнови UI `price-capture-form.tsx`** — покажи просто «распознано N товаров, сохранено M». Без сопоставления.

**Критерий готовности:**
- `npx tsc --noEmit` чистый (без новых ошибок)
- Фото загружается → товары пишутся в `competitor_shelf_items` (проверь `SELECT count(*) FROM competitor_shelf_items`)
- В UI виден результат распознавания

**Подводные камни:**
- Таблица `competitor_shelf_items` уже создана и пустая (0 строк)
- Не трогай `batchMatchCatalogItems` — он нужен для Этапа 2
- Storage bucket `monitoring-photos` существует

---

### TASK-03: Кнопка «Сопоставить с каталогом» (Этап 2) ✅ DONE
**Статус:** DONE
**Приоритет:** ВЫСОКИЙ
**Зависимость:** TASK-02 должен быть DONE

**Зачем:** Отдельный action, который берёт несопоставленные товары из `competitor_shelf_items` и сопоставляет их с каталогом одним батч-запросом.

**Файлы:**
- `server/price-capture.ts` — добавить `matchShelfItemsAction`
- `app/app/price-capture/price-capture-form.tsx` — добавить кнопку

**Инструкция:**

1. **Добавь `matchShelfItemsAction` в `server/price-capture.ts`:**
   - Принимает: week, storeId
   - Загружает из `competitor_shelf_items` где `catalog_product_id IS NULL` AND `week=X` AND `store_id=Y`
   - Загружает весь каталог компании
   - Для каждого товара: `getCatalogMatchCandidates(recognized, catalog, { limit: 20 })`
   - Собирает `BatchMatchInput[]` → `batchMatchCatalogItems(inputs)` (ОДИН запрос!)
   - Для каждого результата: UPDATE `competitor_shelf_items` SET catalog_product_id, match_confidence, match_reason, matched_at = now()
   - Возвращает: `{ ok, matched, unmatched, total }`

2. **Добавь кнопку в UI** — после таблицы с распознанными товарами, кнопка «Сопоставить с каталогом».

**Критерий готовности:**
- `npx tsc --noEmit` чистый
- Кнопка работает: после нажатия `competitor_shelf_items.catalog_product_id` заполняется
- Время выполнения < 30 сек (1 батч-запрос)

---

### TASK-04: Страница просмотра товаров магазина ✅ DONE
**Статус:** DONE
**Приоритет:** СРЕДНИЙ
**Зависимость:** TASK-03 должен быть DONE

**Зачем:** После распознавания+matching пользователь должен видеть таблицу: товары, цены, сопоставлено/нет.

**Файлы:**
- `app/app/price-capture/[storeId]/page.tsx` — новая страница
- `app/app/price-capture/[storeId]/items-table.tsx` — таблица

**Инструкция:**

1. **Страница `/app/price-capture/[storeId]`:**
   - Загружает `competitor_shelf_items` для этого storeId + выбранной недели
   - Показывает: название магазина, неделя, таблица товаров

2. **Таблица товаров:**
   - Колонки: Товар (raw_name), Бренд, Цена, Сопоставлено (catalog name или «нет»), Уверенность, Фото-доказательство (ссылка)
   - Подсветка: зелёным если matched, жёлтым если нет
   - Кнопка «Сопоставить с каталогом» сверху (TASK-03)

3. **Добавь навигацию:** со страницы `/app/price-capture` после выбора магазина — ссылка на `/app/price-capture/[storeId]`

**Критерий готовности:**
- `npx tsc --noEmit` чистый
- Страница открывается, показывает товары
- Есть кнопка сопоставления

---

### TASK-05: Экспорт в формате Яны ✅ DONE
**Статус:** DONE
**Приоритет:** ВЫСОКИЙ (ФИНАЛЬНАЯ ЦЕЛЬ ПРИЛОЖЕНИЯ)
**Зависимость:** TASK-04 должен быть DONE

**Зачем:** Финальная цель — выгрузить Excel в формате Яны с заполненными ценами конкурентов. Пользователь загружает пустой шаблон Яны → получает тот же файл с заполненными ценами.

**Файлы:**
- `server/template-export.ts` — новый (логика экспорта)
- `app/app/price-capture/export/route.ts` — новый (POST endpoint для скачивания)

**ВАЖНО — как это работает:**
Пользователь загружает свой шаблон Яны (пустой, как в `/app/template-import`), а приложение отдаёт **тот же файл**, но с заполненными ценами конкурентов в колонках. Структура (листы, шапка, товары, "Наша цена") сохраняется как есть. Приложение только проставляет цены конкурентов.

**Инструкция:**

1. **Создай `server/template-export.ts` с функцией `fillTemplateWithPrices`:**
   - Параметры: `fileBuffer: Buffer`, `week: 1|2`, `companyId: string`, `supabaseClient` (service role)
   - Открой Excel через `XLSX.read(fileBuffer)` (НЕ мутируй исходный buffer!)
   - Парси шаблон через `parseMonitoringTemplate(fileBuffer, week)` → получаем товары (с barcode) и колонки (сourStoreLabel, storeLabel, priceKind, columnIndex)
   - Загрузи из БД все `competitor_shelf_items` для этой недели где `catalog_product_id IS NOT NULL` (только сматченные), присоедини к `catalog_products` чтобы получить barcode товара
   - Для каждой колонки с `priceKind === "competitor"`:
     - Найди store_id: используй `splitStoreLabel(col.storeLabel)` → `stores` WHERE name=X AND address=Y
     - Если store не найден — пропусти колонку
   - Построй map: (catalog_product_id → store_id → price_minor) из competitor_shelf_items (самая свежая по captured_date)
   - Построй map: barcode → catalog_product_id из каталога
   - Для каждого листа (Химия/Продукты): для каждой строки-товара (с barcode):
     - Найди catalog_product_id по barcode
     - Для каждой колонки конкурента: найди цену → запиши в ячейку `columnIndex` (дели price_minor на 100 для рублей)
   - Сохрани через `XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })`
   - Верни Buffer

2. **Создай server action `exportMonitoringExcelAction` в `server/template-export.ts`:**
   - "use server"
   - Принимает FormData: file (шаблон Яны) + week
   - Проверяет доступ через `getPrimaryCompanyMembership()`
   - Вызывает `fillTemplateWithPrices`
   - Возвращает Buffer (или ошибки)

3. **Создай API route `app/app/price-capture/export/route.ts`:**
   - POST-запрос с FormData (file + week)
   - Проверяет auth
   - Вызывает `fillTemplateWithPrices`
   - Отдаёт .xlsx файл: `Content-Disposition: attachment; filename=...`, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

4. **Добавь форму «Выгрузить Excel» на страницу `/app/price-capture/[storeId]/page.tsx`:**
   - Форма: выбор недели + input file (шаблон Яны) + кнопка «Выгрузить Excel с ценами»
   - При сабмите → POST на `/app/price-capture/export` → браузер скачивает файл

**Критерий готовности:**
- `npx tsc --noEmit` чистый
- Загружаешь `_samples/Мониторинг 1я неделя (2).xlsx` + week=1 → получаешь Excel с заполненными ценами (там где есть данные в competitor_shelf_items)
- Структура файла сохранена (два листа, шапка, товары, "Наша цена" на месте)
- Категории-разделители (Хлебцы, Специи...) на месте

**Подводные камни:**
- **Маппинг магазина**: в файле "Спар, Ленина 60", в БД name='Спар' AND address='Ленина 60'. Используй `splitStoreLabel` из `template-parser.ts`.
- **Маппинг товара**: по barcode. У товара в каталоге есть `barcode` (число как строка) и `external_sku` (то же самое). Сравнивай как строки.
- **Цены в копейках** (price_minor, bigint), в Excel в рублях (price_minor / 100, число с плавающей точкой)
- Если store не найден — пропусти колонку (не падай)
- Если нет цены для товара — оставь ячейку пустой (не пиши 0)
- **НЕ мутируй** исходный buffer — сделай копию workbook
- Прогон code-review обязателен — это сложная задача

---

### TASK-06: Навигация и полировка UI ✅ DONE
**Статус:** DONE
**Приоритет:** НИЗКИЙ
**Зависимость:** TASK-05 должен быть DONE

**Зачем:** Главная страница `/app` не знает о новых страницах.

**Файлы:**
- `app/app/page.tsx` — добавить ссылки

**Инструкция:**
1. На `/app` добавь карточку/ссылку «Мониторинг конкурентов» → `/app/price-capture`
2. Проверь что все новые страницы доступны без ошибок
3. Добавь ссылку «Импорт шаблона» → `/app/template-import` если ещё нет

**Критерий готовности:**
- Главная страница показывает вход в новый flow
- Все страницы открываются

---

## 🎯 ФАЗА ТЕСТИРОВАНИЯ И ФИНАЛИЗАЦИИ (после TASK-06)

После TASK-06 весь функционал написан, но **ни разу не тестировался end-to-end в браузере**.
Это критическая фаза — здесь вылезут реальные баги, которые не видны в коде.

### TASK-07: Живой тест распознавания ✅ DONE
**Статус:** DONE (протестировано, 29 товаров сохранено)
**Приоритет:** КРИТИЧЕСКИЙ

**Результат теста:**
- Распознавание работает: 29 товаров с полки «Подружка» сохранены в `competitor_shelf_items`
- Matching сработал: 8 из 29 сматчено (Milka, babyfox)
- **Найден баг:** при загрузке нескольких фото — ошибка `Unexpected end of JSON input` (Gemini отдаёт битый JSON)
- **Найдена проблема:** match/route.ts возвращает JSON вместо редиректа → браузер показывает голый JSON
- **UX проблемы:** нет поиска магазинов, нет названия фото, нет превью, нельзя редактировать цену, нет спиннера при matching

---

---

## 🎯 ФАЗА 2: ИСПРАВЛЕНИЕ БАГОВ И UX (по результатам теста)

### TASK-11: Match route — редирект вместо JSON + спиннер 🔴
**Статус:** DONE
**Приоритет:** КРИТИЧЕСКИЙ (сейчас matching показывает голый JSON)

**Зачем:** Сейчас браузер показывает `{"ok":true,"matched":0...}` вместо обновлённой страницы.

**Файлы:**
- `app/app/price-capture/[storeId]/match/route.ts` — переписать
- `app/app/price-capture/[storeId]/page.tsx` — добавить баннер результата

**Инструкция:**

1. **Перепиши `match/route.ts`:**
   - После успешного matching — редирект (`redirect()`) на `/app/price-capture/[storeId]?week=X&matched=Y&unmatched=Z&total=W`
   - При ошибке — редирект с `match_error=...`
   - Убери `NextResponse.json()` — он не нужен, браузер ждёт HTML

2. **Обнови `page.tsx`:**
   - Прочитай из `searchParams` параметры `matched`, `unmatched`, `total`, `match_error`
   - Если есть — покажи баннер сверху страницы:
     - Успех: «Сопоставлено Y из W товаров. Z не сопоставлено.»
     - Ошибка: «Ошибка сопоставления: ...»
   - Баннер исчезает при перезагрузке (одноразовый)

**Критерий готовности:**
- Нажал «Сопоставить с каталогом» → страница перезагружается → вижу результат
- Нет голого JSON в браузере
- `npx tsc --noEmit` чистый

---

### TASK-12: Graceful handling ошибок Gemini (Unexpected end of JSON input) 🔴
**Статус:** DONE
**Приоритет:** КРИТИЧЕСКИЙ (при загрузке 2+ фото падает)

**Зачем:** Gemini иногда отдаёт пустой ответ или битый JSON. Нужно чтобы:
- Ошибка одного фото не валила весь batch
- Пользователь видел «Фото X: не удалось распознать» вместо падения

**Файлы:**
- `server/shelf-recognition/normalize.ts` — добавить защиту
- `server/price-capture.ts` — уже есть try-catch, проверить

**Инструкция:**

1. **В `normalize.ts` (функция `normalizeRecognitionResult`):**
   - Проверь что `data` — не пустой объект, не null, не undefined
   - Если `items` — не массив или пустой — верни `{ items: [], raw: data }`
   - Оберни весь парсинг в try-catch. Если JSON.parse падает — верни `{ items: [], raw: data }` + ошибку в поле `normalizeError`
   - Проверь что каждый item содержит `raw_name` (если нет — пропусти)

2. **Проверь `server/price-capture.ts`:**
   - Строка 117: `recognizeShelfPhoto` уже обёрнут в try-catch
   - Если `recognition.items` пустой — добавь сообщение в errors: `"Фото {file.name}: товары не найдены"`
   - Продолжай обработку следующих фото (не прерывай batch)

**Критерий готовности:**
- При пустом/битом ответе Gemini — не падает, а пишет ошибку
- Остальные фото в batch обрабатываются
- typecheck чистый

---

### TASK-13: Поиск/фильтр магазинов в select + запоминать последний 🟡
**Статус:** DONE
**Приоритет:** СРЕДНИЙ (93 магазина, неудобно искать)

**Зачем:** В списке 93 конкурента. Сейчас нужно скроллить и искать глазами.

**Файлы:**
- `app/app/price-capture/price-capture-form.tsx` — переписать select

**Инструкция:**

1. **Добавь текстовое поле поиска над select:**
   - При вводе фильтрует список магазинов по названию/адресу
   - Показывать только подходящие option
   - Если поле пустое — показывать все 93 магазина

2. **Запоминай последний выбранный магазин:**
   - При выборе storeId сохраняй в `localStorage.setItem('lastStoreId', id)`
   - При загрузке страницы проверь `localStorage.getItem('lastStoreId')`
   - Если есть — выбери его в select и покажи название магазина в приветствии

3. **Простая реализация (без библиотек):**
   - Используй `useState` для `searchTerm`
   - Фильтруй `stores.filter(...)` по имени и адресу
   - `useEffect` для localStorage

**Критерий готовности:**
- Печатаю «Спар» → вижу только магазины Спар
- Выбрал магазин → перезагрузил страницу → он выбран
- `npx tsc --noEmit` чистый

---

### TASK-14: Название фото + превью в таблице товаров 🟡
**Статус:** DONE
**Приоритет:** СРЕДНИЙ

**Зачем:** Пользователь не видит, из какого фото распознан товар. Не может найти файл для ручного контроля.

**Файлы:**
- `server/price-capture.ts` — добавить `photo_filename` в insert
- `app/app/price-capture/[storeId]/items-table.tsx` — добавить колонки

**Инструкция:**

1. **В `server/price-capture.ts` (строка ~121-137):**
   - Добавь поле `photo_filename` в `rowsToInsert` (сохрани оригинальное имя файла)
   - Сейчас `storagePath` содержит оригинальное имя, но закодированное. Добавь отдельное поле `photo_filename: file.name`

2. **Добавь колонку «Файл» в таблицу `items-table.tsx`:**
   - Показывать оригинальное имя файла (photo_filename)
   - Если имя длинное — обрезать `...` в средине

3. **Добавь колонку «Фото» с превью:**
   - Вместо текстовой ссылки «фото» — покажи миниатюру (thumbnail)
   - Используй `<Image>` из next/image или просто `<img>` с width={80} height={80} style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
   - При клике — открывай в новой вкладке (или модалку)

4. **Сначала проверь тип `competitor_shelf_items` в БД:**
   - `npx supabase db query --linked "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='competitor_shelf_items' AND column_name='photo_filename'"`
   - Если колонки нет — создай миграцию: `ALTER TABLE competitor_shelf_items ADD COLUMN IF NOT EXISTS photo_filename text;`

**Критерий готовности:**
- В таблице видно имя файла и миниатюру фото
- При клике на миниатюру — фото открывается
- `npx tsc --noEmit` чистый

---

### TASK-15: Inline-редактирование цены товара 🟡
**Статус:** DONE
**Приоритет:** СРЕДНИЙ

**Зачем:** После распознавания цена может быть неточной. Пользователь хочет исправить вручную.

**Файлы:**
- `app/app/price-capture/[storeId]/items-table.tsx` — добавить редактирование
- `server/price-capture.ts` — добавить action `updateShelfItemPriceAction`

**Инструкция:**

1. **Добавь server action `updateShelfItemPriceAction` в `server/price-capture.ts`:**
   - "use server"
   - Принимает: `itemId: string`, `priceMinor: number | null`, `companyId: string`
   - Проверяет доступ (тот же companyId)
   - UPDATE `competitor_shelf_items` SET `price_minor = $priceMinor` WHERE `id = $itemId`
   - Возвращает `{ ok: true }` или ошибку

2. **В `items-table.tsx` сделай ячейку цены редактируемой:**
   - При клике на цену — появляется input[type="number"]
   - Пользователь вводит новую цену (в рублях, делится на 100 при сохранении)
   - При потере фокуса или Enter — сохраняет через fetch/api
   - Показывает спиннер сохранения
   - Если ошибка — показывает красным

3. **Простая реализация:**
   - `useState<{editingId: string | null, editValue: string}>`
   - При клике: `setEditingId(item.id)`, `setEditValue(String(item.price_minor / 100))`
   - На onChange: `setEditValue(e.target.value)`
   - На blur: fetch(`/api/update-price`, { method: 'POST', body: JSON.stringify({...}) })
   - Можно создать API route `/app/api/update-price/route.ts`

**Критерий готовности:**
- Кликнул на цену → появился input
- Изменил цену → нажал Enter → цена обновилась в таблице
- `npx tsc --noEmit` чистый

---

### TASK-09: Экспорт — починить маппинг + форматирование 🔴
**Статус:** DONE
**Приоритет:** КРИТИЧЕСКИЙ — ФИНАЛЬНАЯ ЦЕЛЬ

**Проблемы при тесте:**
1. Цены пустые — маппинг магазина по адресу не сработал (адреса в шаблоне и БД разные)
2. Форматирование сломано — XLSX.write не сохраняет объединённые ячейки, цвета, ширину

**Файлы:**
- `server/template-export.ts` — переписать

**Инструкция:**

### 1. Установить exceljs
```bash
npm install exceljs
```

### 2. Переписать `fillTemplateWithPrices` с exceljs
- Замени `XLSX.read/write` на `exceljs` Workbook
- exceljs сохраняет всё форматирование (merged cells, column widths, fonts, colors, borders)
- При чтении: `new Excel.Workbook()` → `await workbook.xlsx.read(buffer)`
- При записи: `await workbook.xlsx.writeBuffer()` → возвращает Buffer
- Обход строк: `worksheet.getRow(rowIndex)` → `row.getCell(columnIndex)` → `cell.value = priceMinor / 100`

### 3. Починить `resolveStoreId` — ослабить маппинг
- Если точный матч по name+address не нашёлся — попробуй найти по name без address
- Если по name находится ровно 1 магазин — используй его
- Если несколько — верни null (неоднозначно)

### 4. Проверка
```bash
npx tsc --noEmit 2>&1 | grep -v "precision\|golden-dataset"
```
Должно быть пусто.

### 5. Тест
- Загрузи `_samples/Мониторинг 1я неделя (2).xlsx` через форму экспорта
- Должен скачаться файл с сохранённым форматированием (merged cells, цвета)
- Цены должны проставиться в колонках тех магазинов, которые совпали по названию

**Критерий готовности:**
- Скачанный файл выглядит как оригинал (шапка, цвета, ширина колонок)
- В колонках конкурентов есть цены (там где есть данные в БД)

---

### TASK-10: Гибридный matching — категория + fuzzy + LLM 🔴
**Статус:** DONE
**Приоритет:** ВЫСОКИЙ (сейчас matching не работает — 0 сматчено)

**Зачем:** Сейчас алгоритм ищет точное совпадение токенов. Названия на фото
(короткие, английские, с опечатками) не совпадают с названиями в каталоге
(полные, русские). Нужен гибрид: категория → fuzzy → LLM.

**Файлы:**
- `server/catalog-matching.ts` — переписать `getCatalogMatchCandidates` и `score`
- `server/price-capture.ts` — увеличить limit кандидатов

**Инструкция:**

### 1. Добавить транслитерацию в `catalog-matching.ts`
Создай функцию `transliterate(text: string): string`:
- Рус → латиница: `а→a, б→b, в→v, г→g, д→d, е→e, ё→e, ж→zh, з→z, и→i, й→y, к→k, л→l, м→m, н→n, о→o, п→p, р→r, с→s, т→t, у→u, ф→f, х→kh, ц→ts, ч→ch, ш→sh, щ→sch, ы→y, э→e, ю→yu, я→ya`
- Латиница → рус (стандартная транслитерация в обратную сторону)
- `splat` → `сплат`, `colgate` → `колгейт`
- Верни результат в нижнем регистре

### 2. Добавить fuzzy-поиск в `getCatalogMatchCandidates`
Вместо точного совпадения токенов, добавь **дополнительные кандидаты**:

**a) Substring match:**
- Для каждого токена распознавания проверь, входит ли он в название товара каталога (или наоборот)
- `splat` входит в `"Паста зубная Сплат (Splat) Биокальций"` → кандидат
- `colgate` входит в `"Паста зубная Колгейт (Colgate) МаксФреш"` → кандидат
- Вес такого совпадения: +0.3 к score

**b) Транслитерация:**
- Транслитерируй токены распознавания и названия каталога
- Сравнивай и обычные, и транслитерированные
- `splat` (транслит: `splat`) = `Splat` (транслит: `splat`) → совпадение
- Вес: +0.4 к score

**c) Убрать штраф за размер:**
- Строки `s -= 0.18` (size_mismatch) — убрать или уменьшить до -0.02
- Причина: размер с фото почти никогда не совпадает с каталогом

**d) Увеличить лимит кандидатов:**
- `options.limit ?? 5` → `options.limit ?? 30`

### 3. Обновить `matchShelfItemsAction` в `price-capture.ts`
- В вызове `getCatalogMatchCandidates` передай `{ limit: 30 }`

### 4. Проверка
```bash
npx tsc --noEmit 2>&1 | grep -v "precision\|golden-dataset"
```
Должно быть пусто.

### 5. Тест matching
После деплоя: открой страницу магазина → «Сопоставить с каталогом».
Должны появиться сматченные товары (Colgate, SPLAT и т.д.)

**Критерий готовности:**
- typecheck чистый
- После нажатия «Сопоставить» — хотя бы часть товаров сматчена
- Алгоритм находит кандидатов по транслитерации и substring, а не только по точным токенам

---

## 🎯 ФАЗА 3: ДОЛГИ ПЕРЕД КАЧЕСТВОМ (по аудиту Codex)

### TASK-16: Починить тесты matching 🔴
**Статус:** DONE
**Приоритет:** ВЫСОКИЙ (3 теста падают — Nivea flavor, Nivea size, Persil package)

**Зачем:** После изменений в `catalog-matching.ts` (TASK-10) сломались существующие тесты.
Нужно вернуть их в зелёную зону, чтобы не регрессировать matching.

**Файлы:**
- `server/catalog-matching.ts` — править scoring
- `tests/catalog-matching.test.mjs` — смотреть, какие сценарии падают

**Инструкция:**
1. Запусти `npm run test` — посмотри какие 3 теста падают и почему
2. Почини scoring в `catalog-matching.ts` так, чтобы эти тесты проходили
3. Не удаляй тесты — чини алгоритм, а не тесты
4. Проверь: `npm run test` — зелёный, `npx tsc --noEmit` — чистый

**Критерий готовности:**
- `npm run test` — все тесты проходят
- typecheck чистый

---

### TASK-17: Починить lint errors в template-export.ts ✅ DONE
**Статус:** DONE
**Приоритет:** СРЕДНИЙ

**Зачем:** `npm run lint` падает с 2 ошибками `no-explicit-any` в `server/template-export.ts`.

**Файлы:**
- `server/template-export.ts` — строки 246 и 311

**Инструкция:**
1. Замени `as any` на правильные типы
2. Для `exceljs` load: используй `fileBuffer as unknown as ArrayBuffer`
3. Для `writeBuffer`: используй `Buffer.from(await workbook.xlsx.writeBuffer())`
4. Проверь: `npm run lint` — 0 errors, `npx tsc --noEmit` — чистый

**Критерий готовности:**
- `npm run lint` — 0 errors
- typecheck чистый

---

### TASK-18: Миграция для photo_filename 🟡
**Статус:** DONE
**Приоритет:** СРЕДНИЙ

**Зачем:** Колонка `photo_filename` уже добавлена через ALTER TABLE, но не зафиксирована
в миграциях. При пересоздании БД — потеряется.

**Файлы:**
- `supabase/migrations/20260708180000_add_photo_filename.sql` — новая миграция

**Инструкция:**
1. Создай файл миграции:
```sql
ALTER TABLE competitor_shelf_items ADD COLUMN IF NOT EXISTS photo_filename text;
```
2. Примени через `supabase db query --linked --file <migration.sql>`
3. Проверь: `npx supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name='competitor_shelf_items' AND column_name='photo_filename'"` — должна вернуть строку

**Критерий готовности:**
- Миграция создана и применена
- Колонка есть в БД

---

### TASK-19: Починить URL превью фото 🟡
**Статус:** DONE
**Приоритет:** СРЕДНИЙ

**Зачем:** В `items-table.tsx` используется относительный URL `/storage/v1/object/public/...`.
В Next.js это может не работать без rewrite. Нужно использовать полный Supabase URL.

**Файлы:**
- `app/app/price-capture/[storeId]/items-table.tsx`

**Инструкция:**
1. Импортируй `NEXT_PUBLIC_SUPABASE_URL` из переменных окружения
2. Сформируй полный URL: `` `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/monitoring-photos/${item.photo_storage_path}` ``
3. Замени все места с `/storage/v1/object/public/...` на полный URL
4. Проверь: `npx tsc --noEmit` — чистый

**Критерий готовности:**
- Превью фото открывается по полному URL
- typecheck чистый

---

### TASK-20: Обновить HANDOFF.md ✅ DONE
**Статус:** DONE
**Приоритет:** НИЗКИЙ

**Зачем:** HANDOFF.md описывает старый flow (price_history, экспорт как pending).
Сейчас уже есть competitor_shelf_items, exceljs, двухэтапный flow.

**Файлы:**
- `HANDOFF.md`

**Инструкция:**
1. Обнови HANDOFF.md:
   - Удали упоминания старой модели (price_history, monitoring_sessions, recognized_items)
   - Опиши текущую архитектуру: competitor_shelf_items, двухэтапный flow
   - Обнови статус задач: TASK-01..20 с их текущими статусами
   - Обнови список ключевых файлов (добавь template-export.ts, catalog-match-batch.ts)
2. Проверь: нет упоминаний несуществующих файлов или таблиц

**Критерий готовности:**
- HANDOFF.md описывает актуальное состояние проекта

---

## История изменений roadmap

- **2026-07-08:** Создан архитектором. TASK-01 уже сделан. TASK-02..06 TODO.
- **2026-07-08:** TASK-02,03,04,05 выполнены исполнителями. TASK-03 получил правку архитектора (баг Supabase update). TASK-05 выполнен лагуной (конфликт с codex, но разрешён). Добавлены TASK-07,08,09 (живое тестирование) и TASK-10 (тюнинг).
- **2026-07-08:** TASK-15 выполнен ZCode — добавлено inline-редактирование цены товара.
- **2026-07-08:** TASK-07,08 протестированы пользователем. Распознавание ✅ (29 товаров), matching ✅ (8 сматчено). Выявлены баги: JSON вместо редиректа (TASK-11), ошибка Gemini (TASK-12). Добавлены UX-задачи TASK-13..15.
- **2026-07-09:** Аудит Codex. Добавлены TASK-16..20 по результатам аудита.
- **2026-07-09:** Начата фаза онлайн-мониторинга. TASK-21.1..21.11 добавлены в ROADMAP по плану Codex.

---

## 🎯 ФАЗА 4: ОНЛАЙН-МОНИТОРИНГ КОНКУРЕНТОВ

### TASK-21.1: Source inventory и legal audit ✅
**Статус:** DONE
**Приоритет:** P0
**Файлы:** `docs/ONLINE-SOURCE-RESEARCH.md`, `server/online-monitoring/source-detection.ts`

Собрать из БД список конкурентов, нормализовать названия, проверить terms/robots/API/регион.

---

### TASK-21.2: DB schema для online-source 🔴
**Статус:** DONE
**Приоритет:** P0
**Файлы:** `supabase/migrations/<timestamp>_online_monitoring.sql`

Таблицы: `online_sources`, `online_source_stores`, `online_source_runs`, `online_source_run_events`, `online_source_products`, `online_product_matches`, `online_prices`. Индексы + RLS. Не менять `competitor_shelf_items`.

---

### TASK-21.3: Core module и adapter contract 🔴
**Статус:** DONE
**Приоритет:** P0
**Файлы:** `server/online-monitoring/types.ts`, `registry.ts`, `normalize.ts`, `run.ts`

OnlineSourceAdapter, нормализация цен, retry/backoff, run stats.

---

### TASK-21.4: SPAR adapter 🔴
**Статус:** DONE
**Приоритет:** P0
**Файлы:** `server/online-monitoring/adapters/spar-online.ts`, тесты, fixtures

Парсинг spar-online.ru/catalog/ — категории, pagination, товары, цены.

---

### TASK-21.5: Worker и scheduler 🟡
**Статус:** DONE
**Приоритет:** P1
**Файлы:** `app/api/cron/online-monitoring/route.ts`, `server/worker/online-monitoring-worker.ts`

Cron endpoint создаёт queued runs, worker claim-ит и выполняет adapter.

---

### TASK-21.6: Matching online products 🟡
**Статус:** DONE
**Приоритет:** P1
**Файлы:** `server/online-monitoring/matching.ts`

Barcode match → getCatalogMatchCandidates → LLM batch. Сохранять в online_product_matches.

---

### TASK-21.7: Unified price reader и экспорт 🟡
**Статус:** DONE
**Приоритет:** P1
**Файлы:** `server/price-observations.ts`, `server/template-export.ts`

Единый read model для фото + online цен. Режимы: photo_only, online_only, latest.

---

### TASK-21.8: UI online monitoring 🟡
**Статус:** DONE
**Приоритет:** P1
**Файлы:** `app/app/online-monitoring/`

Dashboard источников, latest prices, unmatched queue, ручной запуск.

---

### TASK-21.9: METRO, Magnit и X5 adapters 🟢
**Статус:** DONE
**Приоритет:** P2
**Файлы:** `server/online-monitoring/adapters/`

Адаптеры для METRO (online_delivery + store_visit), Magnit, X5/5ka.

---

### TASK-21.10: Alerts 🟢
**Статус:** DONE
**Приоритет:** P2
**Файлы:** `server/online-monitoring/alerts.ts`, UI

Правила изменения цен, алерты при падении source runs.

---

### TASK-21.11: Parser tests и quality gates 🟡
**Статус:** DONE
**Приоритет:** P1
**Файлы:** `tests/online-monitoring/`

Fixture tests, тест идемпотентности, тест ошибок одной страницы.

**Результат:** docs/ONLINE-MONITORING-PLAN.md с детальным планом реализации.

---

## 🎯 ФАЗА 5: СТАБИЛИЗАЦИЯ (по плану Codex)

### TASK-22: Lint baseline и cleanup 🔴
**Статус:** DONE | **Приоритет:** P0
Убрать 8 lint errors, исключить `.tmp` из lint.

### TASK-23: Online migration safety audit 🔴
**Статус:** DONE | **Приоритет:** P0
Проверить SQL миграций, не применять без подтверждения.

### TASK-24: Manual run online-monitoring 🔴
**Статус:** DONE | **Приоритет:** P0
Починить форму ручного запуска online source.

### TASK-25: Unmatched review для online 🟡
**Статус:** DONE | **Приоритет:** P1
Читать данные через join, показывать кандидатов каталога.

### TASK-26: Price observation fallback 🟡
**Статус:** DONE | **Приоритет:** P1
Исправить online_preferred по каждой паре товар+магазин.

### TASK-27: Alerts lifecycle integration 🟡
**Статус:** DONE | **Приоритет:** P1
Вызывать alerts после run/price insert.

### TASK-28: Export preflight MVP 🟡
**Статус:** DONE | **Приоритет:** P1
Показать coverage перед экспортом.

### TASK-29: E2E smoke сценарии 🟢
**Статус:** DONE | **Приоритет:** P2
Фото-flow и online-flow smoke tests.

### TASK-30: Worker production runbook 🟢
**Статус:** DONE | **Приоритет:** P2
Описать запуск worker, env, healthcheck.

~ Реализовано (ZCode, 2026-07-09): написан `docs/WORKER-RUNBOOK.md` — полный runbook (назначение, компоненты, env, запуск: `npm run worker:online` / single-run / systemd / Docker, producer-триггеры, healthcheck по БД+UI, troubleshooting, чек-лист). В разделе «⚠️ Pre-production blockers» задокументирован критический блокер B1: worker падает на первом run из-за `createSupabaseServerClient()` (`cookies()` из `next/headers`) в автономном процессе — дан готовый фикс (service-role клиент, как в `claim-run.ts`). Остальные блокеры: B2 (нет `crons` в `vercel.json`), B3 (`CRON_SECRET` не задан), B4 (`WORKER_SIGNATURE_SECRET` мёртв), B5 (RPC `claim_online_source_run` отсутствует, есть fallback), B6 (нет graceful shutdown / lock timeout). Код не правился — вне scope TASK-30, зафиксировано для архитектора.

---

## История изменений roadmap

- **2026-07-09:** Codex сформировал FUTURE-PLAN.md. Добавлены TASK-22..30.
- **2026-07-09:** TASK-27 выполнен (ZCode) — алерты вызываются после run (run_failure) и после вставки цен (price_change, out_of_stock) в worker-е.
- **2026-07-09:** TASK-28 выполнен (ZCode) — preflight перед экспортом: API route `/app/price-capture/export/preflight` + `computeExportPreflight()` (coverage по магазинам, missing columns, low-confidence rows), кнопка «Проверить покрытие» в ExportForm. Формат XLSX не изменён.
- **2026-07-09:** TASK-29 выполнен (ZCode) — E2E smoke сценарии: `tests/e2e-smoke.test.mjs` (6 тестов). Фото-flow (распознавание→matching→экспорт в ячейки шаблона) и online-flow (адаптер SPAR→persist→matching→price map), плюс merge photo+online (режим latest). Реальные модули: `shelf-recognition/normalize.ts`, `catalog-matching.ts`, `template-parser.ts`, `online-monitoring/normalize.ts`.
- **2026-07-09:** TASK-30 выполнен (ZCode) — написан `docs/WORKER-RUNBOOK.md` (production runbook: запуск worker, env, healthcheck, troubleshooting, чек-лист). Выявлен критический блокер B1: worker падает на первом run из-за `cookies()` вне HTTP-запроса — дан фикс (service-role клиент). Код не правился (вне scope), зафиксировано для архитектора.
