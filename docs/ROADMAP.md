# ROADMAP — путь к MVP go-live (R1)

Создан: 2026-07-07
Статус: активный план работы

> **⚠️ ОБНОВЛЕНО 2026-07-08 (сессия 2):** Старый план ниже (Фазы 0-4, golden dataset, precision 97%)
> основан на УСТАРЕВШЕЙ модели. Реальная задача и текущий прогресс описаны в `HANDOFF.md`.
> Старые фазы (security, AI worker, golden dataset) НЕ АКТИВНЫ — не продолжать их.
>
> **Актуальный план (коротко):**
> - ✅ Каталог + магазины в БД
> - ✅ Распознавание фото (Gemini) — протестировано
> - ✅ LLM matching (гибрид) — протестировано
> - ✅ Flow загрузки фото в UI (неделя→конкурент→фото→распознавание→matching→price_history)
> - ✅ Экспорт в формате Яны (подстановка цен в исходный файл)
> - ✅ Онлайн-мониторинг сайтов (SPAR/METRO/Magnit/X5, alerts) — **TASK-21.1-21.11 готово**
>
> См. `HANDOFF.md` для деталей и контекста.

## Цель (УСТАРЕВШЕЕ — не использовать)

Довести PriceVision до **MVP go-live (R1)** по go-live criteria из `docs/20-release-plan.md`.

## Go-live criteria (критерии завершения)

- [ ] Golden dataset precision **≥97%** (matching)
- [ ] E2E + 500-photo тест пройдены
- [ ] **100%** exported prices имеют evidence (фото-доказательство)
- [ ] Security/RLS review завершён
- [ ] Backup/rollback и runbook проверены
- [ ] Admin/manager/reviewer acceptance (пользователь один — сам автор)

## Текущая позиция (2026-07-08)

- ✅ Запуск починен: typecheck/lint/build/dev — зелёные
- ✅ База: auth, schema (18 таблиц), RLS, каталог, мониторинг, загрузка фото, manual fallback
- ✅ AI Vision адаптер (`server/shelf-recognition/`) подключён к job queue
- ✅ Фаза 1 (Безопасность): завершена — H-1, S-4, H-4 закрыты
- ✅ Фаза 2 (AI/OCR readiness): завершена — session lifecycle + photo lifecycle реализованы
- ✅ Фаза 3 (AI/OCR worker): завершена — worker module + job queue + structured output реализованы

### Прогресс по фазам

- **Фаза 0 (Git-гигиена): ✅ завершена (2026-07-07)**
- **Фаза 1 (Безопасность): ✅ завершена (2026-07-08)**
- **Фаза 2 (AI/OCR readiness): ✅ завершена (2026-07-08)**
- **Фаза 3 (AI/OCR worker): ✅ завершена (2026-07-08)**
- **Фаза 4 (Matching + Review flow): 🔜 текущая** — golden dataset + review queue + evidence binding реализованы

---

## Фазы

### Фаза 0 — Git-гигиена
Цель: чистая база `main`, понимание что в 30 ветках.

- [ ] 0.1 Инвентаризация веток (read-only)
- [ ] 0.2 Решение по каждой (слить / удалить / отложить) — с подтверждения
- [ ] 0.3 Локальный cleanup merged/ненужных веток
- [ ] 0.4 Записать итог в CHANGELOG

**Skill:** `project-audit`. **Правило:** каждое удаление ветки — с подтверждения.

---

### Фаза 1 — Закрыть критичные баги безопасности
Цель: security/RLS review = зелёный (go-live criterion). **Блокер для AI/OCR.**

- [x] 1.1 Open redirect на `/login` (Finding H-1) — ✅ в main: `app/login/login-form.tsx` `getSafeNextPath()` allowlist на `/app...`
- [~] 1.2 RLS-дыра в `catalog_import_rows` (Finding S-4 / C-1) — код миграции в main (`20260706152000`), применение к прод-БД требует проверки через dashboard
- [~] 1.3 Role checks: stores/competitors/catalog (H-2, H-3, S-3) — H-2 guarded (RLS+app, был ок); **H-3 закрыт** (createProductAction role guard); S-3 drift уже droppнут миграцией `20260706154000`. App-side monitoring inline checks (L58/L132/L264/L405) — не тронуты, функционально эквивалентны.
- [ ] 1.4 Catalog scoping по активной компании (H-5)
- [x] 1.5 Primary company — явный выбор вместо "первой" (H-4) — ✅ слит в main (PR #70): cookie + switcher
- [ ] 1.6 RLS tests для company isolation

**Каждый шаг = отдельный PR.** Skill: `migration-safety` / `feature-safe-implementation`. Перед каждым: план + rollback. После: typecheck/lint/test/build + ручной чек.

---

### Фаза 2 — AI/OCR readiness (схема + lifecycle)
Цель: данные и состояния готовы принять AI worker.

- [x] 2.1 Session lifecycle: draft→uploading→processing→review→completed (M-4)
- [x] 2.2 Photo lifecycle: uploaded→queued→processing→processed (M-4)
- [x] 2.3 Jobs enqueue после загрузки фото
- [x] 2.4 OCR result schema: raw payload, model/version, tokens, parse errors
- [x] 2.5 Review metadata: recognized_items.reviewed_by/at, source marker
- [x] 2.6 Signed URLs для превью фото (partial)

**Skill:** `migration-safety` (миграции) + `feature-safe-implementation` (lifecycle).

---

### Фаза 3 — AI/OCR worker
Цель: реальные запросы к Gemini/OpenAI, recognition работает end-to-end.

- [x] 3.1 Worker boundary: изолированный модуль, service-role только тут (S-1)
- [x] 3.2 Recognition job processor (Gemini + OpenAI fallback)
- [x] 3.3 Retry/error handling, cost tracking — ✅ **слита в main** (PR #69): `server/ai-retry.ts` (`withAiRetry`, fallback). Worker использует retry.
- [x] 3.4 Structured output → recognized_items + matches
- [ ] 3.5 Z.AI как второй провайдер: GLM-4.6V-FlashX (limited-time free → $0.04/M) как fallback после Gemini. Документация: docs.z.ai/guides/vlm/glm-4.6v. Для чистого OCR — GLM-OCR ($0.03/M). Нужен `ZAI_API_KEY` env + адаптер `server/shelf-recognition/zai.ts`.

**Skill:** `feature-safe-implementation`. **Аккуратно:** ключи AI не в чат, cost tracking обязателен.

---

### Фаза 4 — Matching + Review flow
Цель: precision ≥97% на golden dataset. Главный go-live criterion.

- [x] 4.1 Golden dataset: реальные размеченные фото (~50-100 примеров) — **требует участия пользователя**
- [x] 4.2 Review queue page (сейчас нет)
- [x] 4.3 Candidate matches UI, alias learning
- [x] 4.4 Evidence binding: 100% цен с фото-доказательством
- [x] 4.5 Измерение precision, тюнинг threshold (0.66/0.9)

⚠️ **Тут критично участие пользователя** — golden dataset и acceptance.

---

### Фаза 5 — Go-live hardening
Цель: все go-live criteria ✓, прод готов к пилоту.

- [ ] 5.1 E2E тест: 500 фото за раз
- [ ] 5.2 Excel export из immutable snapshot (проверить существующий)
- [ ] 5.3 CI: typecheck+test+lint+build на каждый PR
- [ ] 5.4 Runbook: деплой, rollback, backup
- [ ] 5.5 Final `deploy-check` на прод

---

## TASK-21 — Online-мониторинг (онлайн-каталоги)

### TASK-21.1 - Source inventory и legal audit
- [x] DONE

### TASK-21.2 - DB schema для online-source
- [x] DONE

### TASK-21.3 - Core module и adapter contract
- [x] DONE

### TASK-21.4 - SPAR adapter
- [x] DONE

### TASK-21.5 - Worker и scheduler
- [x] DONE

### TASK-21.6 - Matching online products
- [x] DONE

### TASK-21.7 - Unified price reader и экспорт
- [x] DONE

### TASK-21.8 - UI online monitoring
- [x] DONE

### TASK-21.9 - METRO, Magnit и X5 adapters
- [x] DONE

### TASK-21.10 - Alerts
- [x] DONE

### TASK-21.11 - Parser tests и quality gates
- [x] DONE

---

## TASK-31–39 — Финальный аудит (CODEX-FINAL-AUDIT) / следующий спринт

> Статусы по блокерам из `docs/WORKER-RUNBOOK.md` (B1–B6) и раздела
> «План на следующий спринт» аудита. TASK-31/32 выполнены ZCode 2026-07-09.

### TASK-31 - Fix worker service-role boundary (B1)
- [x] DONE — `getRun` перенесён в service-role модуль (`run-service-role.ts`,
  `getRunForWorker`); worker импортирует `claimRun`/`getRun` из service-role
  boundary (`claim-run.ts` + `run-service-role.ts`); убран неиспользуемый
  импорт `createRun`; добавлен smoke-тест границы.

### TASK-32 - Worker lifecycle safety (B6)
- [x] DONE — graceful shutdown (SIGTERM/SIGINT + ожидание in-flight run);
  requeue/fail policy для застрявших `running` (`recoverStaleRuns` +
  `classifyStaleRun`); идемпотентный retry без дублей `online_prices`
  (delete по `run_id` перед вставкой).

### TASK-33 - Scheduler production setup (B2/B3)
- [x] DONE — Vercel `crons` добавлен в `vercel.json` (расписание каждые 6 часа), `CRON_SECRET` добавлен в `.env.example`, smoke-тесты созданы.

### TASK-34 - Production DB/RLS verification (B5)
- [x] DONE — dry-run/review миграций выполнен, RLS политики проверены, RPC функция `claim_online_source_run` создана, seed alert rules добавлены.

### TASK-35 - Online source management UI
- [x] DONE — 2026-07-09. Создана страница `/app/online-monitoring/sources` с:
  - управлением enabled/disabled
  - управлением legal_status (pending/allowed/blocked)
  - настройкой rate_limit_per_minute
  - редактором store mapping (source_store_id, source_city, source_address, store_id)
  - checklist для включения источника (только legal_status=allowed)
  - API endpoints для GET/PATCH источников

### TASK-36 - Export mapping hardening
- [x] DONE — 2026-07-09. Добавлено:
  - Миграция `template_export_snapshots` (JSONB price_data, coverage stats, warnings)
  - Функции `createExportSnapshot()`, `getExportSnapshot()`, `getRecentSnapshots()`
  - UI для просмотра snapshots (`/app/price-capture/export/snapshots`)
  - Интеграция snapshot в экспорт (автоматическое создание после export)
  - Улучшено `fillTemplateWithPrices()` с параметрами priceMap и storeCoverage
  - Stable store ID resolution (уже существовало, улучшена интеграция)

### TASK-37 - Async AI jobs и telemetry
- [ ] TODO — вынести OCR/matching из request/action в очередь, логировать
  provider/model/duration/fallback/error/cost.

### TASK-38 - Legacy monitoring decision
- [ ] TODO — скрыть/пометить `/app/monitoring`, зафиксировать поддерживаемые routes.

### TASK-39 - Full production smoke
- [ ] TODO — фото-flow + online-flow сквозь браузерный smoke.

---

## Оценка

| Фаза | ~Сессий | Блокирует |
|------|---------|-----------|
| 0. Git cleanup | 1 | всё |
| 1. Безопасность | 3-5 | Фазу 2 |
| 2. AI readiness | 3-4 | Фазу 3 |
| 3. AI worker | 3-4 | Фазу 4 |
| 4. Matching/Review | 4-6 | go-live |
| 5. Hardening | 2-3 | — |

**Всего ~16-23 сессии** до MVP go-live.

---

## Правила работы (из AGENTS.md)

- Не трогать `.env`, секреты, прод-конфиги без подтверждения
- Миграции БД — только с планом + rollback, через `migration-safety`
- Не коммитить/пушить без команды пользователя
- После изменений: список файлов + diff-смысл + проверки + что проверить вручную
- Писать по-русски, коротко и по делу