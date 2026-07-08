"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_COMPANY_COOKIE, resolveActiveCompanyMembership } from "../../server/active-company";
import { getCurrentUserCompanyMemberships } from "../../server/memberships";
import { createSupabaseServerClient } from "../../lib/supabase/server";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function logout() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Switch the active company for the current user.
 *
 * Reads `companyId` from the submitted form data and validates it against the
 * user's actual memberships (RLS-scoped) before writing the cookie. A companyId
 * the user does not belong to is rejected — the cookie is never set to an
 * unverified value. Role cannot be escalated: the role is always read from
 * memberships, never from the cookie.
 */
export async function setActiveCompany(formData: FormData) {
  const companyId = formData.get("companyId");
  if (typeof companyId !== "string" || companyId.length === 0) {
    redirect("/app?companyError=missing");
  }

  const memberships = await getCurrentUserCompanyMemberships();
  const target = resolveActiveCompanyMembership(companyId, memberships);

  if (!target) {
    redirect("/app?companyError=invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, target.companyId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  redirect("/app");
}
