# 04. База данных

## Таблицы

`companies`, `profiles`, `company_members`, `competitors`, `stores`, `catalog_products`, `catalog_imports`, `catalog_import_rows`, `monitoring_sessions`, `monitoring_photos`, `recognized_items`, `matches`, `aliases`, `evidence`, `price_history`, `reports`, `jobs`, `audit_events`.

Доменные таблицы имеют UUID `id`, `company_id`, timestamps и actor fields. Деньги: `price_minor bigint`, `currency char(3)`. Все timestamps — UTC.

## Ограничения

- Unique: `catalog_products(company_id, external_sku)` и `monitoring_photos(session_id, sha256)`.
- Один active match на recognized item.
- Price history создается только из confirmed item с evidence.
- Alias: normalized key, product, weight, confirmations, last confirmed at.
- Evidence-файлы удаляются физически через 90 дней; структурированные цены сохраняются.

Индексы покрывают `company_id`, foreign keys, job/status и `(catalog_product_id, observed_at desc)`. RLS требует membership; reviewer не меняет настройки, manager не управляет пользователями. Service role доступен только worker.
