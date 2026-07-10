import type {
  PipelineProviderInfo,
  PriceCapturePhotoInput,
  PriceTagDetection,
  PriceTagDetector,
  PriceTagDetectorInput,
  PriceTagDetectorResult,
} from "./local-pipeline";

export type HeuristicPriceTagDetectorOptions = {
  /** Pixel brightness threshold used to find light price-tag rectangles. */
  brightThreshold?: number;
  /** Pixel darkness threshold used only for diagnostics/confidence; dark text is useful but not mandatory. */
  darkThreshold?: number;
  minWidthPx?: number;
  minHeightPx?: number;
  minAreaPx?: number;
  maxWidthRatio?: number;
  maxHeightRatio?: number;
  minFillRatio?: number;
  maxDetections?: number;
};

type PixelFormat = "grayscale" | "rgb" | "rgba";

type Component = {
  x: number;
  y: number;
  width: number;
  height: number;
  brightPixels: number;
  darkPixels: number;
  fillRatio: number;
  confidence: number;
};

const PROVIDER: PipelineProviderInfo = {
  provider: "local",
  model: "heuristic-price-tag-v1",
  version: "PV-02-01",
};

const DEFAULT_OPTIONS: Required<HeuristicPriceTagDetectorOptions> = {
  brightThreshold: 220,
  darkThreshold: 90,
  minWidthPx: 12,
  minHeightPx: 8,
  minAreaPx: 120,
  maxWidthRatio: 0.85,
  maxHeightRatio: 0.55,
  minFillRatio: 0.45,
  maxDetections: 30,
};

export function createHeuristicPriceTagDetector(options: HeuristicPriceTagDetectorOptions = {}): PriceTagDetector {
  return new HeuristicPriceTagDetector(options);
}

export class HeuristicPriceTagDetector implements PriceTagDetector {
  readonly provider = PROVIDER;
  private readonly options: Required<HeuristicPriceTagDetectorOptions>;

  constructor(options: HeuristicPriceTagDetectorOptions = {}) {
    this.options = normalizeOptions(options);
  }

  async detect(input: PriceTagDetectorInput): Promise<PriceTagDetectorResult> {
    const imageWidth = toPositiveInteger(input.photo.dimensions.width);
    const imageHeight = toPositiveInteger(input.photo.dimensions.height);

    if (!imageWidth || !imageHeight) {
      return this.emptyResult("invalid_dimensions");
    }

    const format = inferPixelFormat(input.photo, imageWidth, imageHeight);
    if (!format) {
      return this.emptyResult("unsupported_encoded_image_bytes", {
        byteLength: input.photo.bytes.byteLength,
        expectedGrayscaleByteLength: imageWidth * imageHeight,
        expectedRgbByteLength: imageWidth * imageHeight * 3,
        expectedRgbaByteLength: imageWidth * imageHeight * 4,
      });
    }

    const components = findBrightComponents(input.photo.bytes, imageWidth, imageHeight, format, this.options)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.options.maxDetections);

    return {
      detections: components.map((component, index) => componentToDetection(component, index)),
      provider: this.provider,
      diagnostics: {
        reason: "ok",
        pixelFormat: format,
        componentsAccepted: components.length,
        options: this.options,
      },
    };
  }

  private emptyResult(reason: string, diagnostics: Record<string, unknown> = {}): PriceTagDetectorResult {
    return {
      detections: [],
      provider: this.provider,
      diagnostics: {
        reason,
        ...diagnostics,
      },
    };
  }
}

function findBrightComponents(
  bytes: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  format: PixelFormat,
  options: Required<HeuristicPriceTagDetectorOptions>,
): Component[] {
  const totalPixels = imageWidth * imageHeight;
  const brightMask = new Uint8Array(totalPixels);
  const darkMask = new Uint8Array(totalPixels);

  for (let index = 0; index < totalPixels; index += 1) {
    const luma = readLuma(bytes, index, format);
    if (luma >= options.brightThreshold) brightMask[index] = 1;
    if (luma <= options.darkThreshold) darkMask[index] = 1;
  }

  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  const components: Component[] = [];

  for (let start = 0; start < totalPixels; start += 1) {
    if (!brightMask[start] || visited[start]) continue;

    const component = floodFillComponent(start, brightMask, darkMask, visited, queue, imageWidth, imageHeight, options);
    if (component) components.push(component);
  }

  return components;
}

function floodFillComponent(
  start: number,
  brightMask: Uint8Array,
  darkMask: Uint8Array,
  visited: Uint8Array,
  queue: Int32Array,
  imageWidth: number,
  imageHeight: number,
  options: Required<HeuristicPriceTagDetectorOptions>,
): Component | null {
  let head = 0;
  let tail = 0;
  let brightPixels = 0;
  let minX = imageWidth;
  let minY = imageHeight;
  let maxX = 0;
  let maxY = 0;

  queue[tail] = start;
  tail += 1;
  visited[start] = 1;

  while (head < tail) {
    const index = queue[head];
    head += 1;

    brightPixels += 1;
    const x = index % imageWidth;
    const y = Math.floor(index / imageWidth);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    visitNeighbor(index - 1, x > 0, brightMask, visited, queue, tail, (nextTail) => { tail = nextTail; });
    visitNeighbor(index + 1, x < imageWidth - 1, brightMask, visited, queue, tail, (nextTail) => { tail = nextTail; });
    visitNeighbor(index - imageWidth, y > 0, brightMask, visited, queue, tail, (nextTail) => { tail = nextTail; });
    visitNeighbor(index + imageWidth, y < imageHeight - 1, brightMask, visited, queue, tail, (nextTail) => { tail = nextTail; });
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const boxArea = width * height;

  if (width < options.minWidthPx || height < options.minHeightPx) return null;
  if (boxArea < options.minAreaPx) return null;
  if (width / imageWidth > options.maxWidthRatio) return null;
  if (height / imageHeight > options.maxHeightRatio) return null;

  const fillRatio = brightPixels / boxArea;
  if (fillRatio < options.minFillRatio) return null;

  const darkPixels = countDarkPixelsInBox(darkMask, imageWidth, minX, minY, width, height);
  const confidence = scoreComponent({ width, height, boxArea, fillRatio, darkPixels }, imageWidth, imageHeight);

  return {
    x: minX,
    y: minY,
    width,
    height,
    brightPixels,
    darkPixels,
    fillRatio,
    confidence,
  };
}

function visitNeighbor(
  index: number,
  allowed: boolean,
  brightMask: Uint8Array,
  visited: Uint8Array,
  queue: Int32Array,
  tail: number,
  setTail: (tail: number) => void,
): void {
  if (!allowed || !brightMask[index] || visited[index]) return;
  visited[index] = 1;
  queue[tail] = index;
  setTail(tail + 1);
}

function scoreComponent(
  component: { width: number; height: number; boxArea: number; fillRatio: number; darkPixels: number },
  imageWidth: number,
  imageHeight: number,
): number {
  const areaRatio = component.boxArea / (imageWidth * imageHeight);
  const rectangularityScore = clamp01(component.fillRatio);
  const sizeScore = clamp01(areaRatio / 0.08);
  const aspectRatio = component.width / component.height;
  const aspectScore = aspectRatio >= 1.2 && aspectRatio <= 8 ? 1 : 0.55;
  const darkTextScore = component.darkPixels > 0 ? 1 : 0.75;

  return round4(0.25 + rectangularityScore * 0.35 + sizeScore * 0.15 + aspectScore * 0.15 + darkTextScore * 0.1);
}

function componentToDetection(component: Component, index: number): PriceTagDetection {
  return {
    id: `heuristic-tag-${index + 1}`,
    bbox: {
      x: component.x,
      y: component.y,
      width: component.width,
      height: component.height,
    },
    confidence: component.confidence,
    provider: PROVIDER.provider,
    model: PROVIDER.model,
    label: "price_tag",
  };
}

function inferPixelFormat(photo: PriceCapturePhotoInput, imageWidth: number, imageHeight: number): PixelFormat | null {
  const pixelCount = imageWidth * imageHeight;
  if (photo.bytes.byteLength === pixelCount) return "grayscale";
  if (photo.bytes.byteLength === pixelCount * 3) return "rgb";
  if (photo.bytes.byteLength === pixelCount * 4) return "rgba";
  return null;
}

function readLuma(bytes: Uint8Array, pixelIndex: number, format: PixelFormat): number {
  if (format === "grayscale") return bytes[pixelIndex];

  const stride = format === "rgb" ? 3 : 4;
  const offset = pixelIndex * stride;
  const red = bytes[offset];
  const green = bytes[offset + 1];
  const blue = bytes[offset + 2];

  return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

function countDarkPixelsInBox(mask: Uint8Array, imageWidth: number, x: number, y: number, width: number, height: number): number {
  let count = 0;
  for (let row = y; row < y + height; row += 1) {
    const rowOffset = row * imageWidth;
    for (let col = x; col < x + width; col += 1) {
      count += mask[rowOffset + col];
    }
  }
  return count;
}

function normalizeOptions(options: HeuristicPriceTagDetectorOptions): Required<HeuristicPriceTagDetectorOptions> {
  return {
    brightThreshold: clampByte(options.brightThreshold) ?? DEFAULT_OPTIONS.brightThreshold,
    darkThreshold: clampByte(options.darkThreshold) ?? DEFAULT_OPTIONS.darkThreshold,
    minWidthPx: positiveInteger(options.minWidthPx) ?? DEFAULT_OPTIONS.minWidthPx,
    minHeightPx: positiveInteger(options.minHeightPx) ?? DEFAULT_OPTIONS.minHeightPx,
    minAreaPx: positiveInteger(options.minAreaPx) ?? DEFAULT_OPTIONS.minAreaPx,
    maxWidthRatio: positiveRatio(options.maxWidthRatio) ?? DEFAULT_OPTIONS.maxWidthRatio,
    maxHeightRatio: positiveRatio(options.maxHeightRatio) ?? DEFAULT_OPTIONS.maxHeightRatio,
    minFillRatio: positiveRatio(options.minFillRatio) ?? DEFAULT_OPTIONS.minFillRatio,
    maxDetections: positiveInteger(options.maxDetections) ?? DEFAULT_OPTIONS.maxDetections,
  };
}

function clampByte(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), 0), 255);
}

function positiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.trunc(value);
  return integer > 0 ? integer : undefined;
}

function positiveRatio(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 0 ? value : undefined;
}

function toPositiveInteger(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const integer = Math.floor(value);
  return integer > 0 ? integer : null;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
