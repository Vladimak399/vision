-- Seed данных для alert rules — TASK-34
-- Добавляет базовые правила алертов для всех компаний

-- Вставляем базовые правила для всех компаний
-- Примечание: company_id будет подставлен на уровне приложения через цикл по компаниям
-- Здесь вставляем шаблонные правила с company_id = NULL (будут обновлены приложением)

-- Правило для изменения цен > 10%
insert into public.online_price_alert_rules (company_id, name, alert_type, threshold, enabled)
values (
  -- Будет заменено на реальный company_id в приложении
  NULL,
  'Изменение цены > 10%',
  'price_change',
  10.0,
  true
)
on conflict (company_id, name) do nothing;

-- Правило для отсутствия товара на складе
insert into public.online_price_alert_rules (company_id, name, alert_type, threshold, enabled)
values (
  NULL,
  'Товар отсутствует на складе',
  'out_of_stock',
  0, -- не используется для out_of_stock
  true
)
on conflict (company_id, name) do nothing;

-- Правило для падения run'а (3 подряд)
insert into public.online_price_alert_rules (company_id, name, alert_type, threshold, enabled)
values (
  NULL,
  'Run падает 3 раза подряд',
  'run_failure',
  3,
  true
)
on conflict (company_id, name) do nothing;

-- Комментарий для документации
comment on table public.online_price_alert_rules is
'Правила генерации алертов для онлайн-мониторинга';
comment on table public.online_price_alerts is
'Сгенерированные алерты по правилам';
comment on column public.online_price_alert_rules.alert_type is
'Тип алерта: competitor_cheaper, price_change, out_of_stock, run_failure';
comment on column public.online_price_alert_rules.threshold is
'Для price_change: % изменения, для run_failure: количество подряд';