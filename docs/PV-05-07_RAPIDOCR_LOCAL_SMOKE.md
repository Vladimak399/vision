# PV-05-07 — RapidOCR local smoke flow

This document describes the local-only RapidOCR smoke path for PriceVision.

Scope:

- local developer workflow only;
- no production route changes;
- no Supabase writes;
- no Vercel deployment;
- no model weights committed to git;
- no OCR keys required.

## Why this exists

The PriceVision web app must not load OCR/CV runtime dependencies inside the Next.js runtime. Real OCR is isolated behind an external worker boundary:

```txt
photo
→ sharp decode
→ heuristic detector
→ crop extraction
→ HTTP OCR worker
→ OCR evidence merge
→ price parser
→ product text extractor
→ debug report JSON
```

## Local worker install

Create a separate Python environment outside the web app runtime:

```bash
python -m venv .venv-ocr
. .venv-ocr/bin/activate
pip install rapidocr onnxruntime pillow
```

On Windows PowerShell:

```powershell
python -m venv .venv-ocr
.venv-ocr\Scripts\Activate.ps1
pip install rapidocr onnxruntime pillow
```

## Start worker

```bash
python tools/ocr-worker/rapidocr_worker.py --host 127.0.0.1 --port 8765
```

Health check:

```bash
curl http://127.0.0.1:8765/health
```

The worker endpoint used by Node is:

```txt
http://127.0.0.1:8765/ocr
```

## Run PriceVision debug flow

```bash
npm run debug:detector-only -- ./path/to/photo.jpg \
  --ocr-mode rapidocr-worker \
  --ocr-worker-url http://127.0.0.1:8765/ocr \
  --extract-product-text
```

Equivalent env-based call:

```bash
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr \
npm run debug:detector-only -- ./path/to/photo.jpg \
  --ocr-mode rapidocr-worker \
  --extract-product-text
```

## What to inspect in JSON

```txt
response.ocr.mode
response.ocr.metrics
response.ocr.items[].status
response.ocr.items[].provider
response.ocr.items[].model
response.ocr.items[].textPreview
response.ocr.items[].diagnostics
response.report.summary.ocr
response.report.drafts[].ocr.text
response.report.drafts[].product.priceMinor
response.report.drafts[].product.rawName
response.report.drafts[].product.normalizedProductText
```

Status meanings:

```txt
text          OCR returned non-empty text.
empty         OCR ran but returned no text.
worker_error  OCR worker returned a structured failure.
unsupported   OCR was intentionally disabled/no-op.
```

## Expected failure modes

If the worker is not running, debug JSON should still be generated. The OCR section should show a `worker_error` item with diagnostics such as:

```json
{
  "reason": "external_ocr_worker_failed",
  "errorCode": "worker_request_failed"
}
```

If RapidOCR/Pillow is not installed inside the worker venv, the worker should return a structured `rapidocr_unavailable` or `ocr_failed` error.

## Configuration later

No API key is required for RapidOCR. The only runtime setting needed by the Node side is the worker URL:

```txt
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr
```

For production this should not be added until the OCR worker deployment target is selected. The likely production shape is a private internal worker URL, not a public endpoint.
