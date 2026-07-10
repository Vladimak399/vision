import { buildCropStoragePath, serializeCropEvidence, type CropPlan } from "./crop-generator";

export const CROP_EVIDENCE_BUCKET = "price-capture-evidence";

export type CropBytes = Uint8Array | ArrayBuffer;

export type CropUploadInput = {
  companyId: string;
  runId: string;
  itemId: string;
  cropPlan: CropPlan;
  cropBytes: CropBytes;
  sourceFilename?: string | null;
  extension?: string | null;
  contentType?: string | null;
  bucket?: string | null;
  upsert?: boolean;
};

export type CropUploadPlan = {
  bucket: string;
  path: string;
  body: Uint8Array;
  contentType: string;
  upsert: boolean;
  evidence: {
    bbox: CropPlan["bbox"];
    crop_storage_path: string;
    crop_width: number;
    crop_height: number;
  };
};

export type StorageUploadOptions = {
  contentType?: string;
  upsert?: boolean;
};

export type StorageUploadResult = {
  data: unknown | null;
  error: { message: string } | Error | null;
};

export type StorageBucketLike = {
  upload(path: string, body: Uint8Array, options?: StorageUploadOptions): Promise<StorageUploadResult>;
};

export type StorageClientLike = {
  from(bucket: string): StorageBucketLike;
};

const EXTENSION_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function createCropUploadPlan(input: CropUploadInput): CropUploadPlan | null {
  const body = normalizeCropBytes(input.cropBytes);
  if (!body || body.byteLength === 0) return null;

  const path = buildCropStoragePath({
    companyId: input.companyId,
    runId: input.runId,
    itemId: input.itemId,
    sourceFilename: input.sourceFilename,
    extension: input.extension,
  });

  const extension = getPathExtension(path);
  const contentType = normalizeContentType(input.contentType) ?? EXTENSION_TO_CONTENT_TYPE[extension] ?? "application/octet-stream";
  const bucket = normalizeBucket(input.bucket) ?? CROP_EVIDENCE_BUCKET;
  const cropEvidence = serializeCropEvidence(input.cropPlan);

  return {
    bucket,
    path,
    body,
    contentType,
    upsert: input.upsert ?? false,
    evidence: {
      ...cropEvidence,
      crop_storage_path: path,
    },
  };
}

export async function uploadCropEvidence(storage: StorageClientLike, plan: CropUploadPlan): Promise<{ path: string; evidence: CropUploadPlan["evidence"] }> {
  const result = await storage.from(plan.bucket).upload(plan.path, plan.body, {
    contentType: plan.contentType,
    upsert: plan.upsert,
  });

  if (result.error) {
    const message = result.error instanceof Error ? result.error.message : result.error.message;
    throw new Error(`Failed to upload crop evidence: ${message}`);
  }

  return {
    path: plan.path,
    evidence: plan.evidence,
  };
}

function normalizeCropBytes(value: CropBytes): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function normalizeContentType(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("/") ? normalized : null;
}

function normalizeBucket(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized || null;
}

function getPathExtension(path: string): string {
  const match = path.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}
