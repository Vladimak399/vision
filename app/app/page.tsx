import { redirect } from "next/navigation";

import { getCurrentUser } from "../../server/auth";
import { logout } from "./actions";

export default async function AppPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?next=/app");
  }

  return (
    <main style={{ display: "grid", gap: "1rem", margin: "3rem auto", maxWidth: 960, padding: "0 1rem" }}>
      <div>
        <p style={{ margin: 0, textTransform: "uppercase" }}>PriceVision</p>
        <h1>PriceVision dashboard</h1>
        <p>Вы вошли как {user.email ?? "пользователь без email"}.</p>
      </div>

      <form action={logout}>
        <button type="submit">Выйти</button>
      </form>
    </main>
  );
}
