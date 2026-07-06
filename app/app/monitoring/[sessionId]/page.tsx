import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { ManualRecognizedItemForm } from "./manual-item-form";
import { MonitoringPhotoUploadForm } from "./photo-upload-form";

export const dynamic = "force-dynamic";

type MonitoringSession = {
  id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  stores: {
    name: string;
    address: string | null;
  } | null;
};

type MonitoringPhoto = {
  id: string;
  storage_path: string;
  status: string;
  uploaded_at: string | null;
};

type RecognizedItem = {
  id: string;
  photo_id: string;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  currency: string;
  status: string;
  created_at: string;
  monitoring_photos: {
    storage_path: string;
  } | null;
};

type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function MonitoringSessionPage({ params }: PageProps) {
  const { sessionId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/app/monitoring/${encodeURIComponent(sessionId)}`);
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return <AccessError message={error instanceof Error ? error.message : "Не удалось проверить доступ к компании."} />;
  }

  if (membershipResult.status !== "ok") {
    return <NoAccess />;
  }

  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, started_at, completed_at, stores(name, address)")
    .eq("company_id", membershipResult.membership.companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<MonitoringSession | null>();

  if (error) {
    return (
      <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
        <Link href="/app/monitoring">← Мониторинг</Link>
        <h1>Не удалось загрузить сессию мониторинга</h1>
        <p>{error.message}</p>
      </main>
    );
  }

  if (!session) {
    return <SessionNotFound />;
  }

  const companyId = membershipResult.membership.companyId;
  const { data: photos, error: photosError } = await supabase
    .from("monitoring_photos")
    .select("id, storage_path, status, uploaded_at")
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .order("uploaded_at", { ascending: false })
    .returns<MonitoringPhoto[]>();

  const { data: recognizedItems, error: recognizedItemsError } = await supabase
    .from("recognized_items")
    .select("id, photo_id, raw_name, brand, size_text, price_minor, currency, status, created_at, monitoring_photos(storage_path)")
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .returns<RecognizedItem[]>();

  const photoOptions = (photos ?? []).map((photo) => ({
    id: photo.id,
    label: getStorageFilename(photo.storage_path) || formatShortId(photo.id),
  }));
  const canCreateManualItems = ["admin", "manager"].includes(membershipResult.membership.role);

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href="/app/monitoring">← Мониторинг</Link>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>Сессия мониторинга {formatShortId(session.id)}</h1>
          <p style={{ margin: 0 }}>Компания: {membershipResult.membership.companyName}</p>
        </div>
      </header>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Детали сессии</h2>
        {photosError ? (
          <p style={{ color: "#b45309" }}>Не удалось загрузить фото: {photosError.message}</p>
        ) : null}
        <dl style={{ display: "grid", gap: "0.75rem", margin: 0 }}>
          <DetailRow label="ID сессии" value={session.id} />
          <DetailRow label="Компания" value={membershipResult.membership.companyName} />
          <DetailRow label="Магазин" value={session.stores?.name ?? "—"} />
          <DetailRow label="Адрес магазина" value={session.stores?.address || "—"} />
          <DetailRow label="Статус" value={session.status} />
          <DetailRow label="Создана" value={formatDateTime(session.created_at)} />
          {session.started_at ? <DetailRow label="Начата" value={formatDateTime(session.started_at)} /> : null}
          {session.completed_at ? <DetailRow label="Завершена" value={formatDateTime(session.completed_at)} /> : null}
          <DetailRow label="Фото" value={String(photos?.length ?? 0)} />
        </dl>
      </section>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb", display: "grid", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Фото</h2>
        <MonitoringPhotoUploadForm sessionId={session.id} />
        <div>
          <h3 style={{ marginTop: 0 }}>Загруженные фото</h3>
          {photosError ? (
            <p style={{ color: "#b45309" }}>Список фото временно недоступен.</p>
          ) : photos && photos.length > 0 ? (
            <ul style={{ display: "grid", gap: "0.75rem", listStyle: "none", margin: 0, padding: 0 }}>
              {photos.map((photo) => (
                <li key={photo.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.75rem" }}>
                  <dl style={{ display: "grid", gap: "0.35rem", margin: 0 }}>
                    <DetailRow label="Дата загрузки" value={photo.uploaded_at ? formatDateTime(photo.uploaded_at) : "—"} />
                    <DetailRow label="Статус" value={photo.status} />
                    <DetailRow label="Файл" value={getStorageFilename(photo.storage_path) || formatShortId(photo.id)} />
                    <DetailRow label="Путь в Storage" value={photo.storage_path} />
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: "#4b5563" }}>Фото пока не загружены. Форма выше готова к первой загрузке.</p>
          )}
        </div>
      </section>

      {canCreateManualItems ? (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb", display: "grid", gap: "1rem" }}>
          <h2 style={{ margin: 0 }}>Ручной ввод товара</h2>
          <ManualRecognizedItemForm sessionId={session.id} photos={photoOptions} />
        </section>
      ) : null}

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", display: "grid", gap: "1rem" }}>
        <h2 style={{ margin: 0 }}>Распознанные товары</h2>
        {recognizedItemsError ? (
          <p style={{ color: "#b45309", margin: 0 }}>Не удалось загрузить товары: {recognizedItemsError.message}</p>
        ) : recognizedItems && recognizedItems.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={cellStyle}>Товар</th>
                  <th style={cellStyle}>Цена</th>
                  <th style={cellStyle}>Бренд</th>
                  <th style={cellStyle}>Размер</th>
                  <th style={cellStyle}>Статус</th>
                  <th style={cellStyle}>Создан</th>
                  <th style={cellStyle}>Фото</th>
                </tr>
              </thead>
              <tbody>
                {recognizedItems.map((item) => (
                  <tr key={item.id}>
                    <td style={cellStyle}>{item.raw_name}</td>
                    <td style={cellStyle}>{formatPrice(item.price_minor, item.currency)}</td>
                    <td style={cellStyle}>{item.brand || "—"}</td>
                    <td style={cellStyle}>{item.size_text || "—"}</td>
                    <td style={cellStyle}>{item.status}</td>
                    <td style={cellStyle}>{formatDateTime(item.created_at)}</td>
                    <td style={cellStyle}>{getStorageFilename(item.monitoring_photos?.storage_path ?? "") || formatShortId(item.photo_id)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <p style={{ fontWeight: 600, margin: 0 }}>Товары пока не внесены</p>
            <p style={{ color: "#4b5563", margin: 0 }}>Добавьте товар вручную по загруженному фото</p>
          </div>
        )}
      </section>
    </main>
  );
}

const cellStyle = { borderBottom: "1px solid #e5e7eb", padding: "0.5rem", textAlign: "left" as const };

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: "0.25rem", gridTemplateColumns: "minmax(140px, 220px) 1fr" }}>
      <dt style={{ color: "#4b5563" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

function SessionNotFound() {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app/monitoring">← Мониторинг</Link>
      <h1>Сессия мониторинга не найдена</h1>
      <p>Сессия не существует или недоступна для текущей компании.</p>
    </main>
  );
}

function NoAccess() {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app">← Рабочая область</Link>
      <h1>Нет доступа к компании</h1>
      <p>Ваш пользователь авторизован, но пока не добавлен в company_members.</p>
    </main>
  );
}

function AccessError({ message }: { message: string }) {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app">← Рабочая область</Link>
      <h1>Не удалось проверить доступ к компании</h1>
      <p>{message}</p>
    </main>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU");
}

function formatShortId(value: string) {
  return value.slice(0, 8);
}

function formatPrice(priceMinor: number | null, currency: string) {
  if (priceMinor === null) {
    return "—";
  }

  return `${(priceMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function getStorageFilename(storagePath: string) {
  const segments = storagePath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
