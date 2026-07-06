"use server";

import { Buffer } from "node:buffer";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getServerEnv } from "../../../lib/env";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { recognizeShelfPhotoWithOpenAI } from "../../../server/shelf-recognition/openai";
import type { ShelfRecognitionItem } from "../../../server/shelf-recognition/types";

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

type MonitoringPhotoRow = {
  id: string;
  storage_path: string;
  status: string;
};

export type ProcessQueueState = {
  error?: string;
  message?: string;
};

const OCR_BATCH_SIZE = 10;
const MONITORING_PHOTOS_BUCKET = "monitoring-photos";

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

  const env = getServerEnv();
  if (!env.OPENAI_API_KEY) {
    return { error: "Ключ распознавания не настроен. Очередь и фото не изменены." };
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
    .limit(OCR_BATCH_SIZE)
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
    const result = await processOneRecognitionJob({ companyId, sessionId, job, supabase });

    if (result.ok) {
      processed += 1;
    } else {
      failed += 1;
    }
  }

  await moveSessionToReviewIfReady(supabase, companyId, sessionId);

  revalidatePath("/app/monitoring");
  revalidatePath(`/app/monitoring/${sessionId}`);
  revalidatePath(`/app/monitoring/${sessionId}/review`);
  return { message: `Обработана пачка: успешно ${processed}, ошибок ${failed}.` };
}

async function processOneRecognitionJob({
  companyId,
  sessionId,
  job,
  supabase,
}: {
  companyId: string;
  sessionId: string;
  job: QueueJobRow;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
}) {
  const photoId = job.payload.photo_id;

  if (!photoId || job.payload.company_id !== companyId || job.payload.session_id !== sessionId) {
    await markJobFailed(supabase, companyId, job.id, "Invalid job payload.");
    return { ok: false };
  }

  const { data: photo, error: photoError } = await supabase
    .from("monitoring_photos")
    .select("id, storage_path, status")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("id", photoId)
    .maybeSingle()
    .returns<MonitoringPhotoRow | null>();

  if (photoError || !photo) {
    const message = photoError?.message ?? "Photo not found for recognition job.";
    await markJobFailed(supabase, companyId, job.id, message);
    return { ok: false };
  }

  if (photo.status !== "queued") {
    const message = `Photo is not queued. Current status: ${photo.status}.`;
    await markJobFailed(supabase, companyId, job.id, message);
    return { ok: false };
  }

  const { error: claimError } = await supabase
    .from("jobs")
    .update({ status: "running", attempts: job.attempts + 1, error: null })
    .eq("company_id", companyId)
    .eq("id", job.id)
    .eq("status", "queued");

  if (claimError) {
    return { ok: false };
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
    return { ok: false };
  }

  try {
    const image = await loadPhotoAsBase64(supabase, photo.storage_path);
    const recognition = await recognizeShelfPhotoWithOpenAI(image);
    const rows = buildRecognizedItemRows({ companyId, sessionId, photoId, items: recognition.items });

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from("recognized_items").insert(rows);

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    const { error: photoProcessedError } = await supabase
      .from("monitoring_photos")
      .update({ status: "processed", processed_at: new Date().toISOString(), error: null })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", photoId)
      .eq("status", "processing");

    if (photoProcessedError) {
      throw new Error(photoProcessedError.message);
    }

    const { error: jobDoneError } = await supabase
      .from("jobs")
      .update({
        status: "succeeded",
        error: null,
        model: recognition.usage.model,
        input_tokens: recognition.usage.input_tokens,
        output_tokens: recognition.usage.output_tokens,
        estimated_cost_microusd: recognition.usage.estimated_cost_microusd,
        duration_ms: recognition.usage.duration_ms,
      })
      .eq("company_id", companyId)
      .eq("id", job.id);

    if (jobDoneError) {
      throw new Error(jobDoneError.message);
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recognition failed.";
    await markJobFailed(supabase, companyId, job.id, message);
    await supabase
      .from("monitoring_photos")
      .update({ status: "failed", error: message })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .eq("id", photoId);
    return { ok: false };
  }
}

async function loadPhotoAsBase64(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  storagePath: string,
) {
  const { data, error } = await supabase.storage.from(MONITORING_PHOTOS_BUCKET).download(storagePath);

  if (error || !data) {
    throw new Error(error?.message ?? "Photo download failed.");
  }

  const arrayBuffer = await data.arrayBuffer();
  const mimeType = data.type || inferMimeType(storagePath);

  return {
    imageBase64: Buffer.from(arrayBuffer).toString("base64"),
    mimeType,
  };
}

function buildRecognizedItemRows({
  companyId,
  sessionId,
  photoId,
  items,
}: {
  companyId: string;
  sessionId: string;
  photoId: string;
  items: ShelfRecognitionItem[];
}) {
  return items.flatMap((item) => {
    const rawName = firstNonEmpty([item.raw_name, item.price_tag_text, item.product_visible_text]);

    if (!rawName) {
      return [];
    }

    return [
      {
        company_id: companyId,
        session_id: sessionId,
        photo_id: photoId,
        raw_name: rawName,
        brand: item.brand,
        size_text: item.size_text,
        price_minor: item.price_minor,
        old_price_minor: item.old_price_minor,
        promo_price_minor: item.promo_price_minor,
        currency: "RUB",
        confidence: clampConfidence(Math.min(item.confidence, item.link_confidence)),
        link_confidence: clampConfidence(item.link_confidence),
        price_tag_text: item.price_tag_text,
        product_visible_text: item.product_visible_text,
        review_reason: item.review_reason,
        position_hint: item.position_hint,
        status: "needs_review",
      },
    ];
  });
}

function firstNonEmpty(values: Array<string | null>) {
  for (const value of values) {
    const normalized = value?.trim();

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function inferMimeType(path: string) {
  const lowerPath = path.toLowerCase();

  if (lowerPath.endsWith(".png")) {
    return "image/png";
  }

  if (lowerPath.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/jpeg";
}

async function moveSessionToReviewIfReady(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  sessionId: string,
) {
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
