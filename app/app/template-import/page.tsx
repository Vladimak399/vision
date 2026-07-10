import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "../../../server/auth";
import { TemplateImportForm } from "./import-form";

export const dynamic = "force-dynamic";

export default async function TemplateImportPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(`/login?next=/app/template-import`);
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">
            <Link href="/app">← Рабочая область</Link>
          </p>
          <h1>Импорт шаблона мониторинга</h1>
          <p className="lead">
            Залейте файл Excel от Яны. Каталог товаров, магазины и связи колонок
            обновятся автоматически. Каталог общий для обеих недель — заливать можно
            в любом порядке.
          </p>
        </div>
      </header>

      <TemplateImportForm />
    </main>
  );
}
