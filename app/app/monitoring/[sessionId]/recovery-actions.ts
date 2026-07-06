"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

type RunningJobRow = {
  id: string;
  payload: {
    photo_id?: string;
  } | null;
};

type RecoveryState = {
  error?: string;
  message?: string;
};

const STALE_RUNNING_MINUTES = 20;
const RECOVERY_ROLES = new Set(["admin", "manager"]);

export async function recoverStaleOcrWork(_state: RecoveryState, formData: FormData): Promise<RecoveryState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}/departments` : "/app/monitoring";
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (!sessionId) {
    return { error: "Не указана сессия мониторинга." };
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

  if (!RECOVERY_ROLES.has(membershipResult.membership.role)) {
    return { error: "Нет прав на восстановление очереди." };
  }

  const companyId = membershipResult.membership.companyId;
  const cutoff = new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000).toISOString();
  const supabase = await createSupabaseServerClient();

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, payload")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("kind", "photo_ocr")
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .returns<RunningJobRow[]>();

  if (jobsError) {
    return { error: `Не удалось найти зависшие задачи: ${jobsError.message}` };
  }

  if (!jobs || jobs.length === 0) {
    return { message: "Зависших задач не найдено." };
  }

  const jobIds = jobs.map((job) => job.id);
  const photoIds = jobs
    .map((job) => job.payload?.photo_id)
    .filter((photoId): photoId is string => Boolean(photoId));

  const { error: jobUpdateError } = await supabase
    .from("jobs")
    .update({ status: "failed", error: "OCR job timeout. Retry from failed photos." })
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("id", jobIds)
    .eq("status", "running");

  if (jobUpdateError) {
    return { error: `Не удалось обновить задачи: ${jobUpdateError.message}` };
  }

  if (photoIds.length > 0) {
    const { error: photoUpdateError } = await supabase
      .from("monitoring_photos")
      .update({ status: "failed", error: "OCR job timeout. Can be queued again." })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .in("id", photoIds)
      .eq("status", "processing");

    if (photoUpdateError) {
      return { error: `Задачи обновлены, но фото не обновились: ${photoUpdateError.message}` };
    }
  }

  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/departments`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);

  return { message: `Восстановлено зависших задач: ${jobs.length}. Их фото можно снова поставить в очередь.` };
}
