import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../server/auth";
import {
  type CompanyMembership,
  getCurrentUserCompanyMemberships,
} from "../../server/memberships";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app");
  }

  let memberships: CompanyMembership[] = [];
  let membershipError: string | null = null;

  try {
    memberships = await getCurrentUserCompanyMemberships();
  } catch (error) {
    membershipError = error instanceof Error ? error.message : "Не удалось получить доступы к компаниям.";
  }

  const primaryMembership = memberships[0];

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <div>
        <p style={{ margin: 0, textTransform: "uppercase" }}>PriceVision</p>
        <h1>Рабочая область</h1>
        <p>Вы вошли как {user.email ?? "пользователь без email"}.</p>
        <nav aria-label="Разделы справочников" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1rem" }}>
          <Link href="/app/stores">Магазины</Link>
          <Link href="/app/competitors">Конкуренты</Link>
          <Link href="/app/catalog">Каталог</Link>
          <Link href="/app/monitoring">Мониторинг</Link>
        </nav>
      </div>

      {membershipError ? (
        <section
          aria-live="polite"
          style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: "1rem", background: "#fffbeb" }}
        >
          <h2 style={{ marginTop: 0 }}>Не удалось проверить доступ к компании</h2>
          <p>{membershipError}</p>
          <p style={{ marginBottom: 0 }}>
            Попробуйте выйти и войти снова. Если проблема повторится, проверьте RLS-политики для company_members и
            companies.
          </p>
        </section>
      ) : primaryMembership ? (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Доступ к компании</h2>
          <dl style={{ display: "grid", gap: "0.75rem", margin: 0 }}>
            <div>
              <dt style={{ color: "#6b7280" }}>Email</dt>
              <dd style={{ margin: 0 }}>{user.email ?? "Не указан"}</dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280" }}>Компания</dt>
              <dd style={{ margin: 0 }}>{primaryMembership.companyName}</dd>
            </div>
            <div>
              <dt style={{ color: "#6b7280" }}>Роль</dt>
              <dd style={{ margin: 0 }}>{primaryMembership.role}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem", background: "#f9fafb" }}>
          <h2 style={{ marginTop: 0 }}>Нет доступа к компании</h2>
          <p style={{ marginBottom: 0 }}>
            Ваш пользователь авторизован, но пока не добавлен в company_members. Попросите администратора компании
            выдать доступ и назначить роль: admin, manager или reviewer.
          </p>
        </section>
      )}

      <form action={logout}>
        <button type="submit">Выйти</button>
      </form>
    </main>
  );
}
