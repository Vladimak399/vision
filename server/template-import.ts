"use server";

import { createSupabaseServiceRoleClient } from "../lib/supabase/service-role";
import { CATALOG_WRITE_ROLES, hasCompanyRole, roleList } from "./company-access";
import { getPrimaryCompanyMembership } from "./primary-membership";
import { parseMonitoringTemplate, type ParsedTemplate } from "./template-parser";

export type TemplateImportResult = {
  ok: boolean;
  week: 1 | 2;
  products: number;
  stores: number;
  ownStores: number;
  competitorStores: number;
  errors: string[];
};

const initialResult: TemplateImportResult = {
  ok: false,
  week: 1,
  products: 0,
  stores: 0,
  ownStores: 0,
  competitorStores: 0,
  errors: [],
};

const UPSERT_BATCH_SIZE = 500;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Заливает/обновляет магазины. Возвращает map: label → store_id.
 * Дедупликация по (company_id, name, address).
 */
async function upsertStores(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  companyId: string,
  parsed: ParsedTemplate,
): Promise<number> {
  const { data: existing, error: fetchErr } = await supabase
    .from("stores")
    .select("id, name, address")
    .eq("company_id", companyId);

  if (fetchErr) {
    throw new Error(`Не удалось загрузить магазины: ${fetchErr.message}`);
  }

  const existingByKey = new Map<string, string>();
  for (const row of existing ?? []) {
    existingByKey.set(`${row.name ?? ""}|${row.address ?? ""}`, row.id);
  }

  let created = 0;
  const toCreate = parsed.stores.filter((s) => !existingByKey.has(`${s.name}|${s.address ?? ""}`));
  if (toCreate.length > 0) {
    const rows = toCreate.map((s) => ({
      company_id: companyId,
      name: s.name,
      address: s.address,
      is_own: s.isOwn,
    }));
    const { error: insertErr } = await supabase.from("stores").insert(rows);
    if (insertErr) {
      throw new Error(`Не удалось создать магазины: ${insertErr.message}`);
    }
    created = toCreate.length;
  }

  // обновляем is_own у существующих, если теперь они наши
  const nowOwn = parsed.stores.filter(
    (s) => s.isOwn && existingByKey.has(`${s.name}|${s.address ?? ""}`),
  );
  for (const s of nowOwn) {
    const id = existingByKey.get(`${s.name}|${s.address ?? ""}`);
    if (id) {
      await supabase.from("stores").update({ is_own: true }).eq("id", id);
    }
  }

  return (existing?.length ?? 0) + created;
}

/**
 * Заливает/обновляет товары каталога по штрихкоду.
 * Использует existing unique constraint (company_id, external_sku) — barcode = external_sku.
 * Возвращает количество обработанных строк.
 */
async function upsertProducts(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  companyId: string,
  parsed: ParsedTemplate,
): Promise<number> {
  const rows = parsed.products.map((p) => ({
    company_id: companyId,
    barcode: p.barcode,
    external_sku: p.barcode,
    name: p.name,
    department: p.department,
    category: p.category,
    is_active: true,
  }));

  let total = 0;
  for (const batch of chunkArray(rows, UPSERT_BATCH_SIZE)) {
    // onConflict по существующему constraint (company_id, external_sku)
    const { error } = await supabase
      .from("catalog_products")
      .upsert(batch, { onConflict: "company_id,external_sku" });

    if (error) {
      throw new Error(`Не удалось загрузить товары: ${error.message}`);
    }
    total += batch.length;
  }
  return total;
}

export async function importMonitoringTemplateAction(
  _previousState: TemplateImportResult,
  formData: FormData,
): Promise<TemplateImportResult> {
  const file = formData.get("file");
  const weekRaw = formData.get("week");
  const week = weekRaw === "2" ? 2 : 1;

  if (!(file instanceof File) || file.size === 0) {
    return { ...initialResult, week, errors: ["Выберите XLSX файл шаблона"] };
  }

  const membershipResult = await getPrimaryCompanyMembership();
  if (membershipResult.status !== "ok" || !membershipResult.membership) {
    return { ...initialResult, week, errors: ["Нет доступа к компании"] };
  }

  if (!hasCompanyRole(membershipResult.membership, CATALOG_WRITE_ROLES)) {
    return {
      ...initialResult,
      week,
      errors: [`Недостаточно прав. Импортировать шаблон могут только ${roleList(CATALOG_WRITE_ROLES)}.`],
    };
  }

  const companyId = membershipResult.membership.companyId;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseMonitoringTemplate(buffer, week);

    if (parsed.products.length === 0) {
      return { ...initialResult, week, errors: ["В файле не найдено ни одного товара со штрихкодом"] };
    }

    const supabase = createSupabaseServiceRoleClient();
    const productCount = await upsertProducts(supabase, companyId, parsed);
    const storeCount = await upsertStores(supabase, companyId, parsed);

    return {
      ok: true,
      week,
      products: productCount,
      stores: storeCount,
      ownStores: parsed.stores.filter((s) => s.isOwn).length,
      competitorStores: parsed.stores.filter((s) => !s.isOwn).length,
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка импорта";
    return { ...initialResult, week, errors: [message] };
  }
}
