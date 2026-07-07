import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="page page-narrow">
      <section className="hero-panel">
        <p className="eyebrow">PriceVision</p>
        <h1>Вход в рабочую область</h1>
        <p className="lead">
          Авторизуйтесь рабочим email, чтобы перейти к мониторингу, каталогу и отчетам.
          После входа мы вернем вас в нужный раздел приложения.
        </p>
        <div className="card" style={{ marginTop: "1.25rem", position: "relative", zIndex: 1 }}>
          <Suspense fallback={<p className="muted">Загружаем форму входа…</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
