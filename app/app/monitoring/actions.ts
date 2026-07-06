"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export type MonitoringSessionCreateState = {
  error?: string;
};

export async function createMonitoringSession(
  _state: MonitoringSessionCreateState,
  formData: FormData,
): Promise<MonitoringSessionCreateState> {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/monitoring/new");
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

  if (!["admin", "manager"].includes(membershipResult.membership.role)) {
    return { error: "Создавать сессии мониторинга могут только admin или manager." };
  }

  const storeId = String(formData.get("store_id") ?? "").trim();

  if (!storeId) {
    return { error: "Выберите магазин для мониторинга." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id")
    .eq("company_id", membershipResult.membership.companyId)
    .eq("id", storeId)
    .maybeSingle();

  if (storeError) {
    return { error: `Не удалось проверить магазин: ${storeError.message}` };
  }

  if (!store) {
    return { error: "Выбранный магазин не найден в текущей компании." };
  }

  const { error } = await supabase.from("monitoring_sessions").insert({
    company_id: membershipResult.membership.companyId,
    store_id: storeId,
    status: "draft",
    created_by: user.id,
  });

  if (error) {
    return { error: `Не удалось создать сессию мониторинга: ${error.message}` };
  }

  revalidatePath("/app/monitoring");
  redirect("/app/monitoring");
}
