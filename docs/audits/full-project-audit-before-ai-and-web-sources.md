# Full project audit before AI/OCR and web price sources

Date: 2026-07-06  
Branch: `audit/full-project-audit-before-ai-and-web-sources`  
Scope: audit-only PR. No application code, UI, migrations, or schema changes were made.

## 1. Executive summary

PriceVision has a coherent early foundation for authenticated company-scoped work: users sign in through Supabase Auth, app pages use the current user's primary company membership, core tables have RLS enabled, monitoring sessions can be created, photos can be uploaded to a private Supabase Storage bucket, client-side photo compression is in place, and manual recognized items can be entered as a fallback.

Follow-up verification confirmed that dependency resolution is healthy and both `npm run typecheck` and `npm run build` pass. The earlier dependency-resolution failure around `papaparse` and `xlsx` was not reproducible after dependency verification and is not a current blocker.

The project is **not ready to start AI/OCR or X5/SPAR website-source implementation yet**. The most important remaining blockers are:

- Catalog import writes to `catalog_import_rows`, but that table lacks the required scoped RLS insert/read coverage, so authenticated user imports can fail to persist row-level audit/error details.
- Several server actions permit broad member writes on RLS while app-side role checks are inconsistent for stores, competitors, catalog import, and direct catalog product creation.
- Login redirects trust the `next` search parameter on the client, creating an open-redirect risk.
- The app uses the first membership as a hidden primary company and has no company switcher; this can produce confusing cross-company behavior for users in multiple companies.
- Catalog listing can mix products from all user memberships because catalog loading is not explicitly scoped to the active company.
- The current schema has promising AI/reporting primitives (`recognized_items`, `matches`, `evidence`, `price_history`, `reports`, `jobs`), but website-source runs, raw payload storage, external product identities, and source disable/rate-limit controls are missing.

## 2. Current project status

### Implemented and visible in code

- Authentication: `/login` uses Supabase email/password auth, and authenticated app pages redirect anonymous users to login.
- Company access: pages and actions use membership lookup from `company_members`; most reads filter by `company_id`.
- Stores and competitors: simple creation/list pages exist.
- Catalog: manual product creation helper/action exists, plus CSV/XLS/XLSX import flow.
- Monitoring: list, create, session detail, photo upload, client-side compression, duplicate photo hash protection, and manual recognized item fallback exist.
- Supabase: foundation migration defines core business tables, enums, RLS helper functions, table policies, and storage buckets/policies for photos and reports.
- Deployment config: Next.js config enables React strict mode and configures Server Actions body size to `12mb`.

### Validation results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | Follow-up verification completed successfully. |
| `npm run build` | Passed | Follow-up verification completed successfully. |

### Follow-up verification

- `npm install --package-lock-only` — no changes.
- `npm run typecheck` — passed.
- `npm run build` — passed.
- `git status --short` — clean.

### Informational note on earlier dependency failure

An earlier audit environment reported missing `papaparse` and `xlsx` resolution and treated build/typecheck failure as a critical blocker. Follow-up dependency verification found that `package.json` already declares `papaparse`, `xlsx`, and `@types/papaparse`; `package-lock.json` already contains entries for `node_modules/@types/papaparse`, `node_modules/papaparse`, and `node_modules/xlsx`; `npm install --package-lock-only` made no changes; and both `npm run typecheck` and `npm run build` passed. The earlier failure was not reproducible after dependency verification and does not block AI/OCR or X5/SPAR anymore.

## 3. Critical blockers

### Finding C-1: Catalog import row writes are blocked by RLS policy gap

- Severity: Critical
- Affected files/tables: `app/app/catalog/actions.ts`, `public.catalog_import_rows`, `supabase/migrations/20260703132000_foundation.sql`
- Why it matters: `catalog_import_rows` has RLS enabled, and the catalog import action inserts row results after processing each catalog row. Without scoped insert/read policies, authenticated imports can create an import record and products but fail to persist row-level audit/error details. This undermines catalog import observability and future ingestion workflows.
- Recommended fix: Add a migration with scoped insert/select policies for `catalog_import_rows`, preferably checking membership/role through the parent `catalog_imports.company_id`. Do not use service role to bypass user-facing RLS.
- Blocks AI/OCR: Yes
- Blocks X5/SPAR website sources: Yes

## 4. High priority issues

### Finding H-1: Login uses unvalidated `next` parameter

- Severity: High
- Affected files/tables: `app/login/login-form.tsx`
- Why it matters: After successful login, the client performs `router.replace(next)` directly from URL search params. A crafted login URL could redirect users away from the app.
- Recommended fix: Add a local-path allowlist helper that accepts only internal app paths such as `/app...` and falls back to `/app` for absolute URLs, protocol-relative URLs, malformed values, or disallowed paths.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

### Finding H-2: Store and competitor creation lack app-side admin/manager restrictions

- Severity: High
- Affected files/tables: `app/app/stores/actions.ts`, `app/app/competitors/actions.ts`, `supabase/migrations/20260706120000_reference_directories_member_insert.sql`, `supabase/migrations/20260703132000_foundation.sql`
- Why it matters: RLS currently has later insert policies that allow any company member to insert stores and competitors, while the base policies suggest stricter admin/manager or admin-only writes. Reviewers should not be able to expand reference directories unless product policy explicitly allows it.
- Recommended fix: Decide the product permission model, then align app-side checks and RLS policies. Most likely: admin/manager can create stores, admin can create competitors, reviewer cannot create either.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: Yes, because website source runs need trusted store/source mappings.

### Finding H-3: Catalog import and manual catalog product creation lack explicit role checks

- Severity: High
- Affected files/tables: `app/app/catalog/actions.ts`, `server/catalog.ts`, `supabase/migrations/20260706140000_catalog_products_insert_policy.sql`
- Why it matters: Catalog data is the matching backbone. The import action accepts any primary company member at the app layer and a later insert policy permits any member to insert catalog products. Reviewers should not be able to alter the product catalog unless that is intentional.
- Recommended fix: Restrict catalog creation/import/update to admin/manager in both app actions and RLS. Add explicit user-friendly permission messages on catalog import page/actions.
- Blocks AI/OCR: Yes
- Blocks X5/SPAR website sources: Yes

### Finding H-4: Primary company selection is implicit and first-created only

- Severity: High
- Affected files/tables: `server/primary-membership.ts`, `server/memberships.ts`, all `/app/*` routes/actions that call `getPrimaryCompanyMembership`
- Why it matters: Multi-company users are silently scoped to the first membership ordered by `company_members.created_at`. This is easy to misinterpret, and future web-source jobs/reports may run against the wrong company.
- Recommended fix: Add explicit company selection in URL/session/cookie and require actions to receive or derive an explicit current company. Keep RLS as the final protection.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: Yes

### Finding H-5: Catalog page can mix products from all user memberships

- Severity: High
- Affected files/tables: `server/catalog.ts`, `app/app/catalog/page.tsx`, `public.catalog_products`
- Why it matters: The catalog page displays the primary company context, but `getCatalogProducts()` selects all RLS-visible catalog rows without an explicit `.eq("company_id", primaryCompanyId)`. Users who belong to multiple companies can see a mixed catalog while the UI labels only one company.
- Recommended fix: Pass the selected/current company ID into catalog loaders/actions and filter explicitly by `company_id`, while keeping RLS as a defense-in-depth control.
- Blocks AI/OCR: Yes, because recognition matching must use the intended company catalog only.
- Blocks X5/SPAR website sources: Yes, because external-source matching must not mix company catalogs.

### Finding H-6: `catalog_import_rows` does not carry `company_id`

- Severity: High
- Affected files/tables: `public.catalog_import_rows`, `app/app/catalog/actions.ts`
- Why it matters: Row records are scoped only through `import_id`; policies and joins must always traverse `catalog_imports`. This is possible but fragile for future audit screens, worker processing, and source-import parity.
- Recommended fix: Consider adding `company_id` in a future migration or enforce all access via parent-import joins with carefully tested policies and indexes.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: Yes, if website imports reuse row-level raw/error storage patterns.

## 5. Medium priority issues

### Finding M-1: Server Actions body limit may be too low for multiple photos

- Severity: Medium
- Affected files/tables: `next.config.ts`, `app/app/monitoring/[sessionId]/photo-upload-form.tsx`, `app/app/monitoring/actions.ts`
- Why it matters: The app allows multiple files and per-file limit is 10 MB, while Server Actions body size is 12 MB. Two valid 6 MB prepared photos or two near-10 MB photos can exceed the request body even though each individual file is valid.
- Recommended fix: Either limit UI to one file per request, set a lower aggregate client limit, move uploads to signed/direct Storage upload, or increase body limit with clear infrastructure constraints.
- Blocks AI/OCR: Yes, because photo intake reliability is foundational.
- Blocks X5/SPAR website sources: No

### Finding M-2: Partial multi-photo upload is not transactional

- Severity: Medium
- Affected files/tables: `app/app/monitoring/actions.ts`, `public.monitoring_photos`, Storage bucket `monitoring-photos`
- Why it matters: The upload loop saves files one by one. If the second file fails, the first file remains uploaded and inserted, but the user sees an error for the batch. This is not a data-integrity breach, but the UX and retry semantics are confusing.
- Recommended fix: Return a per-file result summary, or make uploads single-file/retryable, or implement compensating rollback for earlier files when batch policy requires all-or-nothing.
- Blocks AI/OCR: No, but it affects operator trust.
- Blocks X5/SPAR website sources: No

### Finding M-3: Client image compression does not support HEIC/HEIF conversion

- Severity: Medium
- Affected files/tables: `app/app/monitoring/[sessionId]/photo-upload-form.tsx`, Storage bucket `monitoring-photos`
- Why it matters: iPhone users commonly produce HEIC/HEIF photos. The current UX rejects them, which can block real store monitoring unless users change camera settings or manually convert files.
- Recommended fix: Decide whether to support HEIC conversion client-side/server-side, document operator camera settings, or add a preprocessing pipeline.
- Blocks AI/OCR: Medium risk; AI recognition needs reliable photo ingestion from field devices.
- Blocks X5/SPAR website sources: No

### Finding M-4: Monitoring session lifecycle is mostly static

- Severity: Medium
- Affected files/tables: `public.monitoring_sessions`, `app/app/monitoring/actions.ts`, `app/app/monitoring/[sessionId]/page.tsx`
- Why it matters: Sessions are created as `draft`; upload actions do not transition status to uploading/processing/review. AI/OCR workers will need deterministic state transitions and retry/error semantics.
- Recommended fix: Define lifecycle transitions before AI work: draft → uploading → processing → review → completed/failed/cancelled. Add action/worker ownership for each transition.
- Blocks AI/OCR: Yes
- Blocks X5/SPAR website sources: No

### Finding M-5: Product matching schema lacks external-source identity model

- Severity: Medium
- Affected files/tables: `public.matches`, `public.aliases`, `public.catalog_products`
- Why it matters: Current `matches` links recognized photo items to catalog products. Website sources need source-specific product IDs, URLs, raw titles, current availability, and stable mapping history independent from photo-recognized items.
- Recommended fix: Add future `price_sources`, `source_runs`, `source_products`, `source_prices`, and `external_product_matches` tables rather than overloading `recognized_items`.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: Yes

### Finding M-6: `price_history` requires photo evidence and recognized item

- Severity: Medium
- Affected files/tables: `public.price_history`, `public.evidence`, `public.recognized_items`
- Why it matters: Website prices do not naturally have `recognized_item_id` or photo `evidence_id`. Requiring these fields prevents storing X5/SPAR observations without fake records.
- Recommended fix: Generalize observations/evidence so price history can reference either photo evidence or web evidence/source run payloads.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: Yes

### Finding M-7: Broad `select("*")` in catalog helper

- Severity: Medium
- Affected files/tables: `server/catalog.ts`
- Why it matters: RLS scopes rows, but broad selection can accidentally expose future sensitive catalog columns to UI code and increases coupling.
- Recommended fix: Replace `select("*")` with explicit columns and keep mapper synchronized.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

### Finding M-8: Import file type validation is extension-based and defaults unknown extensions to CSV

- Severity: Medium
- Affected files/tables: `app/app/catalog/actions.ts`, `app/app/catalog/import/import-form.tsx`
- Why it matters: Server-side import accepts any non-XLS/XLSX file as CSV. Bad or mislabeled files can produce confusing parser errors or memory-heavy processing.
- Recommended fix: Validate MIME/extension/size server-side, set a max import size, and reject unsupported extensions explicitly.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: Yes, because external imports/runs need robust raw payload validation.

## 6. Low priority cleanup

### Finding L-1: Monitoring route/action file is becoming large

- Severity: Low
- Affected files/tables: `app/app/monitoring/actions.ts`, `app/app/monitoring/[sessionId]/page.tsx`
- Why it matters: Monitoring combines session creation, upload validation, storage path construction, hashing, manual item parsing, and UI detail rendering. AI/OCR will add queueing and review complexity.
- Recommended fix: Later split into `server/monitoring/sessions`, `server/monitoring/photos`, `server/monitoring/manual-items`, and route-level action wrappers.
- Blocks AI/OCR: No, but should happen before large AI feature work.
- Blocks X5/SPAR website sources: No

### Finding L-2: Duplicate docs/database folders can confuse source of truth

- Severity: Low
- Affected files/tables: `db/migrations/0001_foundation.sql`, `supabase/migrations/*`, `db/README.md`, `supabase/README.md`
- Why it matters: There are both `db/` and `supabase/` migration locations. It is not obvious whether `db/` is historical documentation or active migration input.
- Recommended fix: Document the authoritative migration path and mark legacy SQL as reference-only or remove it in a cleanup PR.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

### Finding L-3: Unused imports and dependencies should be reviewed periodically

- Severity: Low
- Affected files/tables: `app/app/catalog/page.tsx`, `package.json`
- Why it matters: `CatalogProduct` appears imported but unused; `clsx`, `lucide-react`, and `tailwind-merge` are listed but not currently obvious in the app code. This is cleanup, not a product blocker.
- Recommended fix: Run lint/dependency checks and remove unused imports/packages if confirmed.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

### Finding L-4: Storage paths are displayed to end users

- Severity: Low
- Affected files/tables: `app/app/monitoring/[sessionId]/page.tsx`
- Why it matters: Buckets are private and paths are company-prefixed, but showing full object paths is noisy and can leak implementation details.
- Recommended fix: Display filename/status only by default; reserve full paths for an admin/debug panel.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

## 7. Security/RLS findings

### Finding S-1: No service-role client is currently used in user-facing flows

- Severity: Info
- Affected files/tables: `lib/env.ts`, `lib/supabase/server.ts`, app actions
- Why it matters: `SUPABASE_SERVICE_ROLE_KEY` is optional in server env parsing, but user flows use the anon server client with cookies. This is good because RLS remains active.
- Recommended fix: Keep service role out of route actions/pages. If workers need it later, isolate in worker-only modules and require signature/auth checks.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

### Finding S-2: RLS helper functions use `security definer`

- Severity: Medium
- Affected files/tables: `public.is_company_member`, `public.has_company_role`
- Why it matters: This is a common pattern to avoid recursive RLS, but security-definer functions must keep a fixed `search_path` and minimal logic. The migration does set `search_path = public`, which is good.
- Recommended fix: Keep functions simple, add tests for cross-company access, and avoid dynamic SQL or user-controlled table names.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

### Finding S-3: Insert policy drift weakens reviewer restrictions

- Severity: High
- Affected files/tables: `supabase/migrations/20260706120000_reference_directories_member_insert.sql`, `supabase/migrations/20260706140000_catalog_products_insert_policy.sql`
- Why it matters: Later migrations add member-level insert policies that can bypass stricter base write policies for insert operations. RLS policies are permissive when any policy grants access.
- Recommended fix: Replace member insert policies with role-based policies aligned with the product permission matrix.
- Blocks AI/OCR: Yes for catalog integrity
- Blocks X5/SPAR website sources: Yes for source/store integrity

### Finding S-4: `catalog_import_rows` access policy is incomplete

- Severity: Critical
- Affected files/tables: `public.catalog_import_rows`
- Why it matters: RLS is enabled but no scoped policy is defined for the row-level import records needed by the catalog import workflow. This can block import observability and future audit screens.
- Recommended fix: Add parent-scoped policies through `catalog_imports` and verify with Supabase tests.
- Blocks AI/OCR: Yes
- Blocks X5/SPAR website sources: Yes

### Finding S-5: Role matrix is not centralized

- Severity: Medium
- Affected files/tables: `app/app/*/actions.ts`, `supabase/migrations/*`
- Why it matters: Permissions are hardcoded in multiple actions and in RLS SQL. Drift is already visible between actions and policies.
- Recommended fix: Add a documented permission matrix and, where possible, central server helpers such as `requireCompanyRole(['admin','manager'])`.
- Blocks AI/OCR: No
- Blocks X5/SPAR website sources: No

## 8. Supabase/database findings

### Current useful tables

- Company/auth: `companies`, `profiles`, `company_members`
- Reference data: `stores`, `competitors`, `catalog_products`, `aliases`
- Catalog import: `catalog_imports`, `catalog_import_rows`
- Monitoring/photos: `monitoring_sessions`, `monitoring_photos`, `recognized_items`, `matches`, `evidence`
- Reporting/jobs: `price_history`, `reports`, `jobs`, `audit_events`

### Missing or incomplete for next stages

1. AI/OCR readiness gaps:
   - No explicit OCR provider/result table for raw model output, prompt/version, token usage, or parsing errors.
   - `jobs` exists but app does not enqueue photo recognition jobs yet.
   - `monitoring_photos` has width/height/status/error fields, but upload does not populate dimensions or transition queue status.
   - `recognized_items` has bbox/confidence but no source marker (`manual`, `ocr`, `web`) and no review metadata (`reviewed_by`, `reviewed_at`, correction notes).

2. Matching/readiness gaps:
   - `matches` supports one active match per recognized item but not multiple ranked candidate suggestions lifecycle.
   - No indexes on common matching keys such as normalized name/brand/size/barcode because barcode does not exist yet.
   - No barcode/GTIN field in `catalog_products`.

3. Report/evidence gaps:
   - `price_history` is photo-recognition-specific and cannot represent website observations cleanly.
   - `reports` stores a path and snapshot but no status, generated_at, file metadata, or export format/version.

4. Website source gaps:
   - No tables for sources, source stores/cities, source runs, run logs, raw payloads, source products, source prices, parser versions, rate-limit state, or disabled/manual pause flags.

## 9. Monitoring flow findings

### What works now

- Authenticated users can view monitoring sessions scoped by company.
- Admin/manager users can create sessions after selecting a company store.
- Session detail page displays status, store, photos, and recognized items.
- Upload validates file presence, MIME type, per-file size, and session ownership.
- Duplicate photo content is protected by `unique(session_id, sha256)`.
- Manual recognized item fallback checks session/photo ownership and validates name/price lengths and bounds.

### Gaps before AI/OCR

- Session status remains `draft`; upload does not set `uploading` or enqueue processing.
- No job creation occurs after photo upload.
- No review queue/page exists for `needs_review` items.
- Manual fallback is embedded on the session detail page; this is acceptable for MVP but may become too prominent once AI is the main flow.
- No signed image preview/download is implemented; operators see storage paths rather than visual evidence.
- Duplicate hash error is a generic DB error instead of a controlled duplicate message.

## 10. Catalog import findings

### Strengths

- Supports CSV delimiter guessing and XLS/XLSX first-sheet parsing.
- Normalizes headers to lowercase and accepts English/Russian header aliases.
- Uses `company_id` on catalog products and upserts on `(company_id, external_sku)`.
- Records import metadata and intended row-level results.

### Risks

- No server-side file size cap for catalog import.
- Unknown file extensions are treated as CSV.
- `external_sku` is the only required identity; barcode/GTIN is not modeled.
- Duplicate rows inside a single file are not explicitly reported; later rows overwrite earlier rows through upsert.
- Price parsing accepts any finite number including negative values in import flow.
- Empty/malformed price becomes `null` without row error.
- Import row inserts are likely blocked by missing RLS policies.
- Import action lacks explicit admin/manager role check.

## 11. Photo upload/compression findings

### Covered edge cases

- No files: handled client-side and server-side.
- Unsupported file: handled client-side and server-side by MIME type.
- HEIC/HEIF: explicitly rejected client-side with a specific message.
- Large iPhone photo: JPEG/PNG/WebP above 5 MB are resized/compressed client-side before upload.
- Multiple files: UI and action accept multiple files.
- Duplicate photo hash: DB unique constraint rejects duplicates in the same session.

### Remaining risks

- Server Action aggregate request size may reject valid multi-file batches before action logic runs.
- Browser canvas decode/compression can fail for some large images or metadata; the fallback is a generic client error.
- HEIC/HEIF are not converted, which may be a major field-ops issue.
- Partial multi-file failures leave earlier successful uploads in place.
- Duplicate hash messages are not user-friendly.
- Server does not store width/height after client compression.
- Storage path includes company/session IDs; private bucket policies protect access but UI exposes full path.

## 12. Readiness for AI/OCR

Status: **Not ready to implement yet.**

Required before starting AI/OCR:

1. Add scoped RLS policies for `catalog_import_rows`.
2. Align catalog/store/competitor permissions between app actions and RLS.
3. Define session/photo/job lifecycle and state transitions.
4. Add/confirm queue architecture for photo recognition jobs.
5. Add OCR result storage for raw provider payload, model name/version, prompt/parser version, token/cost metadata, and parse errors.
6. Add review workflow fields/actions for recognized items.
7. Add controlled image viewing via signed URLs or server-mediated access.
8. Tighten catalog permissions and import reliability because matching depends on clean catalog data.
9. Add automated RLS tests for company isolation.

## 13. Readiness for X5/SPAR website price sources

Status: **Not ready to implement yet.**

### Architecture needed

- `price_sources`: source key (`x5_5ka`, `spar_online`), display name, enabled flag, legal/risk status, parser version, rate-limit settings.
- `source_locations` / `source_stores`: Kaliningrad city/store identifiers, source-specific IDs, address, active flag.
- `source_runs`: source, company, location/store, status, started/completed timestamps, trigger type, error summary, parser version.
- `source_run_events`: logs and warnings without storing secrets.
- `source_raw_payloads`: raw API/HTML/JSON payload references, hashes, storage path, retention policy.
- `source_products`: external source product ID, URL, raw title, normalized title, brand, size, barcode if available, image URL if allowed, availability.
- `source_prices`: observed price, promo price, currency, availability, observed_at, run_id, source_product_id.
- `external_product_matches`: mapping between source products and `catalog_products`, with score, decision, reviewer metadata, and active flag.
- Manual disable switch per source and per location/store.
- Rate limiting/backoff per source and robots/terms compliance review.
- No calls from user-facing request/response paths; use background jobs/workers.

### Legal/terms notes

- Do not scrape or call X5/5ka.ru or SPAR Online from this PR.
- Before implementation, review each site's terms, robots.txt, API availability, allowed usage, and regional/city selection mechanics.
- Prefer official/public APIs, partner feeds, or manual import if scraping risk is unacceptable.
- Add a source kill switch and run logging before enabling production runs.

## 14. Recommended next PR sequence

1. **RLS for catalog_import_rows PR**: add scoped insert/read policies for row-level catalog import records.
2. **Role/permission alignment PR**: remove overly broad member insert policies where needed, centralize permission matrix, add app-side role checks.
3. **Login redirect safety PR**: validate the `next` parameter and allow only safe internal app paths.
4. **Company context/catalog scoping PR**: introduce explicit company selector/current company source and update catalog reads/actions to avoid hidden first-membership behavior.
5. **Upload reliability PR**: decide direct Storage upload vs Server Action aggregate limits, improve duplicate/partial failure UX, optionally add HEIC guidance/conversion plan.
6. **Monitoring lifecycle/jobs PR**: add session/photo transitions, enqueue jobs after upload, and define retry/error handling.
7. **AI/OCR schema PR**: add OCR result/raw output/review metadata tables or fields; do not implement provider calls yet.
8. **Website source architecture PR**: add source/source-run/raw-payload/external-product schema and admin source controls.
9. **X5/SPAR research PR**: document terms/API/city-store selection without production scraping.
10. **X5/SPAR implementation PRs**: one source at a time, behind disabled-by-default flags and rate limits.
11. **AI/OCR worker PR**: implement recognition behind worker/job boundary with service-role isolation and signed worker auth.
12. **Review/matching PR**: build review queue, candidate matches, alias learning, and confirmation flow.
13. **Reports/Excel PR**: generate reports after data model supports both photo and website observations.

## 15. Explicit “Do not start yet” list

Do not start these until the earlier blockers are resolved:

- Do not add OpenAI/OCR provider calls.
- Do not add service-role usage to app pages or user-triggered actions.
- Do not scrape or call X5/5ka.ru or SPAR Online.
- Do not create price-source parsing logic before source/run/raw-payload architecture exists.
- Do not build Excel export on the current photo-only `price_history` shape.
- Do not build a full review UI before session/photo/job lifecycle is defined.
- Do not broaden RLS to make blocked flows pass; fix policies narrowly and test company isolation.
- Do not start website source matching until catalog import, barcode/identity strategy, and permission rules are stable.
