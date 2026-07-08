# CHANGELOG

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
