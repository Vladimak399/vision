import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  Building2,
  LogOut,
  PackageSearch,
  UploadCloud,
} from "lucide-react";

import { getCurrentUser } from "../../server/auth";
import {
  type CompanyMembership,
  getCurrentUserCompanyMemberships,
} from "../../server/memberships";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

const workflowSteps = [
  "Импорт ассортимента",
  "Создание сессии",
  "Загрузка фото",
  "Review спорных товаров",
  "Экспорт Excel",
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

  const currentMembership = memberships[0];
  const hasMultipleCompanies = memberships.length > 1;
  const quickLinks = [
    {
      href: "/app/monitoring/new",
      title: "Создать мониторинг",
      text: "Новая сессия, загрузка фото полок и запуск распознавания.",
      icon: BarChart3,
      primary: true,
    },
    {
      href: "/app/catalog/import",
      title: "Импортировать каталог",
      text: "Загрузите CSV/XLSX с ассортиментом перед проверкой совпадений.",
      icon: UploadCloud,
    },
    {
      href: "/app/monitoring",
      title: "Открыть сессии",
      text: "Продолжите проверку, обработку фото или экспорт Excel.",
      icon: PackageSearch,
    },
  ];

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/app">
            PriceVision
          </Link>
          <nav className="nav" aria-label="Основные разделы">
            <Link href="/app/catalog">Каталог</Link>
            <Link href="/app/monitoring">Мониторинг</Link>
            <Link href="/app/stores">Магазины</Link>
            <Link href="/app/competitors">Конкуренты</Link>
            <Link href="/app/ai-diagnostics">AI</Link>
          </nav>
        </div>
      </header>
      <main className="page">
        <section className="hero-panel">
          <div className="hero" style={{ position: "relative", zIndex: 1 }}>
            <div>
              <p className="eyebrow">Рабочая область</p>
              <h1>Мониторинг цен по фото без лишних шагов</h1>
              <p className="lead">
                Вы вошли как {user.email ?? "пользователь без email"}. Начните с
                главного действия или перейдите в нужный раздел через верхнюю навигацию.
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
                <p className="lead">Роль в компании: {currentMembership.role}</p>
              </div>
              <span className="badge badge-ok">
                <Building2 size={14} />
                Доступ активен
              </span>
            </div>
            {hasMultipleCompanies ? (
              <p className="alert alert-warn" style={{ marginTop: "1rem" }}>
                У пользователя несколько компаний. Сейчас используется первая
                компания из списка доступов.
              </p>
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
                    {item.primary ? "Главный шаг" : "Быстро"}
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
              <h2>Типовой поток работы</h2>
              <p className="lead">
                Эти шаги помогают команде не теряться: от подготовки каталога до отчета с evidence.
              </p>
            </div>
          </div>
          <ol className="step-list" style={{ marginTop: "1rem" }}>
            {workflowSteps.map((step) => (
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
