/**
 * Cron endpoint for online monitoring — TASK-21.5
 *
 * Vercel Cron дергает этот endpoint по расписанию и создает queued runs.
 * Endpoint защищен секретным токеном (CRON_SECRET).
 *
 * Production: Vercel Cron → `vercel.json`
 * Dev/manual: можно вызвать напрямую с токеном
 */

import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "../../../../lib/supabase/service-role";

const CRON_SECRET = process.env.CRON_SECRET;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET endpoint для Vercel Cron.
 * Создает queued runs для всех включенных online_source_stores.
 */
export async function GET(request: Request) {
  // Проверка секрета
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!CRON_SECRET || token !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();

  try {
    // Получаем все включенные связи store → source
    const { data: sourceStores, error: fetchError } = await supabase
      .from("online_source_stores")
      .select(`
        id,
        company_id,
        source_id,
        store_id,
        source_store_id,
        source_city,
        online_sources!inner(
          id,
          source_key,
          display_name,
          enabled,
          legal_status
        )
      `)
      .eq("enabled", true)
      .eq("online_sources.enabled", true)
      .eq("online_sources.legal_status", "allowed"); // Только разрешенные источники

    if (fetchError) {
      console.error("Failed to fetch online source stores:", fetchError.message);
      return NextResponse.json(
        { error: "Database error", details: fetchError.message },
        { status: 500 }
      );
    }

    if (!sourceStores || sourceStores.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No enabled sources to process",
        runsCreated: 0,
      });
    }

    // Создаем runs для каждой связи
    const runsToCreate = sourceStores.map((ss) => ({
      company_id: ss.company_id,
      source_id: ss.source_id,
      source_store_id: ss.source_store_id,
      trigger: "cron" as const,
      status: "queued" as const,
      parser_version: "1.0.0",
      stats: {
        fetched: 0,
        productsUpserted: 0,
        pricesInserted: 0,
        matched: 0,
        unmatched: 0,
        errors: 0,
      },
    }));

    const { data: runs, error: insertError } = await supabase
      .from("online_source_runs")
      .insert(runsToCreate)
      .select("id, company_id, source_id");

    if (insertError) {
      console.error("Failed to create runs:", insertError.message);
      return NextResponse.json(
        { error: "Failed to create runs", details: insertError.message },
        { status: 500 }
      );
    }

    // Логируем создание runs
    const runLogs = runs.map((run) => ({
      company_id: run.company_id,
      run_id: run.id,
      level: "info",
      message: "Run created by cron",
      metadata: { source_id: run.source_id },
    }));

    await supabase.from("online_source_run_events").insert(runLogs);

    return NextResponse.json({
      success: true,
      message: "Runs created successfully",
      runsCreated: runs.length,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Cron endpoint error:", errorMessage);
    return NextResponse.json(
      { error: "Internal error", details: errorMessage },
      { status: 500 }
    );
  }
}