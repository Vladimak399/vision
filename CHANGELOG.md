# CHANGELOG

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
