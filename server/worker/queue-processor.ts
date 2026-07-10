import { createSupabaseServiceRoleClient } from "../../lib/supabase/service-role";
import { processPhotoOcrJob } from "./index";
import { getAiConfig } from "../ai-config";

export async function processJobQueue(batchSize = 5): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const aiConfig = getAiConfig();

  // Get queued jobs that are ready to run
  const now = new Date().toISOString();
  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .eq("kind", "photo_ocr")
    .lt("run_after", now)
    .limit(batchSize)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load jobs:", error.message);
    return;
  }

  if (!jobs || jobs.length === 0) {
    console.log("No jobs to process");
    return;
  }

  console.log(`Processing ${jobs.length} jobs`);

  // Process each job
  for (const job of jobs) {
    try {
      await processPhotoOcrJob(job, aiConfig);
    } catch (error) {
      console.error(`Failed to process job ${job.id}:`, error);
      // Continue processing other jobs even if one fails
    }
  }
}

// Alternative: Process single job (useful for testing)
export async function processSingleJob(jobId: string): Promise<void> {
  const supabase = createSupabaseServiceRoleClient();
  const aiConfig = getAiConfig();

  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    throw new Error(`Job not found: ${error?.message || "No job data"}`);
  }

  await processPhotoOcrJob(job, aiConfig);
}