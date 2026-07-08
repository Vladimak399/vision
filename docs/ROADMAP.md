# ROADMAP — путь к MVP go-live (R1)

Создан: 2026-07-07
Статус: активный план работы

## Цель

Довести PriceVision до **MVP go-live (R1)** по go-live criteria из `docs/20-release-plan.md`.

## Go-live criteria (критерии завершения)

- [ ] Golden dataset precision **≥97%** (matching)
- [ ] E2E + 500-photo тест пройдены
- [ ] **100%** exported prices имеют evidence (фото-доказательство)
- [ ] Security/RLS review завершён
- [ ] Backup/rollback и runbook проверены
- [ ] Admin/manager/reviewer acceptance (пользователь один — сам автор)

## Текущая позиция (2026-07-07)

- ✅ Запуск починен: typecheck/lint/test/build/dev — всё зелёное
- ✅ База: auth, schema (18 таблиц), RLS, каталог, мониторинг, загрузка фото, manual fallback
- ✅ AI Vision адаптер существует (`server/shelf-recognition/`), но не подключён к jobs
- ❌ 1 critical + 6 high багов блокируют AI/OCR (см. `docs/audits/full-project-audit-before-ai-and-web-sources.md`)
- ❌ ~30 незакрытых веток от прошлой AI-работы
- ❌ Session/photo lifecycle статичен (status = draft)
- ❌ Нет review queue, нет OCR result storage, нет signed URLs

### Прогресс по фазам

- **Фаза 0 (Git-гигиена): ✅ завершена (2026-07-07)**
  - Удалено 72 ветки (65 merged + 7 superseded), 0 ошибок
  - Слит PR #68 (one-excel-export)
  - Закрыт PR #49 (устарел, идеи сохранены для Фаз 3-4)
  - Cherry-picked `internal-gemini-resilience` → ветка `feature/ai-retry-resilience` (ai-retry.ts основа для Z.AI fallback)
  - Закрыты `codex-bxumit`, `6gcg0f` (дубли main)
  - Настроена инфраструктура: AGENTS.md, 6 skills, /smart-start, 3 subagent'а
  - **Важно для нового чата:** баги H-1 (open redirect), S-4 (catalog_import_rows RLS), H-4 (company scope) уже слиты в main — перепроверить реальное состояние перед Фазой 1
- **Фаза 1 (Безопасность): 🔜 следующая** — перепроверить актуальность багов (многие уже слиты)

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

- [ ] 1.1 Open redirect на `/login` (Finding H-1)
- [ ] 1.2 RLS-дыра в `catalog_import_rows` (Finding S-4 / C-1)
- [ ] 1.3 Role checks: stores/competitors/catalog (H-2, H-3, S-3)
- [ ] 1.4 Catalog scoping по активной компании (H-5)
- [ ] 1.5 Primary company — явный выбор вместо "первой" (H-4)
- [ ] 1.6 RLS tests для company isolation

**Каждый шаг = отдельный PR.** Skill: `migration-safety` / `feature-safe-implementation`. Перед каждым: план + rollback. После: typecheck/lint/test/build + ручной чек.

---

### Фаза 2 — AI/OCR readiness (схема + lifecycle)
Цель: данные и состояния готовы принять AI worker.

- [ ] 2.1 Session lifecycle: draft→uploading→processing→review→completed (M-4)
- [ ] 2.2 Photo lifecycle: uploaded→queued→processing→processed (M-4)
- [ ] 2.3 Jobs enqueue после загрузки фото
- [ ] 2.4 OCR result schema: raw payload, model/version, tokens, parse errors
- [ ] 2.5 Review metadata: recognized_items.reviewed_by/at, source marker
- [ ] 2.6 Signed URLs для превью фото

**Skill:** `migration-safety` (миграции) + `feature-safe-implementation` (lifecycle).

---

### Фаза 3 — AI/OCR worker
Цель: реальные запросы к Gemini/OpenAI, recognition работает end-to-end.

- [ ] 3.1 Worker boundary: изолированный модуль, service-role только тут (S-1)
- [ ] 3.2 Recognition job processor (Gemini + OpenAI fallback)
- [ ] 3.3 Retry/error handling, cost tracking — ✅ основа готова: `server/ai-retry.ts` (cherry-pick из internal-gemini-resilience)
- [ ] 3.4 Structured output → recognized_items + matches
- [ ] 3.5 Z.AI как второй провайдер: GLM-4.6V-FlashX (limited-time free → $0.04/M) как fallback после Gemini. Документация: docs.z.ai/guides/vlm/glm-4.6v. Для чистого OCR — GLM-OCR ($0.03/M). Нужен `ZAI_API_KEY` env + адаптер `server/shelf-recognition/zai.ts`.

**Skill:** `feature-safe-implementation`. **Аккуратно:** ключи AI не в чат, cost tracking обязателен.

---

### Фаза 4 — Matching + Review flow
Цель: precision ≥97% на golden dataset. Главный go-live criterion.

- [ ] 4.1 Golden dataset: реальные размеченные фото (~50-100 примеров) — **требует участия пользователя**
- [ ] 4.2 Review queue page (сейчас нет)
- [ ] 4.3 Candidate matches UI, alias learning
- [ ] 4.4 Evidence binding: 100% цен с фото-доказательством
- [ ] 4.5 Измерение precision, тюнинг threshold (0.66/0.9)

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
