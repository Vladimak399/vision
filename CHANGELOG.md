# CHANGELOG

## 2026-07-08

### Merged
- **PR #69** (squash): AI retry helper + Gemini/text-AI fallback (for Z.AI integration). В main добавлен `server/ai-retry.ts` (`withAiRetry`, `AiHttpError`, `isAiFallbackCandidate`, `toSafeAiErrorMessage`) — общий retry/fallback хелпер для AI-провайдеров; `json-client.ts` и `gemini.ts` переведены на него; улучшен вывод AI-ошибок в diagnostics. Основа для Фазы 3 (Z.AI как 2-й провайдер).
  - Адресовано замечание Codex P2: default `maxAttempts` поднят 2→3 (восстановлена третья попытка, как было в `MAX_ATTEMPTS=3` до рефактора — иначе транзитный 429/5xx фейлился/уходил в fallback раньше).
- **PR #70** (squash): fix(H-4) — active company cookie with explicit selection. Раньше primary company всегда была первой по `created_at`; теперь хранится в persistent cookie, валидируется против RLS-scoped memberships. Switcher на dashboard. `server/active-company.ts` (new), `server/primary-membership.ts`, `app/app/actions.ts`, `app/app/page.tsx`. Контракт `getPrimaryCompanyMembership()` не менялся — 23 call-site без правок.
  - Перепроверка Фазы 1 (H-1/S-4/H-4): **H-1 (open redirect) и S-4 (catalog_import_rows RLS) уже в main**. H-4 был единственным реально открытым — закрыт этим PR. S-4 миграция в коде есть; применение к прод-БД требует отдельной проверки (dashboard).

### Pending merge
- **fix(H-3)**: `createProductAction` (`app/app/catalog/actions.ts`) не имела role-check — любой авторизованный member (incl. reviewer) мог создавать товары каталога через форму `catalog/page.tsx`. Добавлен guard на `CATALOG_WRITE_ROLES` (admin/manager), паттерн как в `importCatalogAction`. Все остальные write-actions (store/competitor/monitoring) уже guarded.
  - S-3 (RLS insert drift): уже закрыт в коде — миграция `20260706154000_company_access_rules.sql` дропнула member-insert drift-политики для stores/competitors/catalog_products. Верификация применения к прод-БД — отдельно.

### Infrastructure
- Добавлен skill `~/.zcode/skills/smart-start/SKILL.md` — `/smart-start` теперь доступен и через skills (раньше только как Codex command).

### Known issues (не блокируют)
- `npm run test` падает на Windows + Node 24: `spawnSync npx.cmd EINVAL` в `tests/catalog-matching.test.mjs:9`. Окружение, не связано с кодом. В CHANGELOG Фазы 0 заявлено `shell: true`, но в коде опции нет — отдельная задача.

## 2026-07-07 (Фаза 0 — Git-гигиена)

### Infrastructure
- Создан `AGENTS.md` — правила работы AI-агента (классификация задач, запреты, порядок).
- Создан `docs/ROADMAP.md` — дорожная карта к MVP go-live (Фазы 0-5).
- Создано 6 skills в `~/.zcode/skills`: project-audit, feature-safe-implementation, migration-safety, bugfix-investigation, precommit-review, deploy-check.
- Создана команда `/smart-start` в `~/.zcode/commands/smart-start.md`.
- Созданы 3 subagent'а в `.codex/agents/`: architecture-researcher, code-reviewer, test-writer.
- Cherry-picked ветка `internal-gemini-resilience` → `feature/ai-retry-resilience` (добавлен `server/ai-retry.ts` — общий retry/fallback хелпер для AI провайдеров).

### Git
- Удалено 72 удалённые ветки (65 merged + 7 superseded), 0 ошибок.
- Слит PR #68 (one-excel-export): одна кнопка Excel в worker UI.
- Закрыт PR #49 (Stabilize monitoring recognition): устарел (merge-base PR #48). Ценные идеи (OCR промпты, bulk-accept, job-диагностика, расширенная нормализация matching) сохранены в комментарии PR для переноса в Фазах 3-4.
- Закрыты ветки `codex-bxumit` и `6gcg0f` (дублировали main).

### Fixes
- `tests/catalog-matching.test.mjs`: добавлен `shell: true` в `execFileSync` (фикс `spawnSync npx.cmd EINVAL` на Windows + Node 24).

### Decisions
- Z.AI (GLM-4.6V-FlashX) добавлен как второй провайдер в Фазу 3 — fallback после Gemini, бесплатный на промо, дешёвый ($0.04/M) после.

## 2026-07-07

### Added
- Added matching regression tests.
- Added ESLint flat config.
- Added product matching review-rule documentation.

### Changed
- Strengthened catalog matching rules around base family, variants and packaging.
- Blocked auto-match for any candidate carrying a review reason.
- Documented local checks and Excel smoke-test flow in README.
- Added `OPENAI_OCR_MODEL` to `.env.example`.

### Notes
- No database migrations were added.
- Dependency upgrades should be handled in a separate PR.
