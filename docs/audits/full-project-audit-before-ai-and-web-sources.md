# Full project audit before AI and web sources

## Executive summary

Follow-up verification confirmed that dependency resolution is healthy and both typecheck and production build pass.

The project is not yet ready to proceed directly into website source architecture or AI/OCR work because product-data write coverage, authorization consistency, redirect validation, tenant scoping, and monitoring lifecycle semantics still need to be tightened first. The current critical blocker is the `catalog_import_rows` RLS policy gap, which can prevent catalog import row writes even though the catalog import flow depends on persisting those rows.

## Validation results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Follow-up verification completed successfully. |
| `npm run build` | Passed | Follow-up verification completed successfully. |

### Follow-up verification

- `npm install --package-lock-only` — no changes
- `npm run typecheck` — passed
- `npm run build` — passed
- `git status --short` — clean

## Critical blockers

### Finding C-1: Catalog import row writes are blocked by RLS policy gap

Severity: Critical

The catalog import workflow depends on writing `catalog_import_rows`, but scoped row-level security policies for those row writes are not yet defined. This remains a blocker before AI/OCR or X5/SPAR work because source ingestion and later recognition/matching flows need reliable, auditable import-row persistence.

Recommended fix: add scoped RLS policies for `catalog_import_rows` that allow authenticated company members to insert and read rows only through imports belonging to their company, while preserving tenant isolation.

## Informational findings

### Finding I-1: Earlier audit environment had dependency resolution failure

Severity: Info

An earlier audit environment reported missing `papaparse` and `xlsx` resolution and treated build/typecheck failure as a critical blocker. Follow-up dependency verification found that `package.json` already declares `papaparse`, `xlsx`, and `@types/papaparse`; `package-lock.json` already contains entries for `node_modules/@types/papaparse`, `node_modules/papaparse`, and `node_modules/xlsx`; `npm install --package-lock-only` made no changes; and both `npm run typecheck` and `npm run build` passed. The earlier failure was not reproducible after dependency verification and does not block AI/OCR or X5/SPAR anymore.

## Other findings to keep before website sources and AI/OCR

- Align role checks for stores, competitors, and catalog so server actions consistently enforce the same membership and authorization model.
- Fix login `next` redirect validation so post-login navigation cannot be abused for unsafe redirects.
- Fix explicit company scoping and catalog company filtering so all tenant-sensitive reads and writes are bound to the active company.
- Define monitoring session lifecycle semantics before expanding ingestion, recognition, and matching flows.

## Recommended next PR sequence

1. Add scoped RLS policies for `catalog_import_rows`.
2. Align role checks for stores, competitors, and catalog.
3. Fix login `next` redirect validation.
4. Fix explicit company scoping / catalog company filtering.
5. Define monitoring session lifecycle.
6. Add website source architecture.
7. Add AI/OCR.
