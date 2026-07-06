"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

type QueueJobPayload = {
  photo_id?: string;
  session_id?: string;
  company_id?: string;
};

type QueueJobRow = {
  id: string;
  attempts: number;
  max_attempts: number;
  payload: QueueJobPayload;
};

export type ProcessQueueState = {
  error?: string;
  message?: string;
};

const DRY_RUN_BATCH_SIZE = 5;

export async function processQueuedRecognitionJobs(
  _state: ProcessQueueState,
  formData: FormData,
): Promise<ProcessQueueState> {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}` : "/app/monitoring";
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
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
    return { error: "Прогонять очередь могут только admin или manager." };
  }

  if (!sessionId) {
    return { error: "Не указана сессия мониторинга." };
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return { error: `Не удалось проверить сессию: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия не найдена в текущей компании." };
  }

  if (["completed", "cancelled"].includes(String(session.status))) {
    return { error: "Нельзя обрабатывать завершённую или отменённую сессию." };
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, attempts, max_attempts, payload")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("kind", "photo_ocr")
    .eq("status", "queued")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(DRY_RUN_BATCH_SIZE)
    .returns<QueueJobRow[]>();

  if (jobsError) {
    return { error: `Не удалось получить jobs: ${jobsError.message}` };
  }

  if (!jobs || jobs.length === 0) {
    return { message: "В очереди нет задач для обработки." };
  }

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const payload = job.payload;
    const photoId = payload.photo_id;

    if (!photoId || payload.company_id !== companyId || payload.session_id !== sessionId) {
      await supabase
        .from("jobs")
        .update({ status: "failed", error: "Invalid job payload." })
        .eq("company_id", companyId)
        .eq("id", job.id);
      failed += 1;
      continue;
    }

    const { error: claimError } = await supabase
      .from("jobs")
      .update({ status: "running", attempts: job.attempts + 1, error: null })
      .eq("company_id", companyId)
      .eq("id", job.id)
      .eq("status", "queued");

    if (claimError) {
      failed += 1;
      continue;
    }

    const { error: photoProcessingError } = await supabase
      .from("monitoring_photos")
      .update({ status: "processing", error: null })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", photoId)
      .eq("status", "queued");

    if (photoProcessingError) {
      await markJobFailed(supabase, companyId, job.id, photoProcessingError.message);
      failed += 1;
      continue;
    }

    const { error: photoProcessedError } = await supabase
      .from("monitoring_photos")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", photoId)
      .eq("status", "processing");

    if (photoProcessedError) {
      await markJobFailed(supabase, companyId, job.id, photoProcessedError.message);
      await supabase
        .from("monitoring_photos")
        .update({ status: "failed", error: photoProcessedError.message })
        .eq("company_id", companyId)
        .eq("session_id", sessionId)
        .eq("id", photoId);
      failed += 1;
      continue;
    }

    const { error: jobDoneError } = await supabase
      .from("jobs")
      .update({ status: "succeeded", error: null })
      .eq("company_id", companyId)
      .eq("id", job.id);

    if (jobDoneError) {
      failed += 1;
      continue;
    }

    processed += 1;
  }

  const { count: activePhotoCount } = await supabase
    .from("monitoring_photos")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["queued", "processing"]);

  if ((activePhotoCount ?? 0) === 0) {
    await supabase
      .from("monitoring_sessions")
      .update({ status: "review" })
      .eq("company_id", companyId)
      .eq("id", sessionId)
      .eq("status", "processing");
  }

  revalidatePath("/app/monitoring");
  revalidatePath(`/app/monitoring/${sessionId}`);
  return { message: `Dry-run обработка: успешно ${processed}, ошибок ${failed}.` };
}

async function markJobFailed(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  jobId: string,
  error: string,
) {
  await supabase
    .from("jobs")
    .update({ status: "failed", error })
    .eq("company_id", companyId)
    .eq("id", jobId);
}
