"use server";

import { queueRecognitionForSession, type QueueRecognitionState } from "../actions";
import { processQueuedRecognitionJobs, type ProcessQueueState } from "../worker-actions";

export type RecognitionFlowState = {
  error?: string;
  message?: string;
};

export async function runRecognitionFlow(
  _state: RecognitionFlowState,
  formData: FormData,
): Promise<RecognitionFlowState> {
  const queueResult: QueueRecognitionState = await queueRecognitionForSession({}, formData);

  if (queueResult.error) {
    return { error: queueResult.error };
  }

  const processFormData = new FormData();
  const sessionId = String(formData.get("session_id") ?? "").trim();
  processFormData.set("session_id", sessionId);
  processFormData.set("ocr_limit", "10");

  const processResult: ProcessQueueState = await processQueuedRecognitionJobs({}, processFormData);

  if (processResult.error) {
    return { error: processResult.error };
  }

  return {
    message: [queueResult.message, processResult.message].filter(Boolean).join(" "),
  };
}
