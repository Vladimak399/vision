import { createSupabaseServiceRoleClient } from "../../lib/supabase/service-role";
import { withAiRetry } from "../ai-retry";
import { recognizeShelfPhoto } from "../shelf-recognition";
import type { AiConfig } from "../ai-config";

export type PhotoOcrJob = {
  id: string;
  company_id: string;
  session_id: string;
  kind: "photo_ocr";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  max_attempts: number;
  payload: {
    photo_id: string;
    storage_path: string;
    company_id: string;
    session_id: string;
  };
  error: string | null;
  correlation_id: string;
  run_after: string;
  created_at: string;
  updated_at: string;
};

export type JobProcessor = (job: PhotoOcrJob, aiConfig: AiConfig) => Promise<void>;

export async function processPhotoOcrJob(job: PhotoOcrJob, aiConfig: AiConfig): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();

  // Mark job as running
  await updateJobStatus(supabase, job.id, "running");

  try {
        // Mark photo as processing
        await updatePhotoStatus(supabase, job.payload.photo_id, "processing");

        // Process the photo with AI recognition
        await withAiRetry(
          async () => {
            const result = await recognizeShelfPhoto({
              imageUrl: job.payload.storage_path,
            });

// Save recognized items and create matches
            if (result.items && result.items.length > 0) {
              for (const item of result.items) {
                const recognizedItemId = await saveRecognizedItem(supabase, {
                  ...item,
                  companyId: job.company_id,
                  sessionId: job.session_id,
                  photoId: job.payload.photo_id,
                });

                // Create evidence for the recognized item
                try {
                  await createEvidence(
                    supabase,
                    job.company_id,
                    recognizedItemId,
                    job.payload.photo_id,
                    job.payload.storage_path
                  );
                } catch (evidenceError) {
                  console.warn(`Failed to create evidence for item ${recognizedItemId}:`, evidenceError);
                }

                // Try to create match for recognized item
                try {
                  await findOrCreateMatch(
                    supabase,
                    recognizedItemId,
                    job.company_id,
                    item.raw_name,
                    item.brand,
                    item.size_text
                  );
                } catch (matchError) {
                  console.warn(`Failed to create match for item ${recognizedItemId}:`, matchError);
                }
              }
            }

            // Mark photo as processed
            await updatePhotoStatus(supabase, job.payload.photo_id, "processed");

            // Update job as succeeded
            await updateJobStatus(supabase, job.id, "succeeded");
          },
          { maxAttempts: job.max_attempts }
        );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`Job ${job.id} failed: ${errorMessage}`);

    // Mark photo as failed
    await updatePhotoStatus(supabase, job.payload.photo_id, "failed", errorMessage);

    // Check if we should retry or mark as failed
    if (job.attempts >= job.max_attempts) {
      await updateJobStatus(supabase, job.id, "failed", errorMessage);
    } else {
      // Schedule retry
      const retryCount = job.attempts + 1;
      const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 30000); // Exponential backoff, max 30s

      await updateJobForRetry(supabase, job.id, retryCount, retryDelay);
    }
  }
}

async function updateJobStatus(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  jobId: string,
  status: "running" | "succeeded" | "failed",
  error?: string
): Promise<void> {
  const updateData: {
    status: string;
    updated_at: string;
    attempts: number;
    error?: string;
  } = {
    status,
    updated_at: new Date().toISOString(),
    attempts: 0, // Reset attempts on success/failure
  };

  if (error) {
    updateData.error = error;
  }

  await supabase
    .from("jobs")
    .update(updateData)
    .eq("id", jobId);
}

async function updatePhotoStatus(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  photoId: string,
  status: "processing" | "processed" | "failed",
  error?: string
): Promise<void> {
  const updateData: {
    status: string;
    processed_at?: string;
    error?: string;
  } = {
    status,
    processed_at: status === "processed" ? new Date().toISOString() : undefined,
  };

  if (error) {
    updateData.error = error;
  }

  await supabase
    .from("monitoring_photos")
    .update(updateData)
    .eq("id", photoId);
}

async function updateJobForRetry(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  jobId: string,
  retryCount: number,
  delayMs: number
): Promise<void> {
  const runAfter = new Date(Date.now() + delayMs).toISOString();

  await supabase
    .from("jobs")
    .update({
      status: "queued",
      attempts: retryCount,
      run_after: runAfter,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function createEvidence(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  companyId: string,
  recognizedItemId: string,
  photoId: string,
  storagePath: string,
  bbox?: { x: number; y: number; width: number; height: number }
): Promise<string> {
  const { data: evidence, error } = await supabase
    .from("evidence")
    .insert({
      company_id: companyId,
      recognized_item_id: recognizedItemId,
      photo_id: photoId,
      storage_path: storagePath,
      bbox: bbox || null,
    })
    .select("id")
    .single();

  if (error || !evidence) {
    throw new Error(`Failed to create evidence: ${error?.message || "No data returned"}`);
  }

  return evidence.id;
}

async function saveRecognizedItem(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  recognizedItem: {
    raw_name: string | null;
    brand: string | null;
    size_text: string | null;
    price_minor: number | null;
    currency: string;
    confidence: number;
    companyId: string;
    sessionId: string;
    photoId: string;
  }
): Promise<string> {
  const { data: insertedItem, error: insertError } = await supabase
    .from("recognized_items")
    .insert({
      company_id: recognizedItem.companyId,
      session_id: recognizedItem.sessionId,
      photo_id: recognizedItem.photoId,
      raw_name: recognizedItem.raw_name,
      brand: recognizedItem.brand,
      size_text: recognizedItem.size_text,
      price_minor: recognizedItem.price_minor,
      currency: recognizedItem.currency || "RUB",
      status: "recognized",
      confidence: recognizedItem.confidence,
      created_by: "system", // AI recognition
    })
    .select("id")
    .single();

  if (insertError || !insertedItem) {
    throw new Error(`Failed to save recognized item: ${insertError?.message || "No data returned"}`);
  }

  return insertedItem.id;
}

async function findOrCreateMatch(
  supabase: ReturnType<typeof createSupabaseServiceRoleClient>,
  recognizedItemId: string,
  companyId: string,
  rawName: string | null,
  brand: string | null,
  sizeText: string | null
): Promise<string | null> {
  // Try to find best match in catalog
  const { data: existingMatches, error: matchError } = await supabase
    .from("matches")
    .select("catalog_product_id, score")
    .eq("recognized_item_id", recognizedItemId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("score", { ascending: false })
    .limit(1)
    .single();

  if (matchError && matchError.code !== 'PGRST116') { // PGRST116 = no rows returned
    throw new Error(`Failed to check existing matches: ${matchError.message}`);
  }

  // If match exists, return it
  if (existingMatches) {
    return existingMatches.catalog_product_id;
  }

  // Try to find best catalog product match
  const matchScore = 0.75; // Default confidence threshold for auto-match
  const { data: matchingProducts, error: productError } = await supabase
    .from("catalog_products")
    .select("id, external_sku, name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .ilike("name", `%${rawName || ''}%`)
    .limit(5);

  if (productError) {
    throw new Error(`Failed to search catalog products: ${productError.message}`);
  }

  // Simple matching logic - in production you'd use more sophisticated matching
  let bestMatch: { id: string; score: number } | null = null;

  if (matchingProducts && matchingProducts.length > 0) {
    for (const product of matchingProducts) {
      // Simple scoring based on name similarity
      const score = Math.random(); // Placeholder - use proper similarity algorithm
      if (score > matchScore && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { id: product.id, score };
      }
    }
  }

  if (bestMatch) {
    // Create new match
    const { data: newMatch, error: createError } = await supabase
      .from("matches")
      .insert({
        company_id: companyId,
        recognized_item_id: recognizedItemId,
        catalog_product_id: bestMatch.id,
        score: bestMatch.score,
        decision: "auto",
        is_active: true,
        created_by: "system",
      })
      .select("id")
      .single();

    if (createError || !newMatch) {
      throw new Error(`Failed to create match: ${createError?.message || "No data returned"}`);
    }

    return newMatch.id;
  }

  return null;
}