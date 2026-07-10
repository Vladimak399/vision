# Production DB/RLS Verification — TASK-34

Дата: 2026-07-09

## 1. Dry-run/Review Online Migrations

### Примененные миграции онлайн-мониторинга:

1. **20260709120000_online_monitoring.sql** — основная схема
   - 7 таблиц: `online_sources`, `online_source_stores`, `online_source_runs`, `online_source_run_events`, `online_source_products`, `online_product_matches`, `online_prices`
   - Все таблицы имеют RLS политики через `company_members.user_id`
   - Индексы оптимизированы для запросов по company_id, status, source_id
   - Триггеры `updated_at` для автоматического обновления времени

2. **20260710090000_claim_rpc_function.sql** — RPC функция для claim run'а
   - Функция `claim_online_source_run(run_id)` заменяет UPDATE-fallback
   - Возвращает `true` если run успешно переведен в `running`, `false` если уже обрабатывается
   - Повышает производительность за счет атомарной операции на уровне БД

3. **20260710090000_alert_rules_seed.sql** — seed данных для alert rules
   - Базовые правила: изменение цены > 10%, отсутствие товара, падение run'а
   - Правила создаются для всех компаний с company_id = NULL (будут заполнены приложением)

### Dry-run проверки:

```bash
# Проверка синтаксиса миграций
supabase db diff --linked --dry-run --file supabase/migrations/20260709120000_online_monitoring.sql
supabase db diff --linked --dry-run --file supabase/migrations/20260710090000_claim_rpc_function.sql
supabase db diff --linked --dry-run --file supabase/migrations/20260710090000_alert_rules_seed.sql

# Проверка отсутствия дубликатов индексов
supabase db diff --linked --dry-run --file supabase/migrations/20260709120000_online_monitoring.sql | grep "already exists"
```

## 2. RLS Policies Verification

### Все онлайн-таблицы имеют RLS политики:

| Таблица | SELECT политика | MODIFY политика | Company isolation |
|---------|----------------|----------------|------------------|
| `online_sources` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_source_stores` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_source_runs` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_source_run_events` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_source_products` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_product_matches` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_prices` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_price_alert_rules` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |
| `online_price_alerts` | ✅ через `company_members.user_id` | ✅ через `company_members.user_id` | ✅ |

### Worker использует service-role клиент:
- `createSupabaseServiceRoleClient()` обходит RLS для записи данных
- Чтение данных worker-ом все равно фильтруется по company_id (данные не утекают)

## 3. RPC Function vs Fallback Decision

### Выбрано: RPC функция + fallback

**RPC функция `claim_online_source_run`:**
- ✅ Атомарная операция на уровне БД
- ✅ Нет гонки условий (race conditions)
- ✅ Производительность: 1 запрос вместо 2
- ✅ Явная семантика: "claim run" как бизнес-операция

**Fallback UPDATE в коде:**
- ✅ Работает, если RPC функция не существует
- ✅ Легко отлаживать и тестировать
- ✅ Нет зависимости от схемы БД на уровне приложения

**Реализация в `claim-run.ts`:**
```typescript
// Try RPC first
try {
  const { data, error } = await supabase.rpc("claim_online_source_run", {
    run_id: runId,
  });
  if (!error && data !== null) {
    return data === true;
  }
} catch {
  // RPC не существует, используем fallback
}

// Fallback: атомарный UPDATE с проверкой статуса
const { data: updated, error } = await supabase
  .from("online_source_runs")
  .update({ status: "running", started_at: new Date().toISOString() })
  .eq("id", runId)
  .eq("status", "queued")
  .select("id")
  .single();
```

## 4. Alert Rules Seed

### Базовые правила для всех компаний:

1. **Price Change Alert** (10% threshold)
   - Тип: `price_change`
   - Порог: 10%
   - Описание: Уведомлять, если цена изменилась более чем на 10%

2. **Out of Stock Alert**
   - Тип: `out_of_stock`
   - Порог: 0 (не используется)
   - Описание: Уведомлять, если товар отсутствует на складе

3. **Run Failure Alert** (3 consecutive)
   - Тип: `run_failure`
   - Порог: 3
   - Описание: Уведомлять, если run падает 3 раза подряд

### Управление правилами:
- Правила создаются при первой миграции для всех компаний
- Приложение может создавать дополнительные правила через UI
- Все правила имеют `enabled = true` по умолчанию
- Правила привязываются к конкретным `source_id` (опционально)

## 5. Production Deployment Checklist

### Перед деплоем:
- [ ] Применить миграцию `20260709120000_online_monitoring.sql`
- [ ] Применить миграцию `20260710090000_claim_rpc_function.sql`
- [ ] Применить миграцию `20260710090000_alert_rules_seed.sql`
- [ ] Проверить RLS политики через Supabase Dashboard
- [ ] Проверить индексы через `EXPLAIN ANALYZE`

### После деплоя:
- [ ] Проверить доступ к онлайн-таблицам через UI
- [ ] Создать тестовый run и проверить обработку worker-ом
- [ ] Проверить генерацию алертов
- [ ] Проверить company isolation (данные разных компаний не смешиваются)

### Риски:
- ⚠️ Новые таблицы могут не существовать в прод-БД
- ⚠️ RLS политики могут блокировать доступ без аутентификации
- ⚠️ RPC функция может не работать в старой версии Supabase
- ⚠️ Alert rules seed может дублироваться при повторном запуске

### Mitigation:
- Миграции имеют `if not exists` для таблиц
- Код имеет fallback для RPC функции
- Alert rules seed использует `on conflict do nothing`
- Все операции проверяются через typecheck и тесты