-- Дополняем price_history полями для capture flow.
-- Существующая таблица (из foundation) не имела confidence/source/photo_storage_path.

alter table public.price_history
  add column if not exists confidence numeric(5,4),
  add column if not exists source text not null default 'photo' check (source in ('photo', 'manual')),
  add column if not exists photo_storage_path text;

-- recognized_item_id / evidence_id / catalog_product_id были NOT NULL (старая модель),
-- в новом flow они могут быть null (товар не сматчен).
alter table public.price_history alter column recognized_item_id drop not null;
alter table public.price_history alter column evidence_id drop not null;
alter table public.price_history alter column catalog_product_id drop not null;

-- Индекс для быстрого поиска свежих цен при экспорте.
create index if not exists price_history_export_idx
  on public.price_history(company_id, week, store_id, catalog_product_id, captured_date desc)
  where week is not null;
