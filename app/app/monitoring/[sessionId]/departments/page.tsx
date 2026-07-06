import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentUser } from "../../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../../server/primary-membership";

type PageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

type PhotoRow = {
  department: string | null;
  status: string;
};

type ItemRow = {
  department: string | null;
  status: string;
};

type SessionRow = {
  id: string;
  status: string;
  stores: {
    name: string;
    address: string | null;
  } | null;
};

const departments = [
  { key: "products", label: "Продукты" },
  { key: "chemistry", label: "Химия" },
  { key: "none", label: "Без отдела" },
] as const;

export default async function DepartmentProgressPage({ params }: PageProps) {
  const { sessionId } = await params;
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/app/monitoring/${encodeURIComponent(sessionId)}/departments`);
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return <PageError sessionId={sessionId} message={error instanceof Error ? error.message : "Не удалось проверить доступ."} />;
  }

  if (membershipResult.status !== "ok") {
    return <PageError sessionId={sessionId} message="Нет доступа к компании." />;
  }

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const { data: session, error: sessionError } = await supabase
    .from("monitoring_sessions")
    .select("id, status, stores(name, address)")
    .eq("company_id", companyId)
    .eq("id", sessionId)
    .maybeSingle()
    .returns<SessionRow | null>();

  if (sessionError) {
    return <PageError sessionId={sessionId} message={`Не удалось загрузить сессию: ${sessionError.message}`} />;
  }

  if (!session) {
    return <PageError sessionId={sessionId} message="Сессия не найдена." />;
  }

  const { data: photos, error: photosError } = await supabase
    .from("monitoring_photos")
    .select("department, status")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .returns<PhotoRow[]>();

  const { data: items, error: itemsError } = await supabase
    .from("recognized_items")
    .select("department, status")
    .eq("company_id", companyId)
    .eq("session_id", sessionId)
    .returns<ItemRow[]>();

  if (photosError) {
    return <PageError sessionId={sessionId} message={`Не удалось загрузить фото: ${photosError.message}`} />;
  }

  if (itemsError) {
    return <PageError sessionId={sessionId} message={`Не удалось загрузить товары: ${itemsError.message}`} />;
  }

  const photoSummary = summarizeRows(photos ?? []);
  const itemSummary = summarizeRows(items ?? []);

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href={`/app/monitoring/${sessionId}`}>← Сессия</Link>
        <h1 style={{ margin: 0 }}>Прогресс по отделам</h1>
        <p style={{ color: "#4b5563", margin: 0 }}>
          {session.stores?.name ?? "Магазин"} · {session.stores?.address ?? "адрес не указан"} · статус: {session.status}
        </p>
      </header>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Фото</h2>
        <SummaryTable rows={photoSummary} />
      </section>

      <section style={{ border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>Распознанные товары</h2>
        <SummaryTable rows={itemSummary} />
      </section>
    </main>
  );
}

function SummaryTable({ rows }: { rows: Array<{ department: string; statusCounts: Record<string, number>; total: number }> }) {
  const statuses = Array.from(new Set(rows.flatMap((row) => Object.keys(row.statusCounts)))).sort();

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", minWidth: 520, width: "100%" }}>
        <thead>
          <tr>
            <th style={cellStyle}>Отдел</th>
            <th style={cellStyle}>Всего</th>
            {statuses.map((status) => (
              <th key={status} style={cellStyle}>{status}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.department}>
              <td style={cellStyle}>{getDepartmentLabel(row.department)}</td>
              <td style={cellStyle}>{row.total}</td>
              {statuses.map((status) => (
                <td key={status} style={cellStyle}>{row.statusCounts[status] ?? 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function summarizeRows(rows: Array<{ department: string | null; status: string }>) {
  return departments.map((department) => {
    const statusCounts: Record<string, number> = {};
    let total = 0;

    for (const row of rows) {
      if (normalizeDepartment(row.department) !== department.key) {
        continue;
      }

      total += 1;
      statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    }

    return { department: department.key, statusCounts, total };
  });
}

function normalizeDepartment(value: string | null) {
  return value === "products" || value === "chemistry" ? value : "none";
}

function getDepartmentLabel(value: string) {
  return departments.find((department) => department.key === value)?.label ?? value;
}

function PageError({ sessionId, message }: { sessionId: string; message: string }) {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href={`/app/monitoring/${sessionId}`}>← Сессия</Link>
      <h1>Прогресс недоступен</h1>
      <p>{message}</p>
    </main>
  );
}

const cellStyle = {
  borderBottom: "1px solid #e5e7eb",
  padding: "0.5rem",
  textAlign: "left" as const,
};
