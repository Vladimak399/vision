import { cookies } from "next/headers";

import { ACTIVE_COMPANY_COOKIE, resolveActiveCompanyMembership } from "./active-company";
import {
  type CompanyMembership,
  getCurrentUserCompanyMemberships,
} from "./memberships";

export type PrimaryCompanyMembershipResult =
  | { status: "ok"; membership: CompanyMembership }
  | { status: "no_access"; membership: null };

export async function getPrimaryCompanyMembership(): Promise<PrimaryCompanyMembershipResult> {
  const memberships = await getCurrentUserCompanyMemberships();

  // Honor the user's chosen active company if the cookie points to a company
  // they are actually a member of; otherwise fall back to the first membership.
  // Cookie value is never trusted without validation against RLS-scoped memberships.
  const cookieStore = await cookies();
  const activeCompanyMembership = resolveActiveCompanyMembership(
    cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value,
    memberships,
  );
  const primaryMembership = activeCompanyMembership ?? memberships[0];

  if (!primaryMembership) {
    return { status: "no_access", membership: null };
  }

  return { status: "ok", membership: primaryMembership };
}
