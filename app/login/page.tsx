import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="page page-narrow">
      <section className="card">
        <p className="eyebrow">PriceVision</p>
        <h1>Вход в рабочую область</h1>
        <p className="lead">
          Войдите под рабочим email. После входа откроется нужный раздел
          мониторинга или каталог.
        </p>
        <Suspense fallback={<p className="muted">Загружаем форму входа…</p>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
