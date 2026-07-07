import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";

export const dynamic = "force-dynamic";

type MonitoringSessionRow = {
  id: string;
  status: string;
  created_at: string;
  stores: {
    name: string;
  } | null;
};

type MonitoringPhotoRow = {
  session_id: string;
};

export default async function MonitoringPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/monitoring");
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
  const { data: sessions, error } = await supabase
    .from("monitoring_sessions")
    .select("id, status, created_at, stores(name)")
    .eq("company_id", membershipResult.membership.companyId)
    .order("created_at", { ascending: false })
    .returns<MonitoringSessionRow[]>();

  const sessionIds = (sessions ?? []).map((session) => session.id);
  const photoCounts = new Map<string, number>();

  let photoCountError: string | null = null;

  if (sessionIds.length > 0) {
    const { data: photos, error: photosError } = await supabase
      .from("monitoring_photos")
      .select("session_id")
      .eq("company_id", membershipResult.membership.companyId)
      .in("session_id", sessionIds)
      .returns<MonitoringPhotoRow[]>();

    if (photosError) {
      photoCountError = photosError.message;
    }

    for (const photo of photos ?? []) {
      photoCounts.set(
        photo.session_id,
        (photoCounts.get(photo.session_id) ?? 0) + 1,
      );
    }
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">
            <Link href="/app">Рабочая область</Link> / Мониторинг
          </p>
          <h1>Сессии мониторинга</h1>
          <p className="lead">
            Компания: {membershipResult.membership.companyName}. Создайте
            сессию, загрузите фото и переходите к проверке только спорных
            совпадений.
          </p>
        </div>
        <div className="actions">
          <Link className="btn" href="/app/monitoring/new">
            Создать сессию
          </Link>
          <Link
            className="btn btn-secondary"
            href="/app/monitoring/test-center"
          >
            Центр тестирования
          </Link>
        </div>
      </header>

      <section className="card">
        <div className="hero">
          <div>
            <h2>Все сессии</h2>
            <p className="lead">
              Откройте последнюю сессию или создайте новую для очередного обхода
              магазина.
            </p>
          </div>
        </div>
        {photoCountError ? (
          <p className="alert alert-warn">
            Не удалось загрузить количество фото: {photoCountError}
          </p>
        ) : null}
        {error ? (
          <p className="alert alert-bad">
            Не удалось загрузить сессии: {error.message}
          </p>
        ) : !sessions || sessions.length === 0 ? (
          <div className="empty">
            <h2>Сессий пока нет</h2>
            <p className="muted">
              Создайте первую сессию мониторинга. После этого здесь появятся
              фото, статусы обработки и ссылка на экспорт.
            </p>
            <Link className="btn" href="/app/monitoring/new">
              Создать первую сессию
            </Link>
          </div>
        ) : (
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Магазин</th>
                  <th>Фото</th>
                  <th>Следующий шаг</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const photos = photoCounts.get(session.id) ?? 0;
                  return (
                    <tr key={session.id}>
                      <td>
                        <Link href={`/app/monitoring/${session.id}`}>
                          {new Date(session.created_at).toLocaleString("ru-RU")}
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={session.status} />
                      </td>
                      <td>{session.stores?.name ?? "Магазин не указан"}</td>
                      <td>{photos}</td>
                      <td>
                        <Link
                          className="btn btn-secondary"
                          href={`/app/monitoring/${session.id}`}
                        >
                          {photos > 0 ? "Продолжить" : "Загрузить фото"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
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

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const cls =
    normalized.includes("complete") || normalized.includes("ready")
      ? "badge badge-ok"
      : normalized.includes("fail") || normalized.includes("error")
        ? "badge badge-bad"
        : normalized.includes("process") || normalized.includes("progress")
          ? "badge badge-info"
          : "badge badge-neutral";
  const label =
    status === "draft"
      ? "Создана"
      : status === "processing"
        ? "В обработке"
        : status === "completed"
          ? "Готова"
          : status;
  return <span className={cls}>{label}</span>;
}
