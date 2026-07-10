/**
 * Online Monitoring Worker — TASK-21.5
 *
 * Worker обрабатывает queued runs для онлайн-источников.
 * Запускается отдельно (не в рамках HTTP request/response).
 *
 * Использование:
 * - `npm run worker:online` — продакшн режим (бесконечный цикл)
 * - `npx tsx server/worker/online-monitoring-worker.ts` — разовое выполнение
 *
 * Worker использует service-role для обхода RLS.
 */

import { createSupabaseServiceRoleClient } from "../../lib/supabase/service-role";
import { registerAdapter, getAdapter } from "../online-monitoring/registry";
// TASK-31: worker должен использовать service-role boundary, а не
// server/online-monitoring/run.ts (оттуда тянется createSupabaseServerClient +
// cookies() из next/headers, что падает вне HTTP-контекста).
import { claimRun } from "../online-monitoring/claim-run";
import {
  getRunForWorker as getRun,
  recoverStaleRuns,
} from "../online-monitoring/run-service-role";
import type { OnlineProductObservation } from "../online-monitoring/types";
import { normalizePriceToMinor, normalizeBarcode, normalizeSizeText } from "../online-monitoring/normalize";
import { matchOnlineProductsBatch } from "../online-monitoring/matching";
import {
  generateRunAlerts,
  generatePriceChangeAlerts,
  generateOutOfStockAlert,
} from "../online-monitoring/alerts";

// Регистрация доступных адаптеров
// В MVP: SPAR adapter (другие будут добавлены TASK-21.9)
import sparOnlineAdapter from "../online-monitoring/adapters/spar-online";
import metroOnlineAdapter from "../online-monitoring/adapters/metro-online";
import magnitAdapter from "../online-monitoring/adapters/magnit";
import x55kaAdapter from "../online-monitoring/adapters/x5-5ka";
registerAdapter(sparOnlineAdapter, true);
registerAdapter(metroOnlineAdapter, true);
registerAdapter(magnitAdapter, true);
registerAdapter(x55kaAdapter, true);

/**
 * Worker configuration
 */
const POLL_INTERVAL_MS = 5000; // 5 seconds between queued runs
const MAX_CONCURRENT_RUNS = 1; // Sequential processing

/**
 * TASK-32: graceful shutdown состояние.
 * `isShuttingDown` прерывает цикл опроса; `activeRun` позволяет дождаться
 * завершения уже запущенного run-а перед выходом.
 */
let isShuttingDown = false;
let activeRun: Promise<void> | null = null;

function requestShutdown(signal: string): void {
  if (isShuttingDown) return;
  console.log(`Worker received ${signal}: initiating graceful shutdown...`);
  isShuttingDown = true;
}

/**
 * Process a single online source run
 */
async function processRun(runId: string): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();

  // Claim the run (atomic: queued -> running)
  const claimed = await claimRun(runId);
  if (!claimed) {
    console.log(`Run ${runId} already claimed or not found`);
    return;
  }

  console.log(`Processing run ${runId}`);

  // Get run details
  const run = await getRun(runId);
  if (!run) {
    console.error(`Run ${runId} not found after claim`);
    return;
  }

  try {
  // Get source details
  const { data: source, error: sourceError } = await supabase
    .from("online_sources")
    .select("id, source_key, display_name, enabled, legal_status")
    .eq("id", run.sourceId)
    .single();

  if (sourceError || !source) {
    console.error(`Source error for run ${runId}:`, sourceError?.message);
    await supabase
      .from("online_source_runs")
      .update({ status: "failed", error_summary: "Source not found" })
      .eq("id", runId);
    return;
  }

  // Check legal status
  if (source.legal_status !== "allowed") {
    console.log(
      `Skipping run ${runId}: source legal_status = ${source.legal_status}`
    );
    await supabase
      .from("online_source_runs")
      .update({
        status: "cancelled",
        error_summary: `Source legal_status = ${source.legal_status}`,
      })
      .eq("id", runId);
    return;
  }

  // TASK-32: идемпотентный retry. Если этот run уже исполнялся (например,
  // завис в `running` и был возвращён в очередь через recoverStaleRuns), в
  // online_prices могли остаться старые строки за этим run_id. Удаляем их
  // до повторной вставки, чтобы retry не создавал дубликатов цен.
  await supabase.from("online_prices").delete().eq("run_id", runId);

  // Get adapter
  const adapter = getAdapter(source.source_key as "spar_online" | "metro_online" | "magnit" | "x5_5ka");
  if (!adapter) {
    console.error(`No adapter registered for key: ${source.source_key}`);
    await supabase
      .from("online_source_runs")
      .update({
        status: "failed",
        error_summary: `No adapter for ${source.source_key}`,
      })
      .eq("id", runId);
    return;
  }

  // Process the catalog
  const stats = {
    fetched: 0,
    productsUpserted: 0,
    pricesInserted: 0,
    matched: 0,
    unmatched: 0,
    errors: 0,
  };

  try {
    // Get store binding for this run
    const { data: sourceStore } = await supabase
      .from("online_source_stores")
      .select("store_id, source_store_id, source_city")
      .eq("source_id", source.id)
      .eq("source_store_id", run.sourceStoreId)
      .single();

    // Fetch products from adapter
    const observations: OnlineProductObservation[] = [];
    for await (const product of adapter.fetchCatalog({
      companyId: run.companyId,
      storeId: sourceStore?.store_id ?? "",
      sourceStoreId: run.sourceStoreId,
      sourceCity: sourceStore?.source_city ?? null,
      limit: 1000, // Configurable limit
    })) {
      observations.push(product);
      stats.fetched++;
    }

    console.log(`Fetched ${stats.fetched} products from ${source.display_name}`);

    // Upsert products (without prices - will be done after matching)
    const upsertedProducts: Array<{
      obs: OnlineProductObservation;
      dbId: string;
    }> = [];

    for (const obs of observations) {
      try {
        // Upsert online source product
        const { data: product, error: upsertError } = await supabase
          .from("online_source_products")
          .upsert(
            {
              company_id: run.companyId,
              source_id: source.id,
              source_product_id: obs.sourceProductId,
              url: obs.url,
              raw_name: obs.title,
              normalized_name: normalizeProductTitle(obs.title),
              brand: obs.brand,
              size_text: obs.sizeText,
              barcode: obs.barcode,
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: "company_id,source_id,source_product_id" }
          )
          .select("id")
          .single();

        if (upsertError || !product) {
          stats.errors++;
          continue;
        }

        upsertedProducts.push({ obs, dbId: product.id });
        stats.productsUpserted++;
      } catch (err) {
        stats.errors++;
        console.error("Error upserting product:", err);
      }
    }

    // Matching online products with catalog
    const matchingInput = upsertedProducts.map(({ obs }) => ({
      sourceProductId: obs.sourceProductId,
      rawName: obs.title,
      barcode: obs.barcode,
      brand: obs.brand,
      sizeText: obs.sizeText,
    }));

    let matchResults: Awaited<ReturnType<typeof matchOnlineProductsBatch>> = [];

    if (matchingInput.length > 0) {
      matchResults = await matchOnlineProductsBatch(run.companyId, matchingInput);

      // Get fresh matches to get catalog_product_id for prices
      const { data: matches } = await supabase
        .from("online_product_matches")
        .select("source_product_id, catalog_product_id, confidence")
        .in("source_product_id", matchingInput.map((m) => m.sourceProductId));

      const matchBySourceId = new Map(
        (matches ?? []).map((m) => [m.source_product_id, m])
      );

      // Insert price observations with catalog_product_id
      for (const { obs, dbId } of upsertedProducts) {
        const match = matchBySourceId.get(obs.sourceProductId);
        const matchResult = matchResults.find(
          (r) => r.sourceProductId === obs.sourceProductId
        );

        if (matchResult?.status === "needs_review") {
          stats.unmatched++;
        } else if (matchResult?.catalogProductId) {
          stats.matched++;
        }

        // Fetch previous price for this product to detect changes / disappearance.
        const { data: prevPrice } = await supabase
          .from("online_prices")
          .select("price_minor, availability")
          .eq("company_id", run.companyId)
          .eq("source_product_id", dbId)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { error: priceError } = await supabase
          .from("online_prices")
          .insert({
            company_id: run.companyId,
            run_id: runId,
            source_id: source.id,
            source_store_id: run.sourceStoreId,
            store_id: sourceStore?.store_id,
            source_product_id: dbId,
            catalog_product_id: match?.catalog_product_id ?? matchResult?.catalogProductId ?? null,
            price_minor: obs.priceMinor,
            old_price_minor: obs.oldPriceMinor,
            promo_price_minor: obs.promoPriceMinor,
            currency: "RUB",
            availability: obs.availability,
            observed_at: obs.observedAt.toISOString(),
            source_url: obs.url,
            raw_payload_hash: obs.rawPayloadHash,
          });

        if (!priceError) {
          stats.pricesInserted++;

          // Generate alerts after price insert (TASK-27).
          try {
            const previousPriceMinor =
              prevPrice && prevPrice.price_minor != null
                ? Number(prevPrice.price_minor)
                : null;
            const previousAvailability = prevPrice?.availability ?? null;

            if (previousPriceMinor !== null) {
              await generatePriceChangeAlerts(
                run.companyId,
                source.id,
                obs.sourceProductId,
                sourceStore?.store_id ?? "",
                Number(obs.priceMinor),
                previousPriceMinor,
                supabase
              );
            }

            if (
              obs.availability === "out_of_stock" &&
              previousAvailability &&
              previousAvailability !== "out_of_stock"
            ) {
              await generateOutOfStockAlert(
                run.companyId,
                source.id,
                obs.sourceProductId,
                obs.title,
                supabase
              );
            }
          } catch (alertErr) {
            console.error(
              `Failed to generate price alerts for ${obs.sourceProductId}:`,
              alertErr
            );
          }
        }
      }
    }

    // Update run with final stats
    await supabase
      .from("online_source_runs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        stats,
      })
      .eq("id", runId);

    console.log(
      `Run ${runId} completed: ${stats.productsUpserted} products, ${stats.matched} matched, ${stats.pricesInserted} prices`
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`Run ${runId} failed:`, errorMessage);

    await supabase
      .from("online_source_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_summary: errorMessage,
        stats,
      })
      .eq("id", runId);
  }
} finally {
    // Generate alerts after the run status is finalized (success or failure).
    try {
      await generateRunAlerts(
        { companyId: run.companyId, sourceId: run.sourceId, runId },
        supabase
      );
    } catch (alertErr) {
      console.error(`Failed to generate run alerts for ${runId}:`, alertErr);
    }
  }
}

/**
 * Get queued runs from database
 */
async function getQueuedRuns(): Promise<Array<{ id: string }>> {
  const supabase = createSupabaseServiceRoleClient();

  const { data: runs, error } = await supabase
    .from("online_source_runs")
    .select("id, source_id, status")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(MAX_CONCURRENT_RUNS);

  if (error) {
    console.error("Failed to fetch queued runs:", error.message);
    return [];
  }

  return runs ?? [];
}

/**
 * Main worker loop (TASK-32: signal-aware, graceful shutdown)
 */
async function runWorker(): Promise<void> {
  console.log("Online Monitoring Worker started");

  // TASK-32: восстановить зависшие `running` run-ы при старте, чтобы они не
  // висели вечно после падения предыдущего инстанса worker-а.
  try {
    const { requeued, failed } = await recoverStaleRuns();
    if (requeued > 0 || failed > 0) {
      console.log(
        `Recovered stale runs on startup: requeued=${requeued}, failed=${failed}`
      );
    }
  } catch (err) {
    console.error("Startup stale-run recovery failed:", err);
  }

  while (!isShuttingDown) {
    try {
      const queuedRuns = await getQueuedRuns();

      if (queuedRuns.length === 0) {
        // No work, wait before next poll
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      // Process runs sequentially
      for (const run of queuedRuns) {
        if (isShuttingDown) break;

        activeRun = processRun(run.id);
        try {
          await activeRun;
        } finally {
          activeRun = null;
        }
      }
    } catch (error) {
      console.error("Worker error:", error);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Дождаться завершения в полёте run-а, затем выйти чисто.
  if (activeRun) {
    console.log("Worker shutting down: waiting for in-flight run to finish...");
    try {
      await activeRun;
    } catch (err) {
      console.error("In-flight run errored during shutdown:", err);
    }
  }
  console.log("Worker stopped cleanly.");
}

/**
 * Process a single run (for manual/dev invocation)
 */
async function processSingleRun(runId: string): Promise<void> {
  await processRun(runId);
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize product title for search
 */
function normalizeProductTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^а-яёa-z0-9\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// CLI entry point
if (require.main === module) {
  // TASK-32: graceful shutdown по сигналам orchestrator-а (k8s/pm2/systemd).
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  process.on("SIGINT", () => requestShutdown("SIGINT"));

  const runId = process.argv[2];

  if (runId) {
    console.log(`Processing single run: ${runId}`);
    processSingleRun(runId)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  } else {
    console.log("Starting continuous worker...");
    runWorker().catch((err) => {
      console.error("Worker crashed:", err);
      process.exit(1);
    });
  }
}

// Export for programmatic use
export { processRun, runWorker, getQueuedRuns };