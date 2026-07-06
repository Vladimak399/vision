import type { CompanyMembership } from "./memberships";

export type CompanyRole = CompanyMembership["role"];

export const STORE_WRITE_ROLES = ["admin", "manager"] as const satisfies readonly CompanyRole[];
export const CATALOG_WRITE_ROLES = ["admin", "manager"] as const satisfies readonly CompanyRole[];
export const COMPETITOR_WRITE_ROLES = ["admin"] as const satisfies readonly CompanyRole[];

export function hasCompanyRole(
  membership: CompanyMembership,
  allowedRoles: readonly CompanyRole[],
): boolean {
  return allowedRoles.includes(membership.role);
}

export function roleList(allowedRoles: readonly CompanyRole[]): string {
  return allowedRoles.join(" или ");
}
