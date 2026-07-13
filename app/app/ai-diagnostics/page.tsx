import Link from "next/link";
import { redirect } from "next/navigation";

import { getAiRuntimeConfig } from "../../../server/ai-config";
import { getCurrentUser } from "../../../server/auth";
import { getPrimaryCompanyMembership } from "../../../server/primary-membership";
import { TextSmokeForm, VisionSmokeForm } from "./diagnostics-forms";

export const dynamic = "force-dynamic";

const envNames = ["GEMINI_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "AI_TEXT_API_KEY"] as const;

export default async function AiDiagnosticsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app/ai-diagnostics");
  }

  let membershipResult;
  try {
    membershipResult = await getPrimaryCompanyMembership();
  } catch (error) {
    return <AccessError message={error instanceof Error ? error.message : "Не удалось проверить доступ к компании."} />;
  }

  if (membershipResult.status !== "ok") {
    return <AccessError message="Нет доступа к компании. Попросите администратора добавить вас в company_members." />;
  }

  if (membershipResult.membership.role !== "admin" && membershipResult.membership.role !== "manager") {
    return <AccessError message="AI-диагностика доступна только пользователям с ролью admin или manager." />;
  }

  const aiConfig = getAiRuntimeConfig();
  const envPresence = envNames.map((name) => ({ name, exists: Boolean(process.env[name]) }));

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <header style={{ display: "grid", gap: "0.5rem" }}>
        <Link href="/app">← Рабочая область</Link>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>AI-диагностика</h1>
          <p style={{ margin: 0 }}>Компания: {membershipResult.membership.companyName}</p>
        </div>
      </header>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Runtime config</h2>
        <dl style={{ display: "grid", gap: "0.5rem", margin: 0 }}>
          <ConfigRow label="Vision provider" value={aiConfig.vision.provider} />
          <ConfigRow label="Vision model" value={aiConfig.vision.model} />
          <ConfigRow label="Text provider" value={aiConfig.text.provider} />
          <ConfigRow label="Text model" value={aiConfig.text.model} />
          <ConfigRow label="Fallback provider" value={aiConfig.fallback.provider} />
          <ConfigRow label="Fallback model" value={aiConfig.fallback.model} />
          <ConfigRow label="Vision rescue provider" value={aiConfig.visionRescue.provider} />
          <ConfigRow label="Vision rescue model" value={aiConfig.visionRescue.model} />
          <ConfigRow label="Run budget" value={`$${aiConfig.runBudgetUsd}`} />
        </dl>
        <h3>Переменные окружения</h3>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {envPresence.map((env) => (
              <tr key={env.name}>
                <td style={cellStyle}>{env.name}</td>
                <td style={cellStyle}>{env.exists ? "Да" : "Нет"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Text AI smoke test</h2>
        <TextSmokeForm />
      </section>

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Vision AI smoke test</h2>
        <p style={{ fontWeight: 700 }}>Тест без сохранения в базу</p>
        <VisionSmokeForm />
        <h3>Чеклист качества фото</h3>
        <ul>
          <li>оригинальное фото, не скриншот;</li>
          <li>ценники читаются глазами;</li>
          <li>товар и ценник в одном кадре;</li>
          <li>без сильных бликов;</li>
          <li>лучше 1–2 полки, не весь стеллаж издалека;</li>
          <li>не использовать фото, сжатые мессенджерами.</li>
        </ul>
        <p style={{ color: "#6b7280", marginBottom: 0 }}>
          Проверка отправляет изображение напрямую провайдеру и не создает jobs, monitoring_photos или recognized_items.
        </p>
      </section>
    </main>
  );
}

function ConfigRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "1rem" }}>
      <dt style={{ color: "#6b7280" }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value}</dd>
    </div>
  );
}

function AccessError({ message }: { message: string }) {
  return (
    <main style={{ margin: "3rem auto", maxWidth: 720, padding: "0 1rem" }}>
      <Link href="/app">← Рабочая область</Link>
      <h1>Нет доступа к AI-диагностике</h1>
      <p>{message}</p>
    </main>
  );
}

const sectionStyle = { border: "1px solid #d1d5db", borderRadius: 12, padding: "1rem" };
const cellStyle = { borderBottom: "1px solid #e5e7eb", padding: "0.5rem", textAlign: "left" as const };
