# CHANGELOG

## 2026-07-07

### Added
- Добавлен `PROJECT_AUDIT.md` с технической картой проекта.
- Добавлен `IMPROVEMENT_PLAN.md` с поэтапным планом улучшений.
- Добавлен `npm test` на Node test runner + `tsx`.
- Добавлены unit-тесты для нормализации и сопоставления товаров.

### Changed
- Усилена логика `server/catalog-matching.ts`:
  - запрет кандидатов по одному значимому слову;
  - учет бренда, размера, типа товара, упаковки и вариантов/ароматов;
  - штрафы за mismatch бренда, размера и упаковки;
  - reason `different_variant_same_base_review` для сценария другой разновидности той же базовой позиции;
  - минимальный score для suggestion-кандидатов.
- Обновлен `README.md` с запуском, миграциями и Excel smoke-test.
- Добавлен `OPENAI_OCR_MODEL` в `.env.example`.

### Notes
- Миграции БД не создавались и destructive schema changes не выполнялись.
- `npm install` сообщает о vulnerabilities в dependency tree; исправление требует отдельного dependency upgrade плана.
