import { createSupabaseEvidenceClientFromEnv } from "../server/price-capture/supabase-evidence-client-factory";
import {
  buildSupabaseEvidenceWriteReadinessReport,
  checkLiveSupabaseEvidenceSchema,
  type SupabaseLiveReadinessClient,
} from "../server/price-capture/supabase-live-readiness";

async function main() {
  const factory = createSupabaseEvidenceClientFromEnv({ useServiceRole: true });

  if (!factory.ok) {
    console.log(JSON.stringify({
      ok: false,
      phase: "client_factory",
      error: factory.error,
      diagnostics: factory.diagnostics,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const schema = await checkLiveSupabaseEvidenceSchema(factory.client as unknown as SupabaseLiveReadinessClient);
  const readiness = buildSupabaseEvidenceWriteReadinessReport({ schema, env: process.env });

  console.log(JSON.stringify({
    ok: readiness.schema.status === "ready",
    phase: "evidence_readiness",
    project: factory.diagnostics.projectRef,
    schema: readiness.schema,
    guard: readiness.guard,
    canAttemptControlledTestInsert: readiness.canAttemptControlledTestInsert,
    blockers: readiness.blockers,
  }, null, 2));

  process.exitCode = readiness.schema.status === "ready" ? 0 : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    phase: "unhandled_error",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
