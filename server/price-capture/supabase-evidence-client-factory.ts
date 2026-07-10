import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { SupabaseEvidenceClient } from "./supabase-evidence-repository";

export const SUPABASE_PROJECT_REF = "ncefnrodgzhwwxzogbur" as const;
export const SUPABASE_PROJECT_URL = "https://ncefnrodgzhwwxzogbur.supabase.co" as const;
export const SUPABASE_EVIDENCE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL" as const;
export const SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" as const;
export const SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV = "SUPABASE_SERVICE_ROLE_KEY" as const;

export type SupabaseEvidenceClientFactoryEnv = Record<string, string | undefined>;

export type SupabaseEvidenceClientFactoryOptions = {
  env?: SupabaseEvidenceClientFactoryEnv;
  useServiceRole?: boolean;
};

export type SupabaseEvidenceClientFactoryResult =
  | {
      ok: true;
      client: SupabaseEvidenceClient;
      diagnostics: SupabaseEvidenceClientFactoryDiagnostics;
    }
  | {
      ok: false;
      error: SupabaseEvidenceClientFactoryError;
      diagnostics: SupabaseEvidenceClientFactoryDiagnostics;
    };

export type SupabaseEvidenceClientFactoryDiagnostics = {
  projectRef: typeof SUPABASE_PROJECT_REF;
  expectedUrl: typeof SUPABASE_PROJECT_URL;
  urlEnv: typeof SUPABASE_EVIDENCE_URL_ENV;
  publishableKeyEnv: typeof SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV;
  serviceRoleKeyEnv: typeof SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV;
  useServiceRole: boolean;
  hasUrl: boolean;
  hasPublishableKey: boolean;
  hasServiceRoleKey: boolean;
};

export type SupabaseEvidenceClientFactoryError = {
  code:
    | "missing_supabase_url"
    | "missing_publishable_key"
    | "missing_service_role_key"
    | "invalid_supabase_url"
    | "wrong_project_url";
  message: string;
};

export function createSupabaseEvidenceClientFromEnv(
  options: SupabaseEvidenceClientFactoryOptions = {},
): SupabaseEvidenceClientFactoryResult {
  const env = options.env ?? process.env;
  const useServiceRole = options.useServiceRole === true;
  const url = trimToNull(env[SUPABASE_EVIDENCE_URL_ENV]);
  const publishableKey = trimToNull(env[SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV]);
  const serviceRoleKey = trimToNull(env[SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV]);
  const diagnostics = buildDiagnostics({ env, useServiceRole });

  if (!url) return failure("missing_supabase_url", `${SUPABASE_EVIDENCE_URL_ENV} is required.`, diagnostics);
  if (!isValidUrl(url)) return failure("invalid_supabase_url", `${SUPABASE_EVIDENCE_URL_ENV} must be a valid HTTPS URL.`, diagnostics);
  if (normalizeUrl(url) !== normalizeUrl(SUPABASE_PROJECT_URL)) {
    return failure("wrong_project_url", `${SUPABASE_EVIDENCE_URL_ENV} must point to the configured PriceVision Supabase project.`, diagnostics);
  }
  if (useServiceRole && !serviceRoleKey) {
    return failure("missing_service_role_key", `${SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV} is required for service-role evidence writes.`, diagnostics);
  }
  if (!useServiceRole && !publishableKey) {
    return failure("missing_publishable_key", `${SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV} is required for browser/authenticated clients.`, diagnostics);
  }

  const key = useServiceRole ? serviceRoleKey : publishableKey;
  const client = createClient(url, key, {
    auth: {
      persistSession: !useServiceRole,
      autoRefreshToken: !useServiceRole,
    },
  });

  return { ok: true, client: adaptSupabaseClient(client), diagnostics };
}

export function adaptSupabaseClient(client: Pick<SupabaseClient, "from">): SupabaseEvidenceClient {
  return { from: (table: string) => client.from(table) } as SupabaseEvidenceClient;
}

export function buildSupabaseEvidenceClientEnvChecklist(): string[] {
  return [
    `${SUPABASE_EVIDENCE_URL_ENV}=${SUPABASE_PROJECT_URL}`,
    `${SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV}=<paste sb_publishable_... key from Supabase project API settings>`,
    `${SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV}=<paste service_role key only on server/runtime that performs writes>`,
    "PRICEVISION_EVIDENCE_PERSISTENCE_MODE=dry_run",
    "PRICEVISION_EVIDENCE_PERSISTENCE_WRITE_CONFIRM=<leave unset until explicit production write approval>",
  ];
}

function buildDiagnostics(input: { env: SupabaseEvidenceClientFactoryEnv; useServiceRole: boolean }): SupabaseEvidenceClientFactoryDiagnostics {
  return {
    projectRef: SUPABASE_PROJECT_REF,
    expectedUrl: SUPABASE_PROJECT_URL,
    urlEnv: SUPABASE_EVIDENCE_URL_ENV,
    publishableKeyEnv: SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV,
    serviceRoleKeyEnv: SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV,
    useServiceRole: input.useServiceRole,
    hasUrl: Boolean(trimToNull(input.env[SUPABASE_EVIDENCE_URL_ENV])),
    hasPublishableKey: Boolean(trimToNull(input.env[SUPABASE_EVIDENCE_PUBLISHABLE_KEY_ENV])),
    hasServiceRoleKey: Boolean(trimToNull(input.env[SUPABASE_EVIDENCE_SERVICE_ROLE_KEY_ENV])),
  };
}

function failure(code: SupabaseEvidenceClientFactoryError["code"], message: string, diagnostics: SupabaseEvidenceClientFactoryDiagnostics): SupabaseEvidenceClientFactoryResult {
  return { ok: false, error: { code, message }, diagnostics };
}

function trimToNull(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
