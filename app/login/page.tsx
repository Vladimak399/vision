import { Suspense } from "react";

import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">PriceVision</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Вход</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Войдите через email и пароль Supabase Auth, чтобы открыть закрытый раздел приложения.
        </p>
        <Suspense fallback={<p className="mt-8 text-sm text-slate-600">Загружаем форму входа...</p>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
