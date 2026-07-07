"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { createSupabaseBrowserClient } from "../../lib/supabase/browser";

const FALLBACK_NEXT_PATH = "/app";

function getSafeNextPath(value: string | null): string {
  if (!value) {
    return FALLBACK_NEXT_PATH;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return FALLBACK_NEXT_PATH;
  }

  try {
    const url = new URL(trimmed, "https://pricevision.local");
    const isAllowedAppPath =
      url.pathname === "/app" || url.pathname.startsWith("/app/");

    if (url.origin !== "https://pricevision.local" || !isAllowedAppPath) {
      return FALLBACK_NEXT_PATH;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return FALLBACK_NEXT_PATH;
  }
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const next = getSafeNextPath(searchParams.get("next"));

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
    <form
      onSubmit={handleSubmit}
      className="grid"
      style={{ maxWidth: 420, marginTop: "1.25rem" }}
    >
      <label className="field">
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

      <label className="field">
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

      {error ? (
        <p role="alert" className="alert alert-bad">
          Не удалось войти: {error}
        </p>
      ) : null}

      <button disabled={isLoading} type="submit">
        {isLoading ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}
