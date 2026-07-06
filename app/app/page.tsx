import { redirect } from "next/navigation";

import { getCurrentUser } from "../../server/auth";
import { logout } from "./actions";

export default async function AppPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-950">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">PriceVision</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">PriceVision dashboard</h1>
            <p className="mt-3 text-slate-600">Вы вошли как {user.email ?? "пользователь без email"}.</p>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-900 hover:text-slate-950"
            >
              Logout
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
