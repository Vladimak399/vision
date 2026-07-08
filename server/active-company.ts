import type { CompanyMembership } from "./memberships";

/**
 * Cookie name storing the user's chosen active company id.
 *
 * The value is always validated against the user's actual memberships
 * (scoped by RLS) before use, so a stale/foreign value is ignored, not trusted.
 */
export const ACTIVE_COMPANY_COOKIE = "pv-active-company";

/**
 * Pick the active company membership from a cookie value, validated against
 * the memberships the user actually holds.
 *
 * Pure function: no Supabase, no cookies() read — pass memberships in.
 * Returns `null` when the cookie is absent, empty, or points to a company the
 * user is not a member of (so callers fall back to the first membership).
 */
export function resolveActiveCompanyMembership(
  activeCompanyId: string | null | undefined,
  memberships: CompanyMembership[],
): CompanyMembership | null {
  if (!activeCompanyId || memberships.length === 0) {
    return null;
  }

  return (
    memberships.find((membership) => membership.companyId === activeCompanyId) ??
    null
  );
}
