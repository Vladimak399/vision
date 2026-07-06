import {
  type CompanyMembership,
  getCurrentUserCompanyMemberships,
} from "./memberships";

export type PrimaryCompanyMembershipResult =
  | { status: "ok"; membership: CompanyMembership }
  | { status: "no_access"; membership: null };

export async function getPrimaryCompanyMembership(): Promise<PrimaryCompanyMembershipResult> {
  const memberships = await getCurrentUserCompanyMemberships();
  const primaryMembership = memberships[0];

  if (!primaryMembership) {
    return { status: "no_access", membership: null };
  }

  return { status: "ok", membership: primaryMembership };
}
