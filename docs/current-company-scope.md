# Current company scope

PriceVision currently supports company-scoped data through `company_id` and Supabase RLS, but the UI does not yet have a company switcher.

## Current behavior

When an authenticated user belongs to one company, all app pages and actions operate under that company.

When an authenticated user belongs to multiple companies, the app uses the first company membership returned by `getCurrentUserCompanyMemberships()`. This is a temporary MVP behavior.

The workspace page explicitly shows the current company and warns if the user has access to multiple companies.

## Why this matters

Future work must not assume that the first company membership is always the intended company. This is especially important for:

- catalog imports
- monitoring sessions
- photo uploads
- AI/OCR matching
- X5/SPAR website source runs
- report generation

## Required future fix

Add an explicit current-company selector before multi-company usage becomes common.

Recommended approach:

1. Add a company switcher in the workspace shell.
2. Store selected company in a safe server-readable place, for example a cookie.
3. Validate the selected company against `company_members` on every server action/page load.
4. Pass the selected `companyId` explicitly into loaders/actions.
5. Keep RLS as the final safety boundary.

## Do not do

- Do not use service role in user-facing flows to bypass RLS.
- Do not rely on client-provided company IDs without server-side membership validation.
- Do not start AI/OCR or external website source jobs for users with ambiguous company context.
