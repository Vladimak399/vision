# Batch OCR rollout checklist

Branch: `queue-claim-fix`

## Before opening PR

- Keep the PR as draft until the Vercel deployment limit is reset.
- Do not merge while Vercel checks are red because of `api-deployments-free-per-day`.
- Confirm the branch is based on the current `main` and is not behind.
- Review changed files before merge.

## Expected PR scope

This PR should only cover the mass photo/OCR infrastructure:

- department-aware photo upload;
- safer OCR job queueing;
- duplicate job protection;
- processing batches of up to 10 photos;
- department progress page;
- stale OCR job recovery;
- review filtering by department.

Do not add catalog matching or Excel export to this PR.

## Vercel checks

Before merge:

- Vercel preview build is green.
- No TypeScript build errors.
- No server action return-type errors.
- No missing route/page imports.
- No failed Next.js app route type checks.

## Supabase migrations after merge

Apply these migrations after the PR is merged into `main`:

1. `supabase/migrations/20260706201000_monitoring_departments.sql`
   - adds `department` to `monitoring_photos` and `recognized_items`;
   - adds department check constraints;
   - adds department indexes.

2. `supabase/migrations/20260706202000_unique_ocr_jobs.sql`
   - adds unique index on `jobs(company_id, correlation_id)`.

3. `supabase/migrations/20260706203000_recognized_items_department_from_photo.sql`
   - adds trigger to inherit `recognized_items.department` from `monitoring_photos.department`;
   - backfills existing rows where possible.

4. `supabase/migrations/20260706204000_jobs_updated_at_trigger.sql`
   - adds trigger to keep `jobs.updated_at` current on update.

## Verify database after migrations

Run checks for:

- `monitoring_photos.department` exists;
- `recognized_items.department` exists;
- check constraints allow only `products`, `chemistry`, or null;
- unique index `jobs_company_correlation_id_key` exists;
- trigger `set_recognized_item_department_from_photo` exists;
- trigger `set_jobs_updated_at` exists.

## First production smoke test

Use a small test session first, not a full 100-photo store.

1. Create a monitoring session.
2. Upload 2 product photos with department `products`.
3. Upload 2 chemistry photos with department `chemistry`.
4. Open the session page.
5. Queue photos for recognition.
6. If `OPENAI_API_KEY` is missing, confirm that queue/photo statuses are not changed.
7. If `OPENAI_API_KEY` is configured, process one batch.
8. Open `/departments`.
9. Confirm photo counts are split by department.
10. Open `/review`.
11. Confirm filters work:
    - all;
    - products;
    - chemistry;
    - none.
12. Confirm recognized items inherit department from their photo.

## Recovery test

Only test this if there is a stale `running` OCR job.

Expected behavior:

- stale `running` job older than 20 minutes becomes `failed`;
- related `processing` photo becomes `failed`;
- failed photo can be queued again;
- `/departments` updates after recovery.

## Manual rollback notes

If this PR causes issues before real OCR processing:

- do not delete uploaded photos;
- stop processing new batches;
- keep sessions in review/processing for diagnosis;
- inspect `jobs`, `monitoring_photos`, and `recognized_items` by `session_id`;
- avoid mass-deleting `recognized_items` unless the session is explicitly test-only.
