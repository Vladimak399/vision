import Link from "next/link";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { getAiRuntimeConfig } from "../../../../server/ai-config";
import { getCurrentUser } from "../../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../../server/primary-membership";

export const dynamic = "force-dynamic";

const envNames = ["GEMINI_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "AI_TEXT_API_KEY"] as const;
const sectionStyle = { border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" };
const cellStyle = { borderBottom: "1px solid #e5e7eb", padding: "0.5rem", textAlign: "left" as const, verticalAlign: "top" as const };

type SessionRow = { id: string; created_at: string; status: string; store_id: string | null; competitor_id: string | null; stores: { name: string } | null; competitors: { name: string } | null };
type JobRow = { id: string; session_id: string | null; attempts: number | null; error: string | null; created_at: string; payload: { photo_id?: string } | null };
type CountRow = { session_id: string; status?: string };

export default async function MonitoringTestCenterPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app/monitoring/test-center");

  let membershipResult;
  try { membershipResult = await getPrimaryCompanyMembership(); } catch (error) { return <AccessError message={error instanceof Error ? error.message : "Не удалось проверить доступ к компании."} />; }
  if (membershipResult.status !== "ok") return <AccessError message="Нет доступа к компании. Попросите администратора добавить вас в company_members." />;
  if (!["admin", "manager"].includes(membershipResult.membership.role)) return <AccessError message="Центр тестирования доступен только ролям admin и manager." />;

  const companyId = membershipResult.membership.companyId;
  const supabase = await createSupabaseServerClient();
  const aiConfig = getAiRuntimeConfig();

  const checks = await Promise.all([
    countCheck("monitoring_sessions", supabase.from("monitoring_sessions").select("id", { count: "exact", head: true }).eq("company_id", companyId)),
    countCheck("monitoring_photos", supabase.from("monitoring_photos").select("id", { count: "exact", head: true }).eq("company_id", companyId)),
    countCheck("jobs photo_ocr", supabase.from("jobs").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("kind", "photo_ocr")),
    countCheck("recognized_items", supabase.from("recognized_items").select("id", { count: "exact", head: true }).eq("company_id", companyId)),
    countCheck("catalog_products active", supabase.from("catalog_products").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("is_active", true)),
    countCheck("matches", supabase.from("matches").select("id", { count: "exact", head: true }).eq("company_id", companyId)),
  ]);

  const { data: sessions } = await supabase
    .from("monitoring_sessions")
    .select("id, created_at, status, store_id, competitor_id, stores(name), competitors(name)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(5)
    .returns<SessionRow[]>();
  const sessionIds = (sessions ?? []).map((session) => session.id);
  const photoRows = await loadRows<CountRow>(supabase, "monitoring_photos", companyId, sessionIds);
  const jobRows = await loadRows<CountRow>(supabase, "jobs", companyId, sessionIds, "photo_ocr");
  const itemRows = await loadRows<CountRow>(supabase, "recognized_items", companyId, sessionIds);

  const { data: failedJobs } = await supabase
    .from("jobs")
    .select("id, session_id, attempts, error, created_at, payload")
    .eq("company_id", companyId)
    .eq("kind", "photo_ocr")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(10)
    .returns<JobRow[]>();

  const debugSummary = [
    `company_id: ${companyId}`,
    `company_name: ${membershipResult.membership.companyName}`,
    `role: ${membershipResult.membership.role}`,
    `ai_text: ${aiConfig.text.provider}/${aiConfig.text.model}`,
    `ai_vision: ${aiConfig.vision.provider}/${aiConfig.vision.model}`,
    `last_sessions: ${(sessions ?? []).length}`,
    `last_failed_ocr: ${failedJobs?.[0]?.error ? truncate(failedJobs[0].error, 180) : "—"}`,
  ].join("\n");

  return <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 1120, padding: "0 1rem" }}>
    <header style={{ display: "grid", gap: "0.5rem" }}><Link href="/app/monitoring">← Мониторинг</Link><h1 style={{ margin: 0 }}>Центр тестирования мониторинга</h1><p style={{ margin: 0 }}>Компания: {membershipResult.membership.companyName} ({companyId}), роль: {membershipResult.membership.role}</p></header>
    <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>AI и окружение</h2><dl><Row label="Vision" value={`${aiConfig.vision.provider} / ${aiConfig.vision.model}`} /><Row label="Text" value={`${aiConfig.text.provider} / ${aiConfig.text.model}`} /><Row label="Fallback" value={`${aiConfig.fallback.provider} / ${aiConfig.fallback.model}`} /></dl>{envNames.map((name) => <p key={name} style={{ margin: "0.25rem 0" }}>{name}: {process.env[name] ? "Да" : "Нет"}</p>)}<p><Link href="/app/ai-diagnostics">AI-диагностика</Link> · <Link href="/app/monitoring">Мониторинг</Link> · <Link href="/docs/monitoring-e2e-test-plan.md">docs/checklist</Link></p></section>
    <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>Read-only health checks</h2><p>Membership текущей компании читается: Да</p><p>Storage bucket <strong>monitoring-photos</strong> используется для загрузки фото. Проверка не выводит signed URLs и пути файлов.</p><table style={{ borderCollapse: "collapse", width: "100%" }}><tbody>{checks.map((check) => <tr key={check.name}><td style={cellStyle}>{check.name}</td><td style={cellStyle}>{check.ok ? "OK" : "Ошибка"}</td><td style={cellStyle}>{check.ok ? check.count : check.error}</td></tr>)}</tbody></table></section>
    <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>Последние 5 сессий</h2><table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={cellStyle}>Дата</th><th style={cellStyle}>Магазин/конкурент</th><th style={cellStyle}>Статус</th><th style={cellStyle}>Фото</th><th style={cellStyle}>OCR jobs</th><th style={cellStyle}>Items</th><th style={cellStyle}>Failed jobs/photos</th></tr></thead><tbody>{(sessions ?? []).map((session) => <tr key={session.id}><td style={cellStyle}><Link href={`/app/monitoring/${session.id}`}>{formatDateTime(session.created_at)}</Link></td><td style={cellStyle}>{session.stores?.name ?? "—"} / {session.competitors?.name ?? "—"}</td><td style={cellStyle}>{session.status}</td><td style={cellStyle}>{countBySession(photoRows, session.id)}</td><td style={cellStyle}>{countBySession(jobRows, session.id)}</td><td style={cellStyle}>{countBySession(itemRows, session.id)}</td><td style={cellStyle}>{countBySession(jobRows.filter((r) => r.status === "failed"), session.id)} / {countBySession(photoRows.filter((r) => r.status === "failed"), session.id)}</td></tr>)}</tbody></table></section>
    <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>Последние ошибки OCR</h2><table style={{ borderCollapse: "collapse", width: "100%" }}><thead><tr><th style={cellStyle}>Дата</th><th style={cellStyle}>session_id</th><th style={cellStyle}>photo_id</th><th style={cellStyle}>attempts</th><th style={cellStyle}>Ошибка</th></tr></thead><tbody>{(failedJobs ?? []).map((job) => <tr key={job.id}><td style={cellStyle}>{formatDateTime(job.created_at)}</td><td style={cellStyle}>{job.session_id ?? "—"}</td><td style={cellStyle}>{job.payload?.photo_id ?? "—"}</td><td style={cellStyle}>{job.attempts ?? 0}</td><td style={cellStyle}>{truncate(job.error ?? "—", 220)}</td></tr>)}</tbody></table></section>
    <section style={sectionStyle}><h2 style={{ marginTop: 0 }}>Чеклист</h2><ol><li>Откройте /app/ai-diagnostics и проверьте ключи.</li><li>Запустите text и vision smoke test на хорошем оригинальном фото.</li><li>Создайте или откройте сессию мониторинга.</li><li>Загрузите 1 фото, поставьте в OCR очередь и запустите «Тест: 1 фото».</li><li>Проверьте recognized_items, review, ручной match и XLSX exports.</li></ol><pre style={{ background: "#f3f4f6", padding: "0.75rem", overflowX: "auto" }}>{debugSummary}</pre></section>
  </main>;
}

async function countCheck(name: string, query: PromiseLike<{ count: number | null; error: { message: string } | null }>) { const { count, error } = await query; return error ? { name, ok: false, error: error.message } : { name, ok: true, count: count ?? 0 }; }
async function loadRows<T>(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, table: string, companyId: string, sessionIds: string[], kind?: string): Promise<T[]> { if (!sessionIds.length) return []; let query = supabase.from(table).select("session_id, status").eq("company_id", companyId).in("session_id", sessionIds); if (kind) query = query.eq("kind", kind); const { data } = await query.returns<T[]>(); return data ?? []; }
function countBySession(rows: CountRow[], sessionId: string) { return rows.filter((row) => row.session_id === sessionId).length; }
function Row({ label, value }: { label: string; value: string }) { return <div style={{ display: "grid", gridTemplateColumns: "140px 1fr" }}><dt>{label}</dt><dd style={{ margin: 0 }}>{value}</dd></div>; }
function AccessError({ message }: { message: string }) { return <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}><Link href="/app">← Рабочая область</Link><h1>Нет доступа к центру тестирования</h1><p>{message}</p></main>; }
function formatDateTime(value: string) { return new Date(value).toLocaleString("ru-RU"); }
function truncate(value: string, max: number) { return value.length > max ? `${value.slice(0, max)}…` : value; }
