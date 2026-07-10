# PV-03-08 — OCR worker strategy

## Decision

PriceVision should not embed the first real OCR runtime directly into the Next.js request/runtime path.

The preferred boundary is:

```txt
Next.js / Node pipeline
→ decode image
→ detect price tag bbox
→ extract raw crop pixels
→ call OCR worker boundary
→ normalize OCR response into LocalOcrResult
→ merge OCR evidence into draft rows
```

## Why this boundary exists

OCR runtimes and models are operationally different from the existing web app code:

- They may require native libraries, model files, Python packages, or long cold starts.
- They may need different CPU/memory limits from the Next.js route runtime.
- They should be benchmarked independently from detector and matching logic.
- They must not force OCR package/model dependencies into the main web build before the choice is proven.

## Current implementation scope

This phase should add only the application-side worker contract and a mock worker adapter.

It should not add:

- RapidOCR, PaddleOCR, Tesseract, or any real OCR package.
- OCR model weights.
- Docker/runtime deployment scripts.
- Supabase writes.
- UI changes.
- Production route exposure.

## Worker contract shape

The application sends:

```txt
run context
item / detection identifiers
crop bbox and source bbox metadata
crop image bytes
crop dimensions
crop content type / filename / storage path metadata
optional hints, such as language
```

The worker returns:

```txt
ok / error
recognized text
confidence
optional text blocks
provider/model metadata
diagnostics
```

The application then normalizes the response through `buildLocalOcrResult()` so downstream code always receives the same `LocalOcrResult` shape.

## Adapter sequence

1. Add `ExternalOcrWorkerClient` and `ExternalOcrWorkerOcrEngine`.
2. Add a mock worker client for deterministic tests and debug flow.
3. Keep `--with-ocr` no-op behavior as the safe default.
4. Add a debug-only switch for mock worker OCR text.
5. Add the real OCR worker later as a separate PR after runtime, license, packaging, and model storage decisions are explicit.

## Next decision before real OCR

Before connecting a real OCR engine, choose one of these deployment modes:

```txt
local Python worker process
containerized HTTP worker
internal queue/job worker
external OCR service adapter
```

For PriceVision MVP, the safest first real implementation is likely an internal worker boundary that can be run locally and benchmarked independently before any production deployment.
