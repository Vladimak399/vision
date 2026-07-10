# PV-02-03 — Image decoder strategy

## Status

Accepted for implementation planning.

## Context

PriceVision needs to process real shelf photos. The current local detector can operate on raw grayscale/RGB/RGBA pixel buffers, but it intentionally does not decode encoded JPEG/PNG/WebP files. That boundary was introduced in `server/price-capture/image-decoder.ts` so detector logic does not depend on a specific image library.

The project goal is to minimize paid Vision/AI use. Therefore image decoding and basic pre-processing should remain local/open-source where possible, with paid Vision reserved only for fallback paths.

## Decision

Use an adapter-first decoder strategy.

1. Keep `ImageDecoder` as the stable boundary.
2. Do not put image decoding directly into detector modules.
3. Do not add a decoder dependency until a small PR explicitly introduces one adapter.
4. Prefer `sharp`/libvips as the first server-side decoder candidate for JPEG/PNG/WebP to raw pixels, because it is mature, fast, and widely used in Node.js image processing.
5. Keep OpenCV/ONNX as later CV/model layers, not as the first image decoder step.
6. Keep the option to move decoding into a worker if Vercel/serverless package size, cold starts, or native binary handling becomes a problem.

## Candidate options

### Option A — `sharp` adapter

Use a module such as `server/price-capture/sharp-image-decoder.ts` that implements `ImageDecoder` and converts encoded bytes into raw RGB/RGBA/grayscale bytes.

Expected benefits:

- Good fit for server-side JPEG/PNG/WebP decoding.
- Good performance for resizing and format conversion.
- One focused dependency instead of a broader CV framework.
- Cleanly plugs into the existing `ImageDecoder` boundary.

Risks:

- Native/libvips packaging can affect serverless bundle size and cold starts.
- Needs deployment verification before enabling in production.
- Should be optional and isolated so local tests and existing flows are not blocked by binary issues.

### Option B — external worker decoder

Run decoding in a separate worker/service and pass raw pixels back to the main pipeline.

Expected benefits:

- Keeps the Next.js/Vercel app smaller.
- Makes native dependencies easier to isolate.
- Allows heavier CV stacks outside the web runtime.

Risks:

- More moving parts.
- Requires job orchestration and retry behavior.
- Slightly slower feedback loop for MVP development.

### Option C — OpenCV-first decoder/CV stack

Use OpenCV-related tooling for decode + CV processing.

Expected benefits:

- Strong CV toolbox for later stages: contour detection, thresholding, perspective correction, morphology, and potential model integration.
- OpenCV itself is permissively licensed under Apache-2.0.

Risks:

- Too heavy for the first decoder step.
- Higher setup complexity.
- More likely to create deployment friction than a focused decoder adapter.

### Option D — Jimp/canvas-style pure JS or canvas binding

Use a JavaScript-oriented image library or canvas bridge.

Expected benefits:

- Potentially simpler mental model.
- May be enough for basic decode/resize experiments.

Risks:

- Performance and memory behavior may be worse for large shelf photos.
- Canvas-style packages often introduce native/system dependencies anyway.
- Not the preferred production path unless `sharp` is rejected.

## Recommended next implementation

Next task should be:

```txt
PV-02-04 — sharp image decoder adapter
```

Scope:

- Add `sharp` only if package/deployment constraints are acceptable.
- Add `server/price-capture/sharp-image-decoder.ts` implementing `ImageDecoder`.
- Decode JPEG/PNG/WebP bytes into raw RGB or RGBA pixels.
- Return `DecodedImagePixels` with `decoderProvider`, `decoderModel`, dimensions, content type, and diagnostics.
- Add tests using tiny generated image fixtures.
- Do not change detector logic.
- Do not add OCR, matching, AI, Supabase writes, UI, or migrations.

If dependency risk is considered too high, choose instead:

```txt
PV-02-04-alt — external image decoder worker contract
```

Scope:

- Keep the main app dependency-free.
- Define request/response contract for a decoder worker.
- Add a local fake worker adapter for tests.
- Defer actual worker deployment.

## Acceptance criteria for the selected decoder adapter

- It implements `ImageDecoder`.
- It does not change `PriceTagDetector`.
- It returns raw pixels suitable for `decodedImageToDetectorPhotoInput()`.
- It handles unsupported/corrupt images with structured `ImageDecodeError`.
- It has tests for at least JPEG and PNG if real decoding is added.
- It does not call paid Vision/AI services.
- It does not write to Supabase.
- It does not trigger Vercel deployment.

## Explicit non-goals

- Do not add YOLO/ONNX model inference in this task.
- Do not copy OpenFoodFacts or other GitHub project code.
- Do not add AGPL dependencies or model weights.
- Do not apply production migrations.
- Do not modify UI.
- Do not perform real OCR.

## Rationale

The adapter-first approach keeps the architecture stable. Detector, OCR, parser, matcher, and evidence writer stay independent. If `sharp` works well in deployment, it becomes the first production decoder. If it causes binary/deployment friction, only the decoder adapter changes; the rest of the local pipeline remains intact.
