"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const next = searchParams.get("next") || "/app";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      setError("Введите email и пароль.");
      return;
    }

    setIsLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    setIsLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: "1rem", maxWidth: 420 }}>
      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span>Email</span>
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </label>

      <label style={{ display: "grid", gap: "0.35rem" }}>
        <span>Пароль</span>
        <input
          autoComplete="current-password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {error ? <p role="alert" style={{ color: "crimson" }}>{error}</p> : null}

      <button disabled={isLoading} type="submit">
        {isLoading ? "Входим..." : "Войти"}
      </button>
    </form>
  );
}
