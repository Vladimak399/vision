"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { COMPETITOR_WRITE_ROLES, hasCompanyRole, roleList } from "../../../server/company-access";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export type CompetitorCreateState = {
  error?: string;
};

export async function createCompetitor(
  _state: CompetitorCreateState,
  formData: FormData,
): Promise<CompetitorCreateState> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/competitors");
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Не удалось проверить доступ к компании." };
  }

  if (membershipResult.status !== "ok") {
    return { error: "Нет доступа к компании." };
  }

  if (!hasCompanyRole(membershipResult.membership, COMPETITOR_WRITE_ROLES)) {
    return { error: `Недостаточно прав. Создавать конкурентов могут только ${roleList(COMPETITOR_WRITE_ROLES)}.` };
  }

  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return { error: "Укажите название конкурента." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("competitors").insert({
    company_id: membershipResult.membership.companyId,
    name,
  });

  if (error) {
    return { error: `Не удалось создать конкурента: ${error.message}` };
  }

  revalidatePath("/app/competitors");
  redirect("/app/competitors");
}
