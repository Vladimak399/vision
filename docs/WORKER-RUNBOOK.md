# Worker production runbook — Online Monitoring Worker

**Относится к:** TASK-30 (EXECUTION-ROADMAP)
**Дата:** 2026-07-09
**Статус задачи:** DONE (runbook написан). См. раздел «⚠️ Pre-production blockers» — worker требует правки кода перед запуском в проде.

---

## 1. Назначение

`Online Monitoring Worker` — это отдельный long-running процесс (Node/tsx), который
обрабатывает очередь парсинга онлайн-источников (SPAR, Metro, Магнит, X5/Пятёрочка).

Это **consumer** в модели producer/consumer:

```
  producer                      queue (БД)                 consumer
┌────────────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│ Vercel Cron        │      │ online_source_   │      │ online-monitoring-    │
│ GET /api/cron/...  │─────▶│   runs           │─────▶│ worker.ts             │
│ (Bearer CRON_SECRET)      │ status='queued'  │      │ (poll 5s, sequential) │
│ или кнопка "Запустить"│    │                  │      │                      │
│ в UI               │      │                  │      │ claim → fetch →       │
└────────────────────┘      └──────────────────┘      │ match → insert →     │
                                                      │ alerts                │
                                                      └──────────────────────┘
```

Worker **не** обслуживает HTTP-запросы. Он бесконечно опрашивает таблицу
`online_source_runs` на предмет `status = 'queued'` и последовательно обрабатывает
их через `claim` (атомарный `queued → running`).

Жизненный цикл одного run (`processRun`):
1. `claimRun` — атомарно переводит `queued → running`.
2. `getRun` — читает `company_id`, `source_id`, `source_store_id`.
3. Проверка `online_sources.legal_status = 'allowed'`, иначе run `cancelled`.
4. Выбор адаптера по `source_key`.
5. `adapter.fetchCatalog(...)` — асинхронная итерация товаров (публичный scrape, без ключей).
6. Upsert в `online_source_products` (`onConflict company_id,source_id,source_product_id`).
7. `matchOnlineProductsBatch(...)` — LLM-matching с каталогом → `online_product_matches`.
8. Для каждого товара: вставка цены в `online_prices` (+ `catalog_product_id`).
9. Алерты: `price_change` (есть пред. цена), `out_of_stock` (переход в OOS).
10. `finally`: `generateRunAlerts` (run-level, в т.ч. `run_failure`).
11. `status = succeeded | failed | cancelled` + `stats` в БД.

---

## 2. Компоненты

| Что | Путь | Роль |
|-----|------|------|
| Worker (consumer) | `server/worker/online-monitoring-worker.ts` | бесконечный poll loop, обработка run |
| Cron endpoint (producer) | `app/api/cron/online-monitoring/route.ts` | создаёт `queued` runs для включённых источников; защищён `CRON_SECRET` |
| Manual trigger (producer) | `app/app/online-monitoring/actions.ts` (`runSourceAction`) | создаёт `queued` run из UI |
| Run-менеджмент | `server/online-monitoring/run.ts` | `createRun`, `claimRun`, `getRun`, `RunContext` |
| Claim (service-role) | `server/online-monitoring/claim-run.ts` | альтернативный `claimRun` на service-role клиенте |
| Адаптеры | `server/online-monitoring/adapters/{spar-online,metro-online,magnit,x5-5ka}.ts` | scrape каталогов конкурентов |
| Matching | `server/online-monitoring/matching.ts` → `server/text-ai/catalog-match-batch.ts` | LLM-сопоставление с каталогом |
| Алерты | `server/online-monitoring/alerts.ts` | `price_change`, `out_of_stock`, `run_failure` |
| UI (healthcheck) | `app/app/online-monitoring/page.tsx`, `.../runs/page.tsx`, `.../alerts/page.tsx` | статусы и логи |

DB-таблицы (миграция `supabase/migrations/20260709120000_online_monitoring.sql`):
`online_sources`, `online_source_stores`, `online_source_products`,
`online_product_matches`, `online_prices`, `online_source_runs`,
`online_source_run_events`, `online_price_alerts`.

---

## 3. Предусловия (prerequisites)

До запуска worker-а убедись, что:

1. **Миграции применены** к прод-БД:
   - `20260709120000_online_monitoring.sql`
   - `20260709150000_online_price_alerts.sql`
2. **Источники настроены** в `online_sources`: `enabled = true` и
   `legal_status = 'allowed'`. Иначе cron создаст 0 runs, а ручной run будет `cancelled`.
3. **Привязки магазинов** есть в `online_source_stores` (связь source ↔ наш store,
   `source_store_id`, опц. `source_city`), `enabled = true`.
4. **AI-провайдер настроен** для matching (см. раздел 4, `AI_TEXT_*`).
5. **Фикс из раздела 10 применён** — иначе worker упадёт на первом же run.

---

## 4. Переменные окружения

Worker читает env через `getPublicEnv()` + напрямую. Минимальный набор для прод-запуска:

| Переменная | Нужна worker-у | Обязательна | Комментарий |
|------------|----------------|-------------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | **да** | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | **да** | anon key (исп. `getPublicEnv`) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | **да** | service-role; worker пишет в БД в обход RLS. Без неё `createSupabaseServiceRoleClient()` бросает ошибку |
| `AI_TEXT_PROVIDER` | ✅ (matching) | **да** | провайдер LLM для matching, напр. `gemini` |
| `AI_TEXT_MODEL` | ✅ (matching) | **да** | модель, напр. `gemini-2.5-flash-lite` |
| `AI_FALLBACK_PROVIDER` | ✅ (matching) | рекомендуется | fallback, напр. `openrouter` |
| `AI_FALLBACK_MODEL` | ✅ (matching) | рекомендуется | fallback модель |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | ✅ (matching) | **да** (тот, что выбран провайдером) | ключ соответствующего провайдера |
| `NODE_ENV` | частично | нет | при `test` подавляется запись run-событий в БД |
| `CRON_SECRET` | ❌ (нужен cron-endpoint) | для producer: **да** | Bearer-токен endpoint-а `/api/cron/online-monitoring`. Сам worker его не читает |
| `WORKER_SIGNATURE_SECRET` | ❌ | нет | **не используется** в коде worker/monitoring — мёртвая конфигурация, задокументирована в `.env.example`/`README` ошибочно |

> Адаптеры (SPAR/Metro/Магнит/X5) ходят на **публичные** сайты конкурентов,
> отдельных API-ключей не требуют.

---

## 5. Запуск worker

### 5.1 Production-режим (бесконечный цикл)

```bash
cd /path/to/vision
npm run worker:online
# = tsx server/worker/online-monitoring-worker.ts
```

Параметры из кода: `POLL_INTERVAL_MS = 5000` (пауза между опросами очереди),
`MAX_CONCURRENT_RUNS = 1` (обработка **последовательная**).

### 5.2 Single-run режим (dev / ручное перепарсивание одного run)

```bash
npx tsx server/worker/online-monitoring-worker.ts <RUN_ID>
# обрабатывает ОДИН run и завершается с кодом 0 (успех) или 1 (ошибка)
```

`RUN_ID` — `id` из `online_source_runs`. Удобно для восстановления упавшего run-а
(см. раздел 9).

### 5.3 systemd (рекомендуемый способ держать процесс в проде)

`/etc/systemd/system/pricevision-online-worker.service`:

```ini
[Unit]
Description=PriceVision Online Monitoring Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/pricevision/vision
ExecStart=/usr/bin/npx tsx server/worker/online-monitoring-worker.ts
EnvironmentFile=/opt/pricevision/vision/.env.production
Restart=always
RestartSec=5
# не делаем Restart=on-failure: процесс сам падает в catch → systemd поднимет заново
User=pricevision
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pricevision-online-worker

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pricevision-online-worker
journalctl -u pricevision-online-worker -f   # логи
```

> ⚠️ В коде **нет** обработки `SIGTERM`/`SIGINT` (graceful shutdown). При
> `systemctl stop` процесс убивается сразу; run, обрабатываемый в этот момент,
> останется в `status='running'` (см. раздел 10). Для корректной остановки
> останавливай заранее / перезапускай зависшие run-ы вручную.

### 5.4 Docker (вариант)

```dockerfile
# builder-стадия опущена; предполагаем, что зависимости уже установлены
FROM node:20-alpine
WORKDIR /app
COPY . .
# запуск worker-а как отдельного процесса в compose
CMD ["npx", "tsx", "server/worker/online-monitoring-worker.ts"]
```

В `docker-compose.yml` worker и web — отдельные services, sharing `.env`.

---

## 6. Создание runs (producer)

Worker сам ничего не планирует — runs создают producer-ы.

### 6.1 Cron endpoint

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
     https://<your-domain>/api/cron/online-monitoring
```

- Endpoint: `GET /api/cron/online-monitoring`
- Auth: `Authorization: Bearer <CRON_SECRET>` (иначе `401`)
- Создаёт по одному `queued` run на каждую включённую `online_source_stores`
  (с `online_sources.enabled=true` и `legal_status='allowed'`).

> ⚠️ **Vercel Cron не настроен.** В `vercel.json` нет ключа `crons` — см. раздел 10.
> Чтобы расписание работало на Vercel, нужно добавить `crons` в `vercel.json`
> (по roadmap это требует отдельного подтверждения архитектора) **либо** дёргать
> endpoint внешним cron (cron-job.org, GitHub Action schedule, серверный cron).

### 6.2 Ручной запуск из UI

Страница `app/app/online-monitoring/` → кнопка «Запустить» → `runSourceAction`
создаёт `queued` run (`trigger='manual'`). Дальше его подхватывает worker.

---

## 7. Healthcheck

**Dedicated `/api/health` endpoint отсутствует.** Healthcheck делается по состоянию
БД и логам.

### 7.1 По БД (основной способ)

Последний run по каждому источнику + статус:

```sql
select
  s.source_key,
  r.status,
  r.completed_at,
  (r.stats->>'productsUpserted')::int as products,
  (r.stats->>'pricesInserted')::int as prices,
  (r.stats->>'errors')::int as errors,
  r.error_summary
from online_source_runs r
join online_sources s on s.id = r.source_id
where r.id in (
  select id from online_source_runs r2
  where r2.source_id = r.source_id
  order by r2.created_at desc limit 1
);
```

Зависшие run-ы (worker упал, оставив `running`):

```sql
select id, source_id, started_at, status
from online_source_runs
where status = 'running'
  and started_at < now() - interval '1 hour';
```

Ошибки за последние сутки:

```sql
select source_id, status, error_summary, completed_at
from online_source_runs
where status = 'failed'
  and completed_at > now() - interval '1 day'
order by completed_at desc;
```

### 7.2 UI

- `app/app/online-monitoring/` — для каждого источника `last_run_at` и
  `last_run_status` (бейдж failed/cancelled).
- `app/app/online-monitoring/runs` — полный лог runs + события (`online_source_run_events`).
- `app/app/online-monitoring/alerts` — алерты (`price_change`, `out_of_stock`, `run_failure`).

### 7.3 Логи процесса

Worker пишет в `stdout/stderr` (`console.log/error`):
- `Online Monitoring Worker started`
- `Processing run <id>` / `Fetched N products from <source>`
- `Run <id> completed: ...` / `Run <id> failed: <msg>` / `Worker crashed: <err>`

В systemd: `journalctl -u pricevision-online-worker -f`.
В Docker: `docker logs -f <container>`.

### 7.4 Рекомендованные alert-правила (внешний мониторинг)

- Worker не пишет в лог > `2 × (время типичного run + 5s)` → процесс мёртв.
- Есть `online_source_runs` со `status='running'` старше 1 часа → завис.
- Доля `failed` за сутки > порога (напр. 20%) → проблема с источником/LLM.

---

## 8. Операции и жизненный цикл

- **Частота опроса:** 5 c (`POLL_INTERVAL_MS`).
- **Конкурентность:** 1 (последовательно). Запуск >1 инстанса worker-а **безопасен**
  (claim атомарный), но избыточен — runs всё равно обрабатываются последовательно.
  Рекомендуется ровно **1 инстанс**.
- **Идемпотентность:** upsert товаров по `(company_id, source_id, source_product_id)`;
  цены — append (история). Повторный прогон того же run создаст дубли цен, поэтому
  один run не перезапускают «второй раз» — см. раздел 9 для recovery.
- **Retry:** в коде авто-retry нет. Перезапуск упавшего run — вручную (раздел 9).
- **Graceful shutdown:** отсутствует (раздел 10).

---

## 9. Troubleshooting

| Симптом | Причина | Решение |
|---------|---------|---------|
| Worker падает сразу при обработке run | `claimRun`/`getRun` используют `createSupabaseServerClient()` → `cookies()` из `next/headers` вне HTTP-запроса | Применить фикс из раздела 10 |
| `401` при вызове cron endpoint | `CRON_SECRET` не задан/не совпадает | Задать `CRON_SECRET` в окружении; передавать `Bearer` |
| 0 runs создаётся cron-ом | нет `enabled` источников с `legal_status='allowed'` | проверить `online_sources`/`online_source_stores` |
| Run `cancelled` сразу | `legal_status != 'allowed'` | выставить `legal_status='allowed'` |
| Run `failed`: "Source not found" | `source_id` не существует | проверить связи |
| Run `failed`: "No adapter for <key>" | адаптер не зарегистрирован | проверить `registry.ts`/`worker.ts` импорты адаптеров |
| `matched=0`, `unmatched` растёт | LLM-matching не работает / нет ключа AI | проверить `AI_TEXT_*` и соответствующий API-ключ; см. логи ошибок matching |
| Run висит в `running` | worker убит (SIGTERM/OOM/падение) посреди run | Вернуть в очередь: `update online_source_runs set status='queued', started_at=null where id='<RUN_ID>' and status='running';` затем worker подхватит. Или single-run: `npx tsx server/worker/online-monitoring-worker.ts <RUN_ID>` |
| Много `errors` в stats | ошибки upsert отдельных товаров | см. `online_source_run_events` для этого run |

### Восстановление конкретного упавшего run

```bash
# 1. вернуть run в очередь (если он завис в running)
psql ... -c "update online_source_runs set status='queued', started_at=null where id='<RUN_ID>' and status='running';"

# 2. либо обработать ровно один run вне цикла
npx tsx server/worker/online-monitoring-worker.ts <RUN_ID>
```

---

## 10. ⚠️ Pre-production blockers / known issues

Эти пункты **мешают** запуску worker-а в проде «как есть». Runbook описывает
целевую процедуру; блокеры нужно устранить до прод-деплоя.

### B1. Worker падает на `claimRun`/`getRun` (КРИТИЧНО)

`online-monitoring-worker.ts` импортирует `claimRun` и `getRun` из
`server/online-monitoring/run.ts`, а они вызывают `createSupabaseServerClient()`
(`lib/supabase/server.ts`), который внутри дёргает `cookies()` из `next/headers`.
В автономном `tsx`-процессе (вне HTTP-запроса) это бросает ошибку → worker падает
на первом же run.

**Готовый фикс** (сервис-роль клиент, как уже сделано в `claim-run.ts`):

В `server/worker/online-monitoring-worker.ts`:
- заменить `import { claimRun, createRun, getRun } from "../online-monitoring/run";`
  на импорт `claimRun` из service-role модуля:
  `import { claimRun } from "../online-monitoring/claim-run";`
  (функция там идентична по сигнатуре и уже использует `createSupabaseServiceRoleClient()`);
- `getRun` в `run.ts` тоже на cookies-клиенте — добавить service-role версию
  (например, в `claim-run.ts`):
  ```ts
  export async function getRun(runId: string) {
    const supabase = createSupabaseServiceRoleClient();
    const { data, error } = await supabase
      .from("online_source_runs").select("*").eq("id", runId).single();
    if (error || !data) return null;
    return { id: data.id, companyId: data.company_id, sourceId: data.source_id,
             sourceStoreId: data.source_store_id, trigger: data.trigger,
             status: data.status, startedAt: data.started_at,
             completedAt: data.completed_at, parserVersion: data.parser_version,
             stats: data.stats, errorSummary: data.error_summary };
  }
  ```
  и импортировать `getRun` оттуда же;
- убрать неиспользуемый импорт `createRun` (в worker-е он не вызывается).

> Примечание: `RunContext` из `run.ts` остаётся для тестов — его трогать не надо.

### B2. Vercel Cron не настроен

`vercel.json` содержит только `git.deploymentEnabled`, ключа `crons` нет.
Endpoint `/api/cron/online-monitoring` **никто не дёргает автоматически**.
До прод-деплоя нужно либо добавить `crons` в `vercel.json` (требует отдельного
подтверждения архитектора согласно roadmap TASK-21.5), либо внешний cron к endpoint-у.

### B3. `CRON_SECRET` не задан в `.env.example`/`.env.local`

Cron endpoint возвращает `401`, пока `CRON_SECRET` не задан и не передаётся.
Обязателен для producer-а.

### B4. `WORKER_SIGNATURE_SECRET` — мёртвая конфигурация

Задокументирован в `.env.example` и `README.md`, но **нигде не читается** кодом
worker/monitoring. Можно убрать из документации или реализовать — сейчас не влияет.

### B5. RPC `claim_online_source_run` не существует в БД

`claimRun` (обе версии) вызывает `supabase.rpc("claim_online_source_run", ...)`,
но миграция с такой функцией отсутствует. Обе версии корректно падают в fallback
(атомарный `UPDATE ... eq("status","queued")`), так что это **латентное**
несоответствие, а не хард-фейл. При желании — добавить RPC для атомарности на уровне БД.

### B6. Нет graceful shutdown / lock timeout

Worker — бесконечный `while(true)` без обработки `SIGTERM`. При остановке run,
обрабатываемый в этот момент, остаётся `running` навсегда и **не будет перезапущен**
(getQueuedRuns берёт только `queued`). Recovery — SQL из раздела 9.
Рекомендация: добавить `process.on('SIGTERM'/'SIGINT', ...)` с доведением текущего
run до конца или возвратом в `queued`, и/или БД-сторонний lock-timeout для `running`.

---

## 11. Rollback / аварийное восстановление

- **Worker завис/упал:** `systemctl restart pricevision-online-worker`
  (или `docker restart`). Зависшие `running`-run-ы вернуть в `queued` (раздел 9).
- **Плохие цены попали в БД:** цены — append-история в `online_prices`; удали
  строки конкретного `run_id` и перезапусти run:
  ```sql
  delete from online_prices where run_id = '<RUN_ID>';
  update online_source_runs set status='queued', started_at=null where id='<RUN_ID>';
  ```
- **Откатить фичу целиком:** worker — отдельный процесс; достаточно остановить
  его (`systemctl stop ...`). Данные в БД остаются как история.

---

## 12. Чек-лист перед прод-запуском

- [ ] Миграции `20260709120000_online_monitoring.sql` + `20260709150000_online_price_alerts.sql` применены
- [ ] `online_sources`: `enabled=true`, `legal_status='allowed'`
- [ ] `online_source_stores`: привязки созданы и `enabled=true`
- [ ] `.env.production`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` заданы
- [ ] `AI_TEXT_PROVIDER`/`AI_TEXT_MODEL` + соответствующий API-ключ заданы (нужен для matching)
- [ ] Применён фикс **B1** (иначе worker падает на первом run)
- [ ] Настроен trigger runs: `CRON_SECRET` + cron (Vercel `crons` или внешний) — **B2/B3**
- [ ] Мониторинг: внешний алерт на отсутствие логов / зависшие `running` (раздел 7.4)
- [ ] (опц.) Graceful shutdown — **B6**
