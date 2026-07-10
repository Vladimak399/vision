export type CropBBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageDimensions = {
  width: number;
  height: number;
};

export type CropPaddingOptions = {
  /** Fixed padding around bbox in source-image pixels. */
  pixels?: number;
  /** Relative padding based on the larger bbox side. Example: 0.1 = 10%. */
  ratio?: number;
};

export type CropPlanInput = {
  image: ImageDimensions;
  bbox: CropBBox;
  padding?: CropPaddingOptions;
};

export type CropPlan = {
  /** Clamped bbox in source-image coordinates after padding. */
  bbox: CropBBox;
  cropWidth: number;
  cropHeight: number;
  paddingPx: number;
  wasClamped: boolean;
};

export type CropStoragePathInput = {
  companyId: string;
  runId: string;
  itemId: string;
  sourceFilename?: string | null;
  extension?: string | null;
};

const DEFAULT_EXTENSION = "jpg";
const SAFE_SEGMENT_RE = /[^a-zA-Z0-9._-]+/g;

export function createCropPlan(input: CropPlanInput): CropPlan | null {
  const imageWidth = toPositiveInteger(input.image.width);
  const imageHeight = toPositiveInteger(input.image.height);

  if (!imageWidth || !imageHeight) return null;
  if (!isFiniteNumber(input.bbox.x) || !isFiniteNumber(input.bbox.y)) return null;
  if (!isFiniteNumber(input.bbox.width) || !isFiniteNumber(input.bbox.height)) return null;
  if (input.bbox.width <= 0 || input.bbox.height <= 0) return null;

  const paddingPx = resolvePaddingPx(input.bbox, input.padding);

  const rawLeft = input.bbox.x - paddingPx;
  const rawTop = input.bbox.y - paddingPx;
  const rawRight = input.bbox.x + input.bbox.width + paddingPx;
  const rawBottom = input.bbox.y + input.bbox.height + paddingPx;

  const left = clamp(Math.floor(rawLeft), 0, imageWidth);
  const top = clamp(Math.floor(rawTop), 0, imageHeight);
  const right = clamp(Math.ceil(rawRight), 0, imageWidth);
  const bottom = clamp(Math.ceil(rawBottom), 0, imageHeight);

  const cropWidth = right - left;
  const cropHeight = bottom - top;

  if (cropWidth <= 0 || cropHeight <= 0) return null;

  const wasClamped = left !== Math.floor(rawLeft)
    || top !== Math.floor(rawTop)
    || right !== Math.ceil(rawRight)
    || bottom !== Math.ceil(rawBottom);

  return {
    bbox: {
      x: left,
      y: top,
      width: cropWidth,
      height: cropHeight,
    },
    cropWidth,
    cropHeight,
    paddingPx,
    wasClamped,
  };
}

export function buildCropStoragePath(input: CropStoragePathInput): string {
  const companyId = safePathSegment(input.companyId, "company");
  const runId = safePathSegment(input.runId, "run");
  const itemId = safePathSegment(input.itemId, "item");
  const extension = normalizeExtension(input.extension ?? getExtension(input.sourceFilename) ?? DEFAULT_EXTENSION);

  return `evidence/${companyId}/runs/${runId}/crops/${itemId}.${extension}`;
}

export function serializeCropEvidence(plan: CropPlan) {
  return {
    bbox: plan.bbox,
    crop_width: plan.cropWidth,
    crop_height: plan.cropHeight,
  };
}

function resolvePaddingPx(bbox: CropBBox, padding: CropPaddingOptions | undefined): number {
  const fixed = padding?.pixels ?? 0;
  const ratio = padding?.ratio ?? 0;
  const fixedPx = Math.max(0, Math.floor(isFiniteNumber(fixed) ? fixed : 0));
  const ratioPx = Math.max(0, Math.floor(Math.max(bbox.width, bbox.height) * (isFiniteNumber(ratio) ? ratio : 0)));
  return Math.max(fixedPx, ratioPx);
}

function safePathSegment(value: string, fallback: string): string {
  const cleaned = value.trim().replace(SAFE_SEGMENT_RE, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function normalizeExtension(value: string): string {
  const cleaned = value.trim().replace(/^\.+/, "").replace(SAFE_SEGMENT_RE, "").toLowerCase();
  return cleaned || DEFAULT_EXTENSION;
}

function getExtension(filename?: string | null): string | null {
  if (!filename) return null;
  const match = filename.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1] ?? null;
}

function toPositiveInteger(value: number): number | null {
  if (!isFiniteNumber(value)) return null;
  const integer = Math.floor(value);
  return integer > 0 ? integer : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
