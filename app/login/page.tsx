import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main style={{ display: "grid", gap: "1rem", margin: "4rem auto", maxWidth: 480, padding: "0 1rem" }}>
      <div>
        <p style={{ margin: 0, textTransform: "uppercase" }}>PriceVision</p>
        <h1>Вход</h1>
        <p>Используй email/password пользователя из Supabase Auth.</p>
      </div>

      <Suspense fallback={<p>Загружаем форму входа...</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
