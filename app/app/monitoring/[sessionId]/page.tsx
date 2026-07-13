import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { MonitoringPhotoUploadForm } from "./photo-upload-form";
import { QueueRecognitionForm } from "./queue-recognition-form";
import { CompleteSessionForm } from "./complete-session-form";

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
  status: string;
  raw_name: string;
  price_minor: number | null;
  currency: string;
  created_at: string;
};

type RecognitionJob = {
  status: string;
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
    return (
      <AccessError
        message={
          error instanceof Error
            ? error.message
            : "Не удалось проверить доступ к компании."
        }
      />
    );
  }

  if (membershipResult.status !== "ok") {
    return <NoAccess />;
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, started_at, completed_at, stores(name, address)")
    .eq("company_id", companyId)
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

  const { data: photos, error: photosError } = await supabase
    .from("monitoring_photos")
    .select("id, storage_path, status, uploaded_at")
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .order("uploaded_at", { ascending: false })
    .returns<MonitoringPhoto[]>();

  const { data: recognizedItems, error: recognizedItemsError } = await supabase
    .from("recognized_items")
    .select("id, status, raw_name, price_minor, currency, created_at")
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .returns<RecognizedItem[]>();

  const { data: recognitionJobs } = await supabase
    .from("jobs")
    .select("status")
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .eq("kind", "photo_ocr")
    .returns<RecognitionJob[]>();

  const safePhotos = photos ?? [];
  const safeRecognizedItems = recognizedItems ?? [];
  const safeJobs = recognitionJobs ?? [];
  const photoStatusCounts = getStatusCounts(safePhotos.map((photo) => photo.status));
  const itemStatusCounts = getStatusCounts(safeRecognizedItems.map((item) => item.status));
  const jobStatusCounts = getStatusCounts(safeJobs.map((job) => job.status));
  const photosCount = safePhotos.length;
  const processedPhotoCount = photoStatusCounts.processed ?? 0;
  const waitingPhotoCount =
    (photoStatusCounts.uploaded ?? 0) +
    (photoStatusCounts.failed ?? 0) +
    (photoStatusCounts.queued ?? 0);
  const processingPhotoCount = photoStatusCounts.processing ?? 0;
  const queueablePhotoCount =
    (photoStatusCounts.uploaded ?? 0) + (photoStatusCounts.failed ?? 0);
  const queuedPhotoCount = photoStatusCounts.queued ?? 0;
  const reviewCount = safeRecognizedItems.filter(isReviewItem).length;
  const recognizedCount = safeRecognizedItems.length;
  const readyForExportCount = Math.max(recognizedCount - reviewCount, 0);
  const canUseTechnicalTools = ["admin", "manager"].includes(
    membershipResult.membership.role,
  );

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">
            <Link href="/app/monitoring">Мониторинг</Link> / Сессия
          </p>
          <h1>{session.stores?.name ?? "Сессия мониторинга"}</h1>
          <p className="lead">
            {session.stores?.address || "Адрес не указан"}. Загрузите фото,
            запустите распознавание, проверьте спорные товары и выгрузите Excel.
          </p>
        </div>
        <NextAction
          sessionId={session.id}
          photosCount={photosCount}
          waitingPhotoCount={waitingPhotoCount}
          processingPhotoCount={processingPhotoCount}
          recognizedCount={recognizedCount}
          reviewCount={reviewCount}
        />
      </header>

      <section className="card soft">
        <h2>Что сейчас нужно сделать</h2>
        <SessionStage
          photosCount={photosCount}
          waitingPhotoCount={waitingPhotoCount}
          processingPhotoCount={processingPhotoCount}
          reviewCount={reviewCount}
          recognizedCount={recognizedCount}
        />
        <div className="stats" style={{ marginTop: "1rem" }}>
          <StatCard label="Фото загружено" value={photosCount} badgeClass="badge-info" />
          <StatCard label="Фото обработано" value={processedPhotoCount} badgeClass="badge-ok" />
          <StatCard label="Нужно проверить" value={reviewCount} badgeClass="badge-warn" />
          <StatCard label="Готово к Excel" value={readyForExportCount} badgeClass="badge-neutral" />
        </div>
      </section>

      <section className="card soft grid" id="photos">
        <div>
          <h2 style={{ margin: 0 }}>Фото</h2>
          <p style={{ color: "#4b5563", marginBottom: 0 }}>
            Выберите отдел и загрузите сразу несколько фото. После загрузки
            нажмите “Распознать новые фото” — система сама подготовит очередь и
            обработает пачку.
          </p>
        </div>
        <MonitoringPhotoUploadForm sessionId={session.id} />
        <QueueRecognitionForm
          sessionId={session.id}
          disabled={queueablePhotoCount + queuedPhotoCount === 0}
        />
        <PhotoList photos={safePhotos} photosError={photosError?.message} />
      </section>

      <section className="card grid">
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Проверка товаров</h2>
            <p style={{ color: "#4b5563", marginBottom: 0 }}>
              Здесь видно, сколько строк система распознала и сколько осталось
              проверить вручную.
            </p>
          </div>
          <Link className="btn" href={`/app/monitoring/${session.id}/review`}>
            Открыть проверку
          </Link>
        </div>
        {recognizedItemsError ? (
          <p style={{ color: "#b45309", margin: 0 }}>
            Не удалось загрузить товары: {recognizedItemsError.message}
          </p>
        ) : recognizedCount > 0 ? (
          <>
            <div className="stats">
              <StatCard label="Всего товаров" value={recognizedCount} badgeClass="badge-info" />
              <StatCard label="На проверке" value={reviewCount} badgeClass="badge-warn" />
              <StatCard label="Готово" value={readyForExportCount} badgeClass="badge-ok" />
            </div>
            <RecentItems items={safeRecognizedItems.slice(0, 5)} />
          </>
        ) : (
          <p style={{ color: "#4b5563", margin: 0 }}>
            После распознавания здесь появятся найденные товары.
          </p>
        )}
      </section>

      <ExportSection sessionId={session.id} reviewCount={reviewCount} recognizedCount={recognizedCount} />

      <CompleteSessionForm sessionId={session.id} status={session.status} />

      {canUseTechnicalTools ? (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Техническая диагностика
          </summary>
          <div style={{ display: "grid", gap: "1rem", marginTop: "1rem" }}>
            <p style={{ color: "#4b5563", margin: 0 }}>
              Этот блок нужен только для проверки OCR и очередей. В обычном
              рабочем сценарии он не используется.
            </p>
            <div className="stats">
              <MiniCounts title="Фото" counts={photoStatusCounts} />
              <MiniCounts title="OCR" counts={jobStatusCounts} />
              <MiniCounts title="Товары" counts={itemStatusCounts} />
            </div>
            <dl style={{ display: "grid", gap: "0.75rem", margin: 0 }}>
              <DetailRow label="ID сессии" value={session.id} />
              <DetailRow label="Статус сессии" value={session.status} />
              <DetailRow label="Создана" value={formatDateTime(session.created_at)} />
              {session.started_at ? <DetailRow label="Начата" value={formatDateTime(session.started_at)} /> : null}
              {session.completed_at ? <DetailRow label="Завершена" value={formatDateTime(session.completed_at)} /> : null}
            </dl>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <Link href={`/app/monitoring/${session.id}/review`}>Review</Link>
              <Link href="/app/ai-diagnostics">AI-диагностика</Link>
            </div>
          </div>
        </details>
      ) : null}
    </main>
  );
}

function NextAction({
  sessionId,
  photosCount,
  waitingPhotoCount,
  processingPhotoCount,
  recognizedCount,
  reviewCount,
}: {
  sessionId: string;
  photosCount: number;
  waitingPhotoCount: number;
  processingPhotoCount: number;
  recognizedCount: number;
  reviewCount: number;
}) {
  if (photosCount === 0) {
    return <a className="btn" href="#photos">Загрузить фото</a>;
  }

  if (waitingPhotoCount > 0) {
    return <a className="btn" href="#photos">Распознать фото</a>;
  }

  if (processingPhotoCount > 0) {
    return <Link className="btn" href={`/app/monitoring/${sessionId}`}>Обновить статус</Link>;
  }

  if (reviewCount > 0) {
    return (
      <Link className="btn" href={`/app/monitoring/${sessionId}/review`}>
        Проверить товары
      </Link>
    );
  }

  if (recognizedCount > 0) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <Link className="btn" href={`/app/monitoring/${sessionId}/export.xlsx`}>
          Выгрузить Excel
        </Link>
        <Link className="btn btn-secondary" href={`/app/monitoring/${sessionId}/export.json`}>
          Выгрузить JSON
        </Link>
      </div>
    );
  }

  return <a className="btn" href="#photos">Загрузить фото</a>;
}

function SessionStage({
  photosCount,
  waitingPhotoCount,
  processingPhotoCount,
  reviewCount,
  recognizedCount,
}: {
  photosCount: number;
  waitingPhotoCount: number;
  processingPhotoCount: number;
  reviewCount: number;
  recognizedCount: number;
}) {
  if (photosCount === 0) {
    return <p style={{ color: "#4b5563" }}>Начните с загрузки фото полки.</p>;
  }

  if (waitingPhotoCount > 0) {
    return <p style={{ color: "#4b5563" }}>Фото загружены. Следующий шаг — распознать новые фото.</p>;
  }

  if (processingPhotoCount > 0) {
    return <p style={{ color: "#4b5563" }}>Фото обрабатываются. Обновите страницу через несколько секунд.</p>;
  }

  if (reviewCount > 0) {
    return <p style={{ color: "#4b5563" }}>Остались спорные товары. Проверьте их перед выгрузкой.</p>;
  }

  if (recognizedCount > 0) {
    return <p style={{ color: "#4b5563" }}>Проверка завершена. Можно выгружать Excel.</p>;
  }

  return <p style={{ color: "#4b5563" }}>Фото обработаны, но товары пока не найдены.</p>;
}

function ExportSection({ sessionId, reviewCount, recognizedCount }: { sessionId: string; reviewCount: number; recognizedCount: number }) {
  const message =
    recognizedCount === 0
      ? "После распознавания здесь будут доступны Excel и JSON."
      : reviewCount > 0
        ? `Осталось проверить ${reviewCount} товаров. Отчет можно выгрузить сейчас, но лучше сначала завершить проверку.`
        : "Все товары проверены. Можно выгружать отчет.";

  return (
    <section className="card soft">
      <h2 style={{ marginTop: 0 }}>Выгрузка</h2>
      <p style={{ color: "#4b5563" }}>{message}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
        <Link className="btn" href={`/app/monitoring/${sessionId}/export.xlsx`}>
          Выгрузить Excel
        </Link>
        <Link className="btn btn-secondary" href={`/app/monitoring/${sessionId}/export.json`}>
          Выгрузить JSON
        </Link>
      </div>
    </section>
  );
}

function StatCard({ label, value, badgeClass }: { label: string; value: number; badgeClass: string }) {
  return (
    <div className="stat">
      <span className={`badge ${badgeClass}`}>{label}</span>
      <p><b>{value}</b></p>
    </div>
  );
}

function PhotoList({ photos, photosError }: { photos: MonitoringPhoto[]; photosError?: string }) {
  if (photosError) {
    return <p style={{ color: "#b45309" }}>Список фото временно недоступен: {photosError}</p>;
  }

  if (photos.length === 0) {
    return <p style={{ color: "#4b5563", margin: 0 }}>Фото пока не загружены.</p>;
  }

  return (
    <div style={{ display: "grid", gap: "0.75rem" }}>
      <h3 style={{ margin: 0 }}>Загруженные фото</h3>
      <ul style={{ display: "grid", gap: "0.5rem", listStyle: "none", margin: 0, padding: 0 }}>
        {photos.map((photo) => (
          <li key={photo.id} style={{ alignItems: "center", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "space-between", padding: "0.75rem" }}>
            <span>{getStorageFilename(photo.storage_path) || formatShortId(photo.id)}</span>
            <span className="badge badge-neutral">{getHumanPhotoStatus(photo.status)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentItems({ items }: { items: RecognizedItem[] }) {
  return (
    <div className="table-wrap">
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cellStyle}>Товар</th>
            <th style={cellStyle}>Цена</th>
            <th style={cellStyle}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={cellStyle}>{item.raw_name}</td>
              <td style={cellStyle}>{formatPrice(item.price_minor, item.currency)}</td>
              <td style={cellStyle}>{getHumanItemStatus(item.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniCounts({ title, counts }: { title: string; counts: Record<string, number> }) {
  return (
    <div className="stat">
      <strong>{title}</strong>
      <p style={{ margin: "0.25rem 0 0" }}>
        {Object.entries(counts).length > 0
          ? Object.entries(counts).map(([key, value]) => `${key}: ${value}`).join(" · ")
          : "—"}
      </p>
    </div>
  );
}

const cellStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "0.5rem",
  textAlign: "left" as const,
  verticalAlign: "top" as const,
};

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

function isReviewItem(item: RecognizedItem) {
  return item.status === "recognized" || item.status === "needs_review" || item.status === "unmatched";
}

function getStatusCounts(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ru-RU");
}

function formatShortId(value: string | null) {
  return value ? value.slice(0, 8) : "—";
}

function formatPrice(priceMinor: number | null, currency: string | null) {
  if (priceMinor === null) {
    return "—";
  }

  return `${(priceMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`;
}

function getHumanPhotoStatus(status: string) {
  const labels: Record<string, string> = {
    failed: "Ошибка",
    processed: "Обработано",
    processing: "Обрабатывается",
    queued: "В очереди",
    uploaded: "Загружено",
  };

  return labels[status] ?? status;
}

function getHumanItemStatus(status: string) {
  const labels: Record<string, string> = {
    confirmed: "Подтверждено",
    matched: "Сопоставлено",
    needs_review: "На проверке",
    recognized: "На проверке",
    rejected: "Отклонено",
    unmatched: "Без совпадения",
  };

  return labels[status] ?? status;
}

function getStorageFilename(storagePath: string) {
  const segments = storagePath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
