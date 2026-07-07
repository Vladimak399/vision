# Monitoring stabilization plan

## Короткий аудит текущего flow

Фактический контур сейчас такой:

1. `app/app/monitoring/[sessionId]/photo-upload-form.tsx` готовит изображения, при необходимости сжимает их и отправляет в `uploadMonitoringPhotos`.
2. `app/app/monitoring/actions.ts` сохраняет фото в Supabase Storage, создаёт `monitoring_photos`, затем `queueRecognitionForSession` создаёт `jobs.kind = photo_ocr`.
3. `app/app/monitoring/worker-actions.ts` вручную запускает очередь, скачивает фото, вызывает `server/shelf-recognition/index.ts`, вставляет `recognized_items`, затем вызывает `server/auto-catalog-matching.ts`.
4. OCR-провайдеры живут в `server/shelf-recognition/gemini.ts` и `server/shelf-recognition/openai.ts`.
5. Matching реализован в `server/catalog-matching.ts`, `server/auto-catalog-matching.ts`, `server/match-aliases.ts`.
6. Review UI и действия находятся в `app/app/monitoring/[sessionId]/review/page.tsx`, `recognized-item-review-controls.tsx`, `recognized-item-review-actions.ts`, `match-actions.ts`, `manual-catalog-match-actions.ts`.
7. Export реализован в `app/app/monitoring/[sessionId]/export.xlsx/route.ts` и `export-detailed.xlsx/route.ts`.
8. Импорт каталога находится в `app/app/catalog/actions.ts`, каталоговые helper'ы — в `server/catalog.ts`.

## Выполненный в этом PR первый безопасный пакет

Этот PR не меняет схему БД и не перестраивает каталог. Цель — повысить полноту OCR, сделать auto-match/review/export более понятными и оставить рискованные DB/RPC изменения на отдельные PR.

### OCR / jobs

- Усилить OpenAI OCR prompt до того же промышленного паттерна, что и Gemini: полный обход полок сверху вниз, слева направо, один читаемый ценник = одна строка, частично читаемые строки возвращать с `needs_review=true`, всегда заполнять `position_hint`.
- Сохранять OCR warnings и warning при подозрительно малом числе строк (`items.length <= 3`) в `jobs.error` как диагностический текст, не ломая успешный OCR.
- В diagnostics job записывать counts auto-match: items, matched, suggested, no_candidate.

### Matching / aliases

- Усилить вычисляемую нормализацию без миграций: игнорировать price-only tokens, поддержать больше мусорных/ценовых слов, учитывать `product_visible_text` при size extraction, экспортировать helper'ы для будущих тестов.
- Сохранить бизнес-инвариант: отсутствие candidate не переводит строку в `unmatched`; auto-match ставит `matched` только при высоком score и margin.
- Сохранить company-scoping: все запросы остаются с `.eq("company_id", companyId)`.

### Review UI

- Добавить фильтры исключений: все, требует проверки, без кандидата, с кандидатом, сопоставлено, нет в ассортименте, низкая OCR-уверенность, большая разница цены.
- Добавить групповое действие: принять только active candidates со score `>= 0.90`. Действие не ставит `unmatched` и не трогает спорные строки.
- Оставить ручное “Нет в ассортименте” только явным per-row действием.

### Export

- Сохранить правило: только `status = unmatched` даёт “Не найдено в ассортименте”.
- Добавить summary counts в оба XLSX export: matched, unmatched, needs_review, needs_review с/без кандидата, большая разница цены.
- Не считать price difference, если наша цена отсутствует.

## Слабые места, найденные аудитом

### OCR теряет товары

- Производственный upload может слишком сильно уменьшать крупные shelf photos; price tags становятся мелкими. Файл: `app/app/monitoring/[sessionId]/photo-upload-form.tsx`.
- Jobs с нулём или 1–3 строками раньше считались полностью успешными без видимых warning. Файл: `app/app/monitoring/worker-actions.ts`.
- Нет idempotency для retry после частичного insert recognized_items. Следующий PR должен добавить `source/ocr_job_id/ocr_candidate_key` или transactional retry strategy.
- Нет image tiling/cropping. Следующий OCR PR: нарезка фото по shelf zones, отдельный OCR по tiles, dedupe candidates.

### Matching слишком слабый

- Alias conflict handling пока “первый по confirmations wins”; нужен conflict-aware active alias model.
- `aliases` RLS write policy может не совпадать с reviewer actions; alias save best-effort и не показывает ошибку.
- Active match replacement не transaction/RPC; есть риск частичных состояний.
- Size parser пока базовый; нужны multipacks (`2x100г`, `6 шт x 50 г`, `0.5л`).
- Каталог не имеет persisted normalized fields, barcode/GTIN, normalization version.

### Ручной труд слишком большой

- Review page всё ещё precomputes suggestions in-memory against catalog slice; для больших сессий нужен on-demand server-side candidate search + pagination.
- Нет checkbox-based selected bulk actions; текущий bulk action принимает только high-confidence active candidates.
- Manual search по query всё ещё слишком примитивен; нужен ranked server-side search by SKU/name/brand/size_text with candidate selection.

### UI/diagnostics

- Counts на review page пока считаются по загруженному набору, а не отдельным aggregate query по всей сессии.
- Session page не показывает per-job `error`, attempts/max_attempts, photo id, stale jobs.
- Reviewer видит review, но часть diagnostics/actions ограничена admin/manager.

### Export / QA

- Export routes дублируют логику; нужен shared `server/monitoring-export.ts`.
- Formula injection protection задокументирована, но должна быть внедрена отдельным PR с contract tests.
- Нет `npm test` и тестовой инфраструктуры; добавить Vitest для pure helpers в следующем PR.
- `npm run lint` сейчас интерактивен из-за deprecated `next lint`; нужен ESLint CLI config.

## Next PR recommendations

1. **PR 2 — QA foundation**: добавить Vitest, unit tests для `normalizeText/tokenizeForMatch/normalizeSize/getCatalogMatchCandidates`, export helper tests, `npm test` script.
2. **PR 3 — Shared export + formula escaping**: вынести export helpers, добавить formula escaping, contract tests, schema_version.
3. **PR 4 — Transactional match RPC**: заменить disable/insert/update на Postgres RPC для accept/reject/corrected/auto match, добавить consistency checks.
4. **PR 5 — Alias policy/conflicts**: сделать alias save observable, решить reviewer RLS, добавить conflict handling and minimum confirmations.
5. **PR 6 — OCR tiling**: shelf-zone cropping/tiling, dedupe, diagnostics by tile, budget controls.
6. **PR 7 — Catalog normalization**: persisted normalized fields, brand/size extraction on import, optional barcode/GTIN identifiers, background recalculation.
7. **PR 8 — Review scalability**: pagination, server-side search, selected bulk actions, per-job diagnostics on session page.

## Manual test plan

A. Загрузить фото с вафлями/печеньем, где товары точно есть в каталоге. Проверить recognized_items count, auto-matched count, candidates count, no-candidate count в job diagnostics/review.

B. Загрузить фото с Milka. Проверить, что Milka/Милка попадает в candidate; если размер/вкус неясен, строка остаётся на review.

C. Нажать manual match. Проверить active match, `status = matched`, alias create/update, повторный похожий товар использует alias.

D. Проверить unmatched. Убедиться, что `unmatched` появляется только после явного нажатия “Нет в ассортименте”; no match остаётся `needs_review`.

E. Проверить export. Matched строки имеют каталог; unmatched попадают в “Не найдено”; needs_review не считается “нет в ассортименте”; summary показывает counts.

F. Проверить UI. Фильтры review, групповое принятие `>= 90%`, pending кнопок, отсутствие client-side crash.
