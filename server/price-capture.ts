"use server";

import { randomUUID } from "crypto";

import { createSupabaseServiceRoleClient } from "../lib/supabase/service-role";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { getPrimaryCompanyMembership } from "./primary-membership";
import { recognizeShelfPhoto } from "./shelf-recognition";
import { getCatalogMatchCandidates, type CatalogMatchProduct } from "./catalog-matching";
import { batchMatchCatalogItems, type BatchMatchInput } from "./text-ai/catalog-match-batch";

/**
 * Server action: загрузка фото конкурента → распознавание → запись в competitor_shelf_items.
 * Это Этап 1: распознаём товары на полке и сохраняем их. Этап 2 — отдельный action (matchShelfItemsAction).
 * Жена пользователя фотографирует полки, этот action сохраняет распознанные товары.
 */

const PHOTOS_BUCKET = "monitoring-photos";
const ALLOWED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10 МБ

export type PriceCaptureResult = {
  ok: boolean;
  week: 1 | 2;
  storeId: string | null;
  storeName: string | null;
  recognized: number;
  saved: number;
  errors: string[];
};

const initialResult: PriceCaptureResult = {
  ok: false,
  week: 1,
  storeId: null,
  storeName: null,
  recognized: 0,
  saved: 0,
  errors: [],
};

export async function captureCompetitorPricesAction(
  _previousState: PriceCaptureResult,
  formData: FormData,
): Promise<PriceCaptureResult> {
  const weekRaw = formData.get("week");
  const storeId = String(formData.get("storeId") ?? "").trim();
  const week = weekRaw === "2" ? 2 : 1;
  const files = formData.getAll("photos").filter(
    (f): f is File => f instanceof File && f.size > 0,
  );

  if (!storeId) {
    return { ...initialResult, week, errors: ["Выберите магазин конкурента"] };
  }
  if (files.length === 0) {
    return { ...initialResult, week, storeId, errors: ["Выберите хотя бы одно фото"] };
  }
  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return { ...initialResult, week, storeId, errors: [`Файл ${file.name}: неподдерживаемый тип. Разрешены JPEG, PNG, WebP.`] };
    }
    if (file.size > MAX_PHOTO_SIZE) {
      return { ...initialResult, week, storeId, errors: [`Файл ${file.name} больше 10 МБ.`] };
    }
  }

  // Доступ.
  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return { ...initialResult, week, storeId, errors: ["Нет доступа к компании"] };
  }
  const companyId = membershipResult.membership.companyId;

  // Проверяем, что store — конкурент этой компании (не наша ТТ).
  const supabase = await createSupabaseServerClient();
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name, is_own")
    .eq("company_id", companyId)
    .eq("id", storeId)
    .maybeSingle();

  if (storeError || !store) {
    return { ...initialResult, week, storeId, errors: ["Магазин не найден"] };
  }
  if (store.is_own) {
    return { ...initialResult, week, storeId, errors: ["Выберите магазин конкурента, а не вашу точку"] };
  }

  const serviceClient = createSupabaseServiceRoleClient();
  const capturedDate = new Date().toISOString().slice(0, 10);

  let totalRecognized = 0;
  let saved = 0;
  const errors: string[] = [];

  // Обрабатываем каждое фото.
  for (const file of files) {
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const photoId = randomUUID();
      const storagePath = `${companyId}/${storeId}/${photoId}/${file.name.replace(/[^\w.\-]+/g, "_")}`;

      // 1. Грузим фото в storage.
      const { error: uploadError } = await serviceClient.storage
        .from(PHOTOS_BUCKET)
        .upload(storagePath, bytes, { contentType: file.type, upsert: false });

      if (uploadError) {
        errors.push(`Не удалось загрузить ${file.name}: ${uploadError.message}`);
        continue;
      }

      // 2. Распознаём (1 запрос к vision API).
      const base64 = bytes.toString("base64");
      const recognition = await recognizeShelfPhoto({ imageBase64: base64, mimeType: file.type });

      if (!recognition.items || recognition.items.length === 0) {
        const reason = recognition.normalizeError || "товары не найдены";
        errors.push(`Фото ${file.name}: ${reason}`);
        continue;
      }
      totalRecognized += recognition.items.length;

      // 3. Записываем распознанные товары в competitor_shelf_items.
      const rowsToInsert = recognition.items.map((item) => ({
        company_id: companyId,
        week,
        store_id: storeId,
        raw_name: item.raw_name,
        brand: item.brand,
        size_text: item.size_text,
        price_minor: item.price_minor,
        old_price_minor: item.old_price_minor,
        promo_price_minor: item.promo_price_minor,
        currency: item.currency,
        price_tag_text: item.price_tag_text,
        product_visible_text: item.product_visible_text,
        confidence: item.confidence,
        photo_storage_path: storagePath,
        captured_date: capturedDate,
        photo_filename: file.name,
      }));

      const { error: insertError } = await serviceClient.from("competitor_shelf_items").insert(rowsToInsert);
      if (insertError) {
        errors.push(`Ошибка записи для ${file.name}: ${insertError.message}`);
      } else {
        saved += rowsToInsert.length;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "неизвестная ошибка";
      errors.push(`Ошибка обработки ${file.name}: ${msg}`);
    }
  }

  return {
    ok: errors.length === 0,
    week,
    storeId,
    storeName: store.name,
    recognized: totalRecognized,
    saved,
    errors,
  };
}

export type MatchShelfItemsResult = {
  ok: boolean;
  week: 1 | 2;
  storeId: string;
  storeName: string;
  matched: number;
  unmatched: number;
  total: number;
  errors: string[];
};

const initialMatchResult: MatchShelfItemsResult = {
  ok: false,
  week: 1,
  storeId: "",
  storeName: "",
  matched: 0,
  unmatched: 0,
  total: 0,
  errors: [],
};

/**
 * Server action: сопоставление товаров из competitor_shelf_items с каталогом.
 * Это Этап 2: берём несопоставленные товары и делаем batch-matching.
 */
export async function matchShelfItemsAction(
  _previousState: MatchShelfItemsResult,
  formData: FormData,
): Promise<MatchShelfItemsResult> {
  const weekRaw = formData.get("week");
  const storeId = String(formData.get("storeId") ?? "").trim();
  const week = weekRaw === "2" ? 2 : 1;

  if (!storeId) {
    return { ...initialMatchResult, week, errors: ["Выберите магазин"] };
  }

  // Доступ.
  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return { ...initialMatchResult, week, storeId, errors: ["Нет доступа к компании"] };
  }
  const companyId = membershipResult.membership.companyId;

  const supabase = await createSupabaseServerClient();

  // Получаем имя магазина.
  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("id", storeId)
    .maybeSingle();

  if (storeError || !store) {
    return { ...initialMatchResult, week, storeId, errors: ["Магазин не найден"] };
  }

  // Загружаем несопоставленные товары из competitor_shelf_items.
  const { data: shelfItems, error: itemsError } = await supabase
    .from("competitor_shelf_items")
    .select("id, raw_name, brand, size_text, price_tag_text, product_visible_text, confidence")
    .eq("company_id", companyId)
    .eq("week", week)
    .eq("store_id", storeId)
    .is("catalog_product_id", null)
    .order("captured_date", { ascending: false });

  if (itemsError) {
    return { ...initialMatchResult, week, storeId, errors: [`Ошибка загрузки товаров: ${itemsError.message}`] };
  }

  const items = shelfItems ?? [];
  const total = items.length;

  if (total === 0) {
    return {
      ...initialMatchResult,
      week,
      storeId,
      storeName: store.name,
      ok: true,
      matched: 0,
      unmatched: 0,
      total: 0,
      errors: ["Нет несопоставленных товаров для этого магазина и недели"],
    };
  }

  // Загружаем весь каталог компании.
  const { data: catalog, error: catalogError } = await supabase
    .from("catalog_products")
    .select("id, name, brand, size_text, is_active")
    .eq("company_id", companyId)
    .neq("is_active", false);

  if (catalogError) {
    return { ...initialMatchResult, week, storeId, errors: [`Ошибка загрузки каталога: ${catalogError.message}`] };
  }

  const catalogProducts: CatalogMatchProduct[] = (catalog ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand,
    size_text: p.size_text,
    is_active: p.is_active,
  }));

  // Формируем batch-input для matching.
  const batchInputs: BatchMatchInput[] = items.map((item, index) => {
    const recognized = {
      rawName: item.raw_name,
      brand: item.brand,
      sizeText: item.size_text,
      priceTagText: item.price_tag_text,
      productVisibleText: item.product_visible_text,
    };
    const candidates = getCatalogMatchCandidates(recognized, catalogProducts, { limit: 30 });
    return {
      localId: item.id,
      rawName: item.raw_name,
      brand: item.brand,
      sizeText: item.size_text,
      candidates,
    };
  });

  // Выполняем batch-matching одним запросом.
  let batchResult;
  try {
    batchResult = await batchMatchCatalogItems(batchInputs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "неизвестная ошибка";
    return { ...initialMatchResult, week, storeId, errors: [`Ошибка matching: ${msg}`] };
  }

  // Обновляем competitor_shelf_items с результатами matching.
  // ВАЖНО: Supabase .update() применяет один объект ко всем строкам по фильтру.
  // У каждого товара свой catalog_product_id → обновляем построчно.
  const serviceClient = createSupabaseServiceRoleClient();
  const nowIso = new Date().toISOString();
  const updateErrors: string[] = [];

  for (const result of batchResult.results) {
    const { error: updateError } = await serviceClient
      .from("competitor_shelf_items")
      .update({
        catalog_product_id: result.catalogProductId,
        match_confidence: result.confidence,
        match_reason: result.reason,
        matched_at: nowIso,
      })
      .eq("id", result.localId);

    if (updateError) {
      updateErrors.push(`Ошибка обновления товара ${result.localId}: ${updateError.message}`);
    }
  }

  if (updateErrors.length > 0) {
    return {
      ...initialMatchResult,
      week,
      storeId,
      storeName: store.name,
      ok: false,
      errors: updateErrors,
    };
  }

  const matched = batchResult.results.filter((r) => r.catalogProductId !== null).length;
  const unmatched = total - matched;

  return {
    ok: true,
    week,
    storeId,
    storeName: store.name,
    matched,
    unmatched,
    total,
    errors: [],
  };
}

/**
 * Server action: обновление цены товара в competitor_shelf_items.
 * Позволяет исправить цену вручную после распознавания.
 */
export type UpdatePriceResult = {
  ok: boolean;
  error?: string;
};

export async function updateShelfItemPriceAction(
  itemId: string,
  priceMinor: number | null,
  companyId: string,
): Promise<UpdatePriceResult> {
  // Доступ.
  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return { ok: false, error: "Нет доступа к компании" };
  }

  // Проверяем, что товар принадлежит компании.
  const supabase = await createSupabaseServerClient();
  const { data: item, error: itemError } = await supabase
    .from("competitor_shelf_items")
    .select("id, company_id")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError || !item) {
    return { ok: false, error: "Товар не найден" };
  }

  if (item.company_id !== companyId) {
    return { ok: false, error: "Нет доступа к этому товару" };
  }

  // Обновляем цену.
  const serviceClient = createSupabaseServiceRoleClient();
  const { error: updateError } = await serviceClient
    .from("competitor_shelf_items")
    .update({ price_minor: priceMinor })
    .eq("id", itemId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true };
}
