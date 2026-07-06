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
    .select("id")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return { error: `Не удалось проверить сессию мониторинга: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия мониторинга не найдена в текущей компании." };
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

  revalidatePath(`/app/monitoring/${sessionId}`);
  return { message: `Загружено фото: ${uploadedCount}.` };
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
    .select("id")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionError) {
    return { error: `Не удалось проверить сессию мониторинга: ${sessionError.message}` };
  }

  if (!session) {
    return { error: "Сессия мониторинга не найдена в текущей компании." };
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

  revalidatePath(`/app/monitoring/${sessionId}`);
  return { message: "Товар добавлен." };
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
