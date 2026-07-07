import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";
import { ManualRecognizedItemForm } from "./manual-item-form";
import { MonitoringPhotoUploadForm } from "./photo-upload-form";
import { ProcessQueueForm } from "./process-queue-form";
import { QueueRecognitionForm } from "./queue-recognition-form";

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
  photo_id: string | null;
  raw_name: string;
  brand: string | null;
  size_text: string | null;
  price_minor: number | null;
  old_price_minor: number | null;
  promo_price_minor: number | null;
  currency: string;
  confidence: number;
  link_confidence: number | null;
  price_tag_text: string | null;
  product_visible_text: string | null;
  review_reason: string | null;
  position_hint: string | null;
  status: string;
  created_at: string;
  monitoring_photos: {
    storage_path: string;
  } | null;
};

type RecognitionJob = {
  status: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_microusd: number | null;
  duration_ms: number | null;
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

  const supabase = await createSupabaseServerClient();
  const { data: session, error } = await supabase
    .from("monitoring_sessions")
    .select(
      "id, status, created_at, started_at, completed_at, stores(name, address)",
    )
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
    .select(
      "id, photo_id, raw_name, brand, size_text, price_minor, old_price_minor, promo_price_minor, currency, confidence, link_confidence, price_tag_text, product_visible_text, review_reason, position_hint, status, created_at, monitoring_photos(storage_path)",
    )
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .returns<RecognizedItem[]>();

  const { data: recognitionJobs, error: recognitionJobsError } = await supabase
    .from("jobs")
    .select(
      "status, model, input_tokens, output_tokens, estimated_cost_microusd, duration_ms",
    )
    .eq("company_id", companyId)
    .eq("session_id", session.id)
    .eq("kind", "photo_ocr")
    .returns<RecognitionJob[]>();

  const recognizedItemIds = (recognizedItems ?? []).map((item) => item.id);
  const activeMatchesCount =
    recognizedItemIds.length > 0
      ? ((
          await supabase
            .from("matches")
            .select("id", { count: "exact", head: true })
            .eq("company_id", companyId)
            .eq("is_active", true)
            .in("recognized_item_id", recognizedItemIds)
        ).count ?? 0)
      : 0;

  const photoOptions = (photos ?? []).map((photo) => ({
    id: photo.id,
    label: getStorageFilename(photo.storage_path) || formatShortId(photo.id),
  }));
  const canCreateManualItems = ["admin", "manager"].includes(
    membershipResult.membership.role,
  );
  const photoStatusCounts = getPhotoStatusCounts(photos ?? []);
  const queueablePhotoCount =
    (photoStatusCounts.uploaded ?? 0) + (photoStatusCounts.failed ?? 0);
  const recognitionJobSummary = getRecognitionJobSummary(recognitionJobs ?? []);

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">
            <Link href="/app/monitoring">Мониторинг</Link> / Сессия
          </p>
          <h1>Сессия {formatShortId(session.id)}</h1>
          <p className="lead">
            {session.stores?.name ?? "Магазин не указан"} ·{" "}
            {membershipResult.membership.companyName}. Главный следующий шаг
            зависит от готовности фото и проверки.
          </p>
        </div>
        <NextAction
          sessionId={session.id}
          photosCount={photos?.length ?? 0}
          queueablePhotoCount={queueablePhotoCount}
          recognizedCount={recognizedItems?.length ?? 0}
          reviewCount={
            (recognizedItems ?? []).filter(
              (item) =>
                item.status === "recognized" ||
                item.status === "needs_review" ||
                item.status === "unmatched",
            ).length
          }
        />
      </header>

      <section className="card soft">
        <h2>Прогресс сессии</h2>
        <div className="stats" style={{ marginTop: "1rem" }}>
          <div className="stat">
            <span className="badge badge-info">Фото загружено</span>
            <p>
              <b>{photos?.length ?? 0}</b>
            </p>
          </div>
          <div className="stat">
            <span className="badge badge-ok">Обработано</span>
            <p>
              <b>{photoStatusCounts.processed ?? 0}</b>
            </p>
          </div>
          <div className="stat">
            <span className="badge badge-warn">Требует проверки</span>
            <p>
              <b>
                {
                  (recognizedItems ?? []).filter(
                    (item) =>
                      item.status === "recognized" ||
                      item.status === "needs_review",
                  ).length
                }
              </b>
            </p>
          </div>
          <div className="stat">
            <span className="badge badge-neutral">К экспорту</span>
            <p>
              <b>
                {Math.max(
                  (recognizedItems?.length ?? 0) -
                    (recognizedItems ?? []).filter(
                      (item) =>
                        item.status === "recognized" ||
                        item.status === "needs_review",
                    ).length,
                  0,
                )}
              </b>
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Детали сессии</h2>
        {photosError ? (
          <p style={{ color: "#b45309" }}>
            Не удалось загрузить фото: {photosError.message}
          </p>
        ) : null}
        <dl style={{ display: "grid", gap: "0.75rem", margin: 0 }}>
          <DetailRow label="ID сессии" value={session.id} />
          <DetailRow
            label="Компания"
            value={membershipResult.membership.companyName}
          />
          <DetailRow label="Магазин" value={session.stores?.name ?? "—"} />
          <DetailRow
            label="Адрес магазина"
            value={session.stores?.address || "—"}
          />
          <DetailRow label="Статус" value={session.status} />
          <DetailRow
            label="Создана"
            value={formatDateTime(session.created_at)}
          />
          {session.started_at ? (
            <DetailRow
              label="Начата"
              value={formatDateTime(session.started_at)}
            />
          ) : null}
          {session.completed_at ? (
            <DetailRow
              label="Завершена"
              value={formatDateTime(session.completed_at)}
            />
          ) : null}
          <DetailRow label="Фото" value={String(photos?.length ?? 0)} />
        </dl>
      </section>

      {canCreateManualItems ? (
        <SessionDiagnosticsPanel
          activeMatchesCount={activeMatchesCount}
          jobs={recognitionJobs ?? []}
          photos={photos ?? []}
          recognizedItems={recognizedItems ?? []}
          sessionId={session.id}
          sessionStatus={session.status}
        />
      ) : null}

      <section className="card soft grid">
        <h2 id="photos" style={{ margin: 0 }}>
          Фото
        </h2>
        <MonitoringPhotoUploadForm sessionId={session.id} />
        {canCreateManualItems ? (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              background: "#fff",
              padding: "0.75rem",
              display: "grid",
              gap: "0.75rem",
            }}
          >
            <h3 style={{ margin: 0 }}>Очередь распознавания</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {Object.entries(photoStatusCounts).map(([status, count]) => (
                <span
                  key={status}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 999,
                    padding: "0.25rem 0.5rem",
                  }}
                >
                  {status}: {count}
                </span>
              ))}
            </div>
            {recognitionJobsError ? (
              <p style={{ color: "#b45309", margin: 0 }}>
                Не удалось загрузить usage OCR: {recognitionJobsError.message}
              </p>
            ) : (
              <dl style={{ display: "grid", gap: "0.5rem", margin: 0 }}>
                <DetailRow
                  label="OCR jobs"
                  value={String(recognitionJobSummary.totalJobs)}
                />
                <DetailRow
                  label="Токены"
                  value={`${recognitionJobSummary.inputTokens} input / ${recognitionJobSummary.outputTokens} output`}
                />
                <DetailRow
                  label="Стоимость"
                  value={formatMicroUsd(
                    recognitionJobSummary.estimatedCostMicrousd,
                  )}
                />
                <DetailRow
                  label="Среднее время"
                  value={formatDurationMs(
                    recognitionJobSummary.averageDurationMs,
                  )}
                />
              </dl>
            )}
            <QueueRecognitionForm
              sessionId={session.id}
              disabled={queueablePhotoCount === 0}
            />
            <ProcessQueueForm sessionId={session.id} />
          </div>
        ) : null}
        <div>
          <h3 style={{ marginTop: 0 }}>Загруженные фото</h3>
          {photosError ? (
            <p style={{ color: "#b45309" }}>Список фото временно недоступен.</p>
          ) : photos && photos.length > 0 ? (
            <ul
              style={{
                display: "grid",
                gap: "0.75rem",
                listStyle: "none",
                margin: 0,
                padding: 0,
              }}
            >
              {photos.map((photo) => (
                <li
                  key={photo.id}
                  style={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "0.75rem",
                  }}
                >
                  <dl style={{ display: "grid", gap: "0.35rem", margin: 0 }}>
                    <DetailRow
                      label="Дата загрузки"
                      value={
                        photo.uploaded_at
                          ? formatDateTime(photo.uploaded_at)
                          : "—"
                      }
                    />
                    <DetailRow label="Статус" value={photo.status} />
                    <DetailRow
                      label="Файл"
                      value={
                        getStorageFilename(photo.storage_path) ||
                        formatShortId(photo.id)
                      }
                    />
                    <DetailRow
                      label="Путь в Storage"
                      value={photo.storage_path}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, color: "#4b5563" }}>
              Фото пока не загружены. Форма выше готова к первой загрузке.
            </p>
          )}
        </div>
      </section>

      {canCreateManualItems ? (
        <section className="card soft grid">
          <h2 style={{ margin: 0 }}>Ручная правка / fallback</h2>
          <p style={{ color: "#4b5563", margin: 0 }}>
            Основной поток: загрузить фото и дождаться распознавания. Ручное
            добавление нужно только как запасной вариант, если AI не распознал
            товар или требуется корректировка.
          </p>
          <ManualRecognizedItemForm
            sessionId={session.id}
            photos={photoOptions}
          />
        </section>
      ) : null}

      <section className="card grid">
        <h2 style={{ margin: 0 }}>Распознанные товары</h2>
        {recognizedItemsError ? (
          <p style={{ color: "#b45309", margin: 0 }}>
            Не удалось загрузить товары: {recognizedItemsError.message}
          </p>
        ) : recognizedItems && recognizedItems.length > 0 ? (
          <div className="table-wrap">
            <table
              style={{
                borderCollapse: "collapse",
                minWidth: 1200,
                width: "100%",
              }}
            >
              <thead>
                <tr>
                  <th style={cellStyle}>Товар</th>
                  <th style={cellStyle}>Цена</th>
                  <th style={cellStyle}>Старая</th>
                  <th style={cellStyle}>Акция</th>
                  <th style={cellStyle}>Бренд</th>
                  <th style={cellStyle}>Размер</th>
                  <th style={cellStyle}>Уверенность</th>
                  <th style={cellStyle}>Связь</th>
                  <th style={cellStyle}>Текст ценника</th>
                  <th style={cellStyle}>Текст товара</th>
                  <th style={cellStyle}>Проверка</th>
                  <th style={cellStyle}>Место</th>
                  <th style={cellStyle}>Статус</th>
                  <th style={cellStyle}>Создан</th>
                  <th style={cellStyle}>Фото</th>
                </tr>
              </thead>
              <tbody>
                {recognizedItems.map((item) => (
                  <tr key={item.id}>
                    <td style={cellStyle}>{item.raw_name}</td>
                    <td style={cellStyle}>
                      {formatPrice(item.price_minor, item.currency)}
                    </td>
                    <td style={cellStyle}>
                      {formatPrice(item.old_price_minor, item.currency)}
                    </td>
                    <td style={cellStyle}>
                      {formatPrice(item.promo_price_minor, item.currency)}
                    </td>
                    <td style={cellStyle}>{item.brand || "—"}</td>
                    <td style={cellStyle}>{item.size_text || "—"}</td>
                    <td style={cellStyle}>
                      {formatConfidence(item.confidence)}
                    </td>
                    <td style={cellStyle}>
                      {formatConfidence(item.link_confidence)}
                    </td>
                    <td style={cellStyle}>{item.price_tag_text || "—"}</td>
                    <td style={cellStyle}>
                      {item.product_visible_text || "—"}
                    </td>
                    <td style={cellStyle}>{item.review_reason || "—"}</td>
                    <td style={cellStyle}>{item.position_hint || "—"}</td>
                    <td style={cellStyle}>{item.status}</td>
                    <td style={cellStyle}>{formatDateTime(item.created_at)}</td>
                    <td style={cellStyle}>
                      {getRecognizedItemPhotoLabel(item)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.25rem" }}>
            <p style={{ fontWeight: 600, margin: 0 }}>Товары пока не внесены</p>
            <p style={{ color: "#4b5563", margin: 0 }}>
              После распознавания здесь появятся найденные товары. Ручное
              добавление нужно только как запасной вариант.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function NextAction({
  sessionId,
  photosCount,
  queueablePhotoCount,
  recognizedCount,
  reviewCount,
}: {
  sessionId: string;
  photosCount: number;
  queueablePhotoCount: number;
  recognizedCount: number;
  reviewCount: number;
}) {
  if (photosCount === 0)
    return (
      <a className="btn" href="#photos">
        Загрузить фото
      </a>
    );
  if (queueablePhotoCount > 0)
    return <span className="badge badge-info">Фото готовы к OCR</span>;
  if (reviewCount > 0)
    return (
      <Link className="btn" href={`/app/monitoring/${sessionId}/review`}>
        Проверить совпадения
      </Link>
    );
  if (recognizedCount > 0)
    return (
      <Link className="btn" href={`/app/monitoring/${sessionId}/export.xlsx`}>
        Выгрузить Excel
      </Link>
    );
  return <span className="badge badge-warn">Ожидаем распознавание</span>;
}

function SessionDiagnosticsPanel({
  activeMatchesCount,
  jobs,
  photos,
  recognizedItems,
  sessionId,
  sessionStatus,
}: {
  activeMatchesCount: number;
  jobs: RecognitionJob[];
  photos: MonitoringPhoto[];
  recognizedItems: RecognizedItem[];
  sessionId: string;
  sessionStatus: string;
}) {
  const photoCounts = countStatuses(
    photos.map((photo) => photo.status),
    ["uploaded", "queued", "processing", "processed", "failed"],
  );
  const jobCounts = countStatuses(
    jobs.map((job) => job.status),
    ["queued", "running", "succeeded", "failed", "cancelled"],
  );
  const itemCounts = countStatuses(
    recognizedItems.map((item) => item.status),
    [
      "recognized",
      "matched",
      "needs_review",
      "unmatched",
      "confirmed",
      "rejected",
    ],
  );
  const summary = getRecognitionJobSummary(jobs);
  const hints = [
    photoCounts.uploaded > 0 && jobCounts.queued === 0
      ? "Фото загружены, но не поставлены в очередь. Нажмите кнопку постановки в очередь."
      : null,
    jobCounts.queued > 0
      ? "Есть задачи OCR в очереди. Запустите тест 1 фото или пачку."
      : null,
    jobCounts.failed > 0
      ? "Есть ошибки OCR. Откройте диагностику или проверьте текст ошибки."
      : null,
    recognizedItems.length === 0 && photoCounts.processed > 0
      ? "Фото обработаны, но товары не распознаны. Возможно, фото слишком размытое или ценники не читаются."
      : null,
  ].filter((hint): hint is string => Boolean(hint));
  const debugSummary = [
    `session_id: ${sessionId}`,
    `session_status: ${sessionStatus}`,
    `photo_counts: ${JSON.stringify(photoCounts)}`,
    `ocr_job_counts: ${JSON.stringify(jobCounts)}`,
    `recognized_item_counts: ${JSON.stringify(itemCounts)}`,
    `active_matches: ${activeMatchesCount}`,
  ].join("\n");

  return (
    <section
      style={{
        border: "1px solid #93c5fd",
        borderRadius: 12,
        padding: "1rem",
        background: "#eff6ff",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <h2 style={{ margin: 0 }}>Диагностика сессии</h2>
      <div
        style={{
          display: "grid",
          gap: "0.75rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <MiniCounts title="Фото" counts={photoCounts} />
        <MiniCounts title="OCR jobs" counts={jobCounts} />
        <MiniCounts title="Товары" counts={itemCounts} />
      </div>
      <p style={{ margin: 0 }}>
        Активные matches: {activeMatchesCount}. Токены: {summary.inputTokens}{" "}
        input / {summary.outputTokens} output. Стоимость:{" "}
        {formatMicroUsd(summary.estimatedCostMicrousd)}.
      </p>
      <p style={{ margin: 0 }}>
        <Link href={`/app/monitoring/${sessionId}/review`}>Review</Link> ·{" "}
        <Link href={`/app/monitoring/${sessionId}/export.xlsx`}>
          Export XLSX
        </Link>{" "}
        ·{" "}
        <Link href={`/app/monitoring/${sessionId}/export-detailed.xlsx`}>
          Detailed export
        </Link>{" "}
        · <Link href="/app/ai-diagnostics">AI-диагностика</Link>
      </p>
      {hints.length > 0 ? (
        <ul style={{ margin: 0 }}>
          {hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      ) : null}
      <pre
        style={{
          background: "#fff",
          borderRadius: 8,
          margin: 0,
          overflowX: "auto",
          padding: "0.5rem",
        }}
      >
        {debugSummary}
      </pre>
    </section>
  );
}

function MiniCounts({
  title,
  counts,
}: {
  title: string;
  counts: Record<string, number>;
}) {
  return (
    <div>
      <strong>{title}</strong>
      <p style={{ margin: "0.25rem 0 0" }}>
        {Object.entries(counts)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ")}
      </p>
    </div>
  );
}

function countStatuses(values: string[], statuses: string[]) {
  return statuses.reduce<Record<string, number>>((counts, status) => {
    counts[status] = values.filter((value) => value === status).length;
    return counts;
  }, {});
}

const cellStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "0.5rem",
  textAlign: "left" as const,
  verticalAlign: "top" as const,
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gap: "0.25rem",
        gridTemplateColumns: "minmax(140px, 220px) 1fr",
      }}
    >
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
      <p>
        Ваш пользователь авторизован, но пока не добавлен в company_members.
      </p>
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

function formatShortId(value: string | null) {
  return value ? value.slice(0, 8) : "—";
}

function formatPrice(priceMinor: number | null, currency: string | null) {
  if (priceMinor === null) {
    return "—";
  }

  return `${(priceMinor / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || "RUB"}`;
}

function formatConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `${Math.round(value * 100)}%`;
}

function getPhotoStatusCounts(photos: MonitoringPhoto[]) {
  return photos.reduce<Record<string, number>>((counts, photo) => {
    counts[photo.status] = (counts[photo.status] ?? 0) + 1;
    return counts;
  }, {});
}

function getRecognitionJobSummary(jobs: RecognitionJob[]) {
  const durationValues = jobs
    .map((job) => job.duration_ms)
    .filter(
      (duration): duration is number =>
        typeof duration === "number" && Number.isFinite(duration),
    );

  return {
    totalJobs: jobs.length,
    inputTokens: jobs.reduce((sum, job) => sum + (job.input_tokens ?? 0), 0),
    outputTokens: jobs.reduce((sum, job) => sum + (job.output_tokens ?? 0), 0),
    estimatedCostMicrousd: jobs.reduce(
      (sum, job) => sum + (job.estimated_cost_microusd ?? 0),
      0,
    ),
    averageDurationMs:
      durationValues.length > 0
        ? Math.round(
            durationValues.reduce((sum, duration) => sum + duration, 0) /
              durationValues.length,
          )
        : null,
  };
}

function formatMicroUsd(value: number) {
  if (value <= 0) {
    return "$0.0000";
  }

  return `$${(value / 1_000_000).toFixed(value >= 100_000 ? 2 : 4)}`;
}

function formatDurationMs(value: number | null) {
  if (value === null) {
    return "—";
  }

  if (value < 1000) {
    return `${value} мс`;
  }

  return `${(value / 1000).toFixed(1)} сек`;
}

function getRecognizedItemPhotoLabel(item: RecognizedItem) {
  const storagePath = item.monitoring_photos?.storage_path;

  if (storagePath) {
    return getStorageFilename(storagePath) || formatShortId(item.photo_id);
  }

  return item.photo_id
    ? `Фото ${formatShortId(item.photo_id)}`
    : "Фото не связано";
}

function getStorageFilename(storagePath: string) {
  const segments = storagePath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
