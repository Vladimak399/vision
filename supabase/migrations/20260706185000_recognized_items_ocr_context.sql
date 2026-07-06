alter table public.recognized_items
  add column if not exists price_tag_text text,
  add column if not exists product_visible_text text,
  add column if not exists link_confidence numeric,
  add column if not exists review_reason text,
  add column if not exists position_hint text,
  add column if not exists old_price_minor bigint,
  add column if not exists promo_price_minor bigint;
