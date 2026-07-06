"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

const MAX_MVP_JOBS_PER_RUN = 3;

type RunQueueState = {
  error?: string;
  message?: string;
};

type SessionRow = {
  id: string;
  status: "draft" | "uploading" | "processing" | "review" | "completed" | "failed" | "cancelled";
};

type JobRow = {
  id: string;
  payload: {
    photo_id?: unknown;
  } | null;
  attempts: number;
  max_attempts: number;
};

export async function runQueuedRecognitionForSession(
  _state: RunQueueState,
  formData: FormData,
): Promise<RunQueueState> {
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
    return { error: "Обрабатывать очередь могут только admin или manager." };
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
    .maybeSingle()
    .returns<SessionRow | null>();

  if (sessionError) {
    return { error: `Не удалось проверить сессию: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия не найдена в текущей компании." };
  }

  if (["completed", "cancelled"].includes(session.status)) {
    return { error: "Нельзя обрабатывать завершённую или отменённую сессию." };
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id, payload, attempts, max_attempts")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("kind", "photo_ocr")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_MVP_JOBS_PER_RUN)
    .returns<JobRow[]>();

  if (jobsError) {
    return { error: `Не удалось загрузить jobs: ${jobsError.message}` };
  }

  if (!jobs || jobs.length === 0) {
    await refreshSessionAfterMvpRun(supabase, companyId, sessionId);
    revalidatePath("/app/monitoring");
    revalidatePath(`/app/monitoring/${sessionId}`);
    return { message: "В очереди нет jobs для обработки." };
  }

  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    const photoId = typeof job.payload?.photo_id === "string" ? job.payload.photo_id : null;

    const { error: runningError } = await supabase
      .from("jobs")
      .update({ status: "running", attempts: job.attempts + 1, error: null })
      .eq("company_id", companyId)
      .eq("id", job.id)
      .eq("status", "queued");

    if (runningError) {
      failed += 1;
      continue;
    }

    if (!photoId) {
      await supabase
        .from("jobs")
        .update({ status: "failed", error: "Missing photo_id in job payload." })
        .eq("company_id", companyId)
        .eq("id", job.id);
      failed += 1;
      continue;
    }

    await supabase
      .from("monitoring_photos")
      .update({ status: "processing", error: null })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", photoId)
      .eq("status", "queued");

    const { error: photoDoneError } = await supabase
      .from("monitoring_photos")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", photoId)
      .in("status", ["queued", "processing"]);

    if (photoDoneError) {
      await supabase
        .from("jobs")
        .update({ status: job.attempts + 1 >= job.max_attempts ? "failed" : "queued", error: photoDoneError.message })
        .eq("company_id", companyId)
        .eq("id", job.id);
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

  await refreshSessionAfterMvpRun(supabase, companyId, sessionId);
  revalidatePath("/app/monitoring");
  revalidatePath(`/app/monitoring/${sessionId}`);

  return { message: `MVP runner: обработано ${processed}, ошибок ${failed}.` };
}

async function refreshSessionAfterMvpRun(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  sessionId: string,
) {
  const { data: unfinishedPhotos } = await supabase
    .from("monitoring_photos")
    .select("id")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["uploaded", "queued", "processing"])
    .limit(1);

  if (unfinishedPhotos && unfinishedPhotos.length > 0) {
    await supabase
      .from("monitoring_sessions")
      .update({ status: "processing" })
      .eq("company_id", companyId)
      .eq("id", sessionId)
      .in("status", ["uploading", "processing", "review", "failed"]);
    return;
  }

  await supabase
    .from("monitoring_sessions")
    .update({ status: "review" })
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .in("status", ["uploading", "processing", "failed"]);
}
