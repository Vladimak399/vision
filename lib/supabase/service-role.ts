import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "../env";

export function createSupabaseServiceRoleClient() {
  const env = getPublicEnv();

  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}