"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { hasCompanyRole, roleList, STORE_WRITE_ROLES } from "../../../server/company-access";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export type StoreCreateState = {
  error?: string;
};

export async function createStore(_state: StoreCreateState, formData: FormData): Promise<StoreCreateState> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/stores");
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

  if (!hasCompanyRole(membershipResult.membership, STORE_WRITE_ROLES)) {
    return { error: `Недостаточно прав. Создавать магазины могут только ${roleList(STORE_WRITE_ROLES)}.` };
  }

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  if (!name) {
    return { error: "Укажите название магазина." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("stores").insert({
    company_id: membershipResult.membership.companyId,
    name,
    address: address || null,
  });

  if (error) {
    return { error: `Не удалось создать магазин: ${error.message}` };
  }

  revalidatePath("/app/stores");
  redirect("/app/stores");
}
