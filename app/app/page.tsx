import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  BarChart3,
  Building2,
  LogOut,
  PackageSearch,
  Settings,
  UploadCloud,
} from "lucide-react";

import { getCurrentUser } from "../../server/auth";
import {
  type CompanyMembership,
  getCurrentUserCompanyMemberships,
} from "../../server/memberships";
import { ACTIVE_COMPANY_COOKIE, resolveActiveCompanyMembership } from "../../server/active-company";
import { logout, setActiveCompany } from "./actions";

export const dynamic = "force-dynamic";

const workerSteps = [
  "Открыть или создать сессию",
  "Загрузить фото магазина",
  "Распознать фото",
  "Проверить спорные товары",
  "Выгрузить Excel",
];

const adminSteps = [
  "Загрузить актуальный каталог",
  "Создать сессию мониторинга",
  "Проверить распознавание и спорные товары",
  "Выгрузить Excel",
  "При необходимости открыть диагностику",
];

export default async function AppPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app");

  let memberships: CompanyMembership[] = [];
  let membershipError: string | null = null;
  try {
    memberships = await getCurrentUserCompanyMemberships();
  } catch (error) {
    membershipError =
      error instanceof Error
        ? error.message
        : "Не удалось получить доступы к компаниям.";
  }

  const cookieStore = await cookies();
  const activeCompanyId = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value ?? null;
  const currentMembership =
    resolveActiveCompanyMembership(activeCompanyId, memberships) ?? memberships[0];
  const hasMultipleCompanies = memberships.length > 1;
  const canManageWorkspace = currentMembership
    ? ["admin", "manager"].includes(currentMembership.role)
    : false;
  const steps = canManageWorkspace ? adminSteps : workerSteps;
  const quickLinks = [
    {
      href: "/app/monitoring/new",
      title: "Создать мониторинг",
      text: "Новая сессия для магазина: фото, распознавание, проверка, Excel.",
      icon: BarChart3,
      primary: true,
      adminOnly: false,
    },
    {
      href: "/app/monitoring",
      title: "Открыть сессии",
      text: "Продолжить загрузку фото, проверку товаров или выгрузку Excel.",
      icon: PackageSearch,
      primary: false,
      adminOnly: false,
    },
    {
      href: "/app/catalog/import",
      title: "Импортировать каталог",
      text: "Загрузить CSV/XLSX с актуальным ассортиментом перед мониторингом.",
      icon: UploadCloud,
      primary: false,
      adminOnly: true,
    },
    {
      href: "/app/ai-diagnostics",
      title: "Диагностика",
      text: "Проверить AI/OCR и технические сценарии. Не нужно обычному сотруднику.",
      icon: Settings,
      primary: false,
      adminOnly: true,
    },
  ].filter((item) => canManageWorkspace || !item.adminOnly);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/app">
            PriceVision
          </Link>
          <nav className="nav" aria-label="Основные разделы">
            <Link href="/app/monitoring">Мониторинг</Link>
            {canManageWorkspace ? <Link href="/app/catalog">Каталог</Link> : null}
            {canManageWorkspace ? <Link href="/app/stores">Магазины</Link> : null}
            {canManageWorkspace ? <Link href="/app/competitors">Конкуренты</Link> : null}
            {canManageWorkspace ? <Link href="/app/ai-diagnostics">Диагностика</Link> : null}
          </nav>
        </div>
      </header>
      <main className="page">
        <section className="hero-panel">
          <div className="hero" style={{ position: "relative", zIndex: 1 }}>
            <div>
              <p className="eyebrow">Рабочая область</p>
              <h1>Мониторинг цен по фото</h1>
              <p className="lead">
                Вы вошли как {user.email ?? "пользователь без email"}. В основном
                рабочем сценарии нужны только сессии мониторинга: фото,
                распознавание, проверка и Excel.
              </p>
            </div>
            <form action={logout}>
              <button className="secondary" type="submit">
                <LogOut size={16} />
                Выйти
              </button>
            </form>
          </div>
        </section>

        {membershipError ? (
          <section className="alert alert-warn">
            <h2>Не удалось проверить доступ к компании</h2>
            <p>{membershipError}</p>
            <p>
              Попробуйте выйти и войти снова. Если проблема повторится,
              проверьте доступы компании.
            </p>
          </section>
        ) : currentMembership ? (
          <section className="card">
            <div className="hero">
              <div>
                <p className="eyebrow">Текущий контекст</p>
                <h2>{currentMembership.companyName}</h2>
                <p className="lead">
                  Роль: {getRoleLabel(currentMembership.role)}. {canManageWorkspace
                    ? "Вам доступны каталог, магазины и диагностика."
                    : "Вам доступен рабочий поток мониторинга без технических разделов."}
                </p>
              </div>
              <span className="badge badge-ok">
                <Building2 size={14} />
                Доступ активен
              </span>
            </div>
            {hasMultipleCompanies ? (
              <div className="alert alert-warn" style={{ marginTop: "1rem" }}>
                <p style={{ marginBottom: "0.5rem" }}>
                  У вас несколько компаний. Выберите активную — она будет
                  использоваться во всех разделах (каталог, мониторинг, магазины).
                </p>
                <form action={setActiveCompany} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    name="companyId"
                    defaultValue={currentMembership.companyId}
                    className="company-select"
                    aria-label="Активная компания"
                  >
                    {memberships.map((membership) => (
                      <option key={membership.companyId} value={membership.companyId}>
                        {membership.companyName} — {getRoleLabel(membership.role)}
                      </option>
                    ))}
                  </select>
                  <button className="secondary" type="submit">
                    Переключить
                  </button>
                </form>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="empty">
            <h2>Нет доступа к компании</h2>
            <p className="muted">
              Пользователь авторизован, но пока не добавлен в company_members.
              Попросите администратора выдать роль admin, manager или reviewer.
            </p>
          </section>
        )}

        <section className="grid grid-3" aria-label="Быстрые действия">
          {quickLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className="card">
                <div className="actions">
                  <span className={item.primary ? "badge badge-info" : "badge badge-neutral"}>
                    <Icon size={14} />
                    {item.primary ? "Главный шаг" : item.adminOnly ? "Админ" : "Быстро"}
                  </span>
                </div>
                <h2 style={{ marginTop: ".9rem" }}>{item.title}</h2>
                <p className="muted">{item.text}</p>
              </Link>
            );
          })}
        </section>

        <section className="card soft">
          <div className="hero">
            <div>
              <p className="eyebrow">Навигация по процессу</p>
              <h2>{canManageWorkspace ? "Процесс для менеджера" : "Процесс для сотрудника"}</h2>
              <p className="lead">
                Основной экран не должен показывать техническую механику. Для
                сотрудника остается только маршрут от фото к Excel.
              </p>
            </div>
          </div>
          <ol className="step-list" style={{ marginTop: "1rem" }}>
            {steps.map((step) => (
              <li key={step}>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}

function getRoleLabel(role: string) {
  if (role === "admin") return "администратор";
  if (role === "manager") return "менеджер";
  if (role === "reviewer") return "сотрудник мониторинга";
  return role;
}
