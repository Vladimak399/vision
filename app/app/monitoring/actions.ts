"use server";

import { createHash, randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export type MonitoringSessionCreateState = {
  error?: string;
};

type MonitoringSessionLifecycleRow = {
  id: string;
  status: "draft" | "uploading" | "processing" | "review" | "completed" | "failed" | "cancelled";
  started_at: string | null;
};

type QueueablePhotoRow = {
  id: string;
  storage_path: string;
  status: "uploaded" | "failed";
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

const MONITORING_PHOTOS_BUCKET = "monitoring-photos";
const MAX_MONITORING_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MONITORING_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type MonitoringPhotoUploadState = {
  error?: string;
  message?: string;
};

export async function uploadMonitoringPhotos(
  _state: MonitoringPhotoUploadState,
  formData: FormData,
): Promise<MonitoringPhotoUploadState> {
  const user = await getCurrentUser();
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const nextPath = sessionId ? `/app/monitoring/${encodeURIComponent(sessionId)}` : "/app/monitoring";

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
    return { error: "Загружать фото могут только admin или manager." };
  }

  if (!sessionId) {
    return { error: "Не указана сессия мониторинга." };
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, started_at")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<MonitoringSessionLifecycleRow | null>();

  if (sessionError) {
    return { error: `Не удалось проверить сессию мониторинга: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия мониторинга не найдена в текущей компании." };
  }

  if (["completed", "cancelled"].includes(session.status)) {
    return { error: "Нельзя загружать фото в завершённую или отменённую сессию." };
  }

  const files = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return { error: "Выберите хотя бы одно фото." };
  }

  for (const file of files) {
    if (!ALLOWED_MONITORING_PHOTO_TYPES.has(file.type)) {
      return { error: `Файл ${file.name || "без названия"} имеет неподдерживаемый тип. Разрешены JPEG, PNG и WebP.` };
    }

    if (file.size > MAX_MONITORING_PHOTO_SIZE_BYTES) {
      return { error: `Файл ${file.name || "без названия"} больше 10 МБ.` };
    }
  }

  if (session.status === "draft") {
    const { error: lifecycleError } = await supabase
      .from("monitoring_sessions")
      .update({ status: "uploading", started_at: session.started_at ?? new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", sessionId)
      .eq("status", "draft");

    if (lifecycleError) {
      return { error: `Не удалось обновить статус сессии: ${lifecycleError.message}` };
    }
  }

  let uploadedCount = 0;

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = calculateSha256(bytes);
    const fileId = randomUUID();
    const storagePath = `${companyId}/${sessionId}/${fileId}/${sanitizeFilename(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(MONITORING_PHOTOS_BUCKET)
      .upload(storagePath, bytes, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      return { error: `Не удалось загрузить ${file.name || "фото"}: ${uploadError.message}` };
    }

    const { error: insertError } = await supabase.from("monitoring_photos").insert({
      company_id: companyId,
      session_id: sessionId,
      storage_path: storagePath,
      sha256,
      status: "uploaded",
    });

    if (insertError) {
      await supabase.storage.from(MONITORING_PHOTOS_BUCKET).remove([storagePath]);
      return { error: `Фото загружено в хранилище, но не сохранено в сессии: ${insertError.message}` };
    }

    uploadedCount += 1;
  }

  revalidatePath("/app/monitoring");
  revalidatePath(`/app/monitoring/${sessionId}`);
  return { message: `Загружено фото: ${uploadedCount}. Статус сессии обновлён.` };
}

export type QueueRecognitionState = {
  error?: string;
  message?: string;
};

export async function queueRecognitionForSession(
  _state: QueueRecognitionState,
  formData: FormData,
): Promise<QueueRecognitionState> {
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
    return { error: "Запускать распознавание могут только admin или manager." };
  }

  if (!sessionId) {
    return { error: "Не указана сессия мониторинга." };
  }

  const companyId = membershipResult.membership.companyId;
  const now = new Date().toISOString();
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, started_at")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<MonitoringSessionLifecycleRow | null>();

  if (sessionError) {
    return { error: `Не удалось проверить сессию мониторинга: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия мониторинга не найдена в текущей компании." };
  }

  if (["completed", "cancelled"].includes(session.status)) {
    return { error: "Нельзя запускать распознавание для завершённой или отменённой сессии." };
  }

  const { data: photos, error: photosError } = await supabase
    .from("monitoring_photos")
    .select("id, storage_path, status")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("status", ["uploaded", "failed"])
    .returns<QueueablePhotoRow[]>();

  if (photosError) {
    return { error: `Не удалось загрузить фото для очереди: ${photosError.message}` };
  }

  if (!photos || photos.length === 0) {
    return { message: "Нет новых или ошибочных фото для постановки в очередь." };
  }

  const photoIds = photos.map((photo) => photo.id);
  const { error: photoUpdateError } = await supabase
    .from("monitoring_photos")
    .update({ status: "queued", error: null })
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .in("id", photoIds)
    .in("status", ["uploaded", "failed"]);

  if (photoUpdateError) {
    return { error: `Не удалось обновить статусы фото: ${photoUpdateError.message}` };
  }

  const { error: jobsError } = await supabase.from("jobs").insert(
    photos.map((photo) => ({
      company_id: companyId,
      session_id: sessionId,
      kind: "photo_ocr",
      status: "queued",
      payload: {
        photo_id: photo.id,
        storage_path: photo.storage_path,
        company_id: companyId,
        session_id: sessionId,
      },
      correlation_id: `photo_ocr:${sessionId}:${photo.id}:${now}`,
    })),
  );

  if (jobsError) {
    await supabase
      .from("monitoring_photos")
      .update({ status: "uploaded" })
      .eq("company_id", companyId)
      .eq("session_id", sessionId)
      .in("id", photoIds)
      .eq("status", "queued");

    return { error: `Не удалось создать OCR jobs: ${jobsError.message}` };
  }

  const { error: sessionUpdateError } = await supabase
    .from("monitoring_sessions")
    .update({ status: "processing", started_at: session.started_at ?? now })
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .in("status", ["draft", "uploading", "review", "failed"]);

  if (sessionUpdateError) {
    return { error: `Фото поставлены в очередь, но статус сессии не обновился: ${sessionUpdateError.message}` };
  }

  revalidatePath("/app/monitoring");
  revalidatePath(`/app/monitoring/${sessionId}`);
  return { message: `Поставлено в очередь на распознавание: ${photos.length} фото.` };
}

export type ManualRecognizedItemState = {
  error?: string;
  message?: string;
};

const MAX_MANUAL_PRICE_MINOR = 100_000_000;
const MAX_MANUAL_RAW_NAME_LENGTH = 300;
const MAX_MANUAL_OPTIONAL_TEXT_LENGTH = 160;

export async function createManualRecognizedItem(
  _state: ManualRecognizedItemState,
  formData: FormData,
): Promise<ManualRecognizedItemState> {
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
    return { error: "Вручную добавлять товары могут только admin или manager." };
  }

  const companyId = membershipResult.membership.companyId;
  const photoId = String(formData.get("photo_id") ?? "").trim();
  const rawName = String(formData.get("raw_name") ?? "").trim();
  const brand = String(formData.get("brand") ?? "").trim();
  const sizeText = String(formData.get("size_text") ?? "").trim();
  const priceInput = String(formData.get("price_rub") ?? "").trim();

  if (!sessionId) {
    return { error: "Не указана сессия мониторинга." };
  }

  if (!photoId) {
    return { error: "Выберите фото для товара." };
  }

  if (!rawName) {
    return { error: "Введите название товара." };
  }

  if (rawName.length > MAX_MANUAL_RAW_NAME_LENGTH) {
    return { error: "Название товара слишком длинное." };
  }

  if (brand.length > MAX_MANUAL_OPTIONAL_TEXT_LENGTH) {
    return { error: "Бренд слишком длинный." };
  }

  if (sizeText.length > MAX_MANUAL_OPTIONAL_TEXT_LENGTH) {
    return { error: "Размер, вес или объём слишком длинные." };
  }

  const priceMinor = parseRubPriceToMinor(priceInput);

  if (priceMinor === null) {
    return { error: "Введите корректную цену в рублях." };
  }

  if (priceMinor <= 0) {
    return { error: "Цена должна быть положительной." };
  }

  if (priceMinor > MAX_MANUAL_PRICE_MINOR) {
    return { error: "Цена выглядит слишком большой. Проверьте значение." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, started_at")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<MonitoringSessionLifecycleRow | null>();

  if (sessionError) {
    return { error: `Не удалось проверить сессию мониторинга: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия мониторинга не найдена в текущей компании." };
  }

  if (["completed", "cancelled"].includes(session.status)) {
    return { error: "Нельзя добавлять товары в завершённую или отменённую сессию." };
  }

  const { data: photo, error: photoError } = await supabase
    .from("monitoring_photos")
    .select("id")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .eq("id", photoId)
    .maybeSingle();

  if (photoError) {
    return { error: `Не удалось проверить фото: ${photoError.message}` };
  }

  if (!photo) {
    return { error: "Выбранное фото не найдено в этой сессии." };
  }

  const { error: insertError } = await supabase.from("recognized_items").insert({
    company_id: companyId,
    session_id: sessionId,
    photo_id: photoId,
    raw_name: rawName,
    brand: brand || null,
    size_text: sizeText || null,
    price_minor: priceMinor,
    currency: "RUB",
    confidence: 1.0,
    status: "needs_review",
  });

  if (insertError) {
    return { error: `Не удалось добавить товар: ${insertError.message}` };
  }

  if (["draft", "uploading", "processing"].includes(session.status)) {
    await supabase
      .from("monitoring_sessions")
      .update({ status: "review", started_at: session.started_at ?? new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", sessionId)
      .in("status", ["draft", "uploading", "processing"]);
  }

  revalidatePath("/app/monitoring");
  revalidatePath(`/app/monitoring/${sessionId}`);
  return { message: "Товар добавлен. Сессия переведена в статус review." };
}

function parseRubPriceToMinor(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");

  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const [rubles, kopecks = ""] = normalized.split(".");
  const minor = Number(rubles) * 100 + Number(kopecks.padEnd(2, "0"));

  if (!Number.isSafeInteger(minor)) {
    return null;
  }

  return minor;
}

function calculateSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sanitizeFilename(filename: string) {
  const fallback = "photo";
  const trimmed = filename.trim();
  const safeName = (trimmed || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return safeName || fallback;
}
