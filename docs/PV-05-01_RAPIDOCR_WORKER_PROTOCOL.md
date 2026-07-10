# PV-05-01 — RapidOCR worker protocol

Status: draft protocol for local/offline OCR worker integration.

## Decision

PriceVision should not load RapidOCR, PaddleOCR, ONNX Runtime, OpenVINO, TensorRT, or other OCR runtimes inside the Next.js application runtime.

The Next.js/Node side remains responsible for:

- decoding shelf photos;
- detecting price-tag bboxes;
- extracting crop pixels;
- normalizing OCR requests;
- parsing OCR text into price/product evidence;
- writing evidence later through explicit Supabase adapters.

A separate OCR worker process is responsible for:

- loading OCR dependencies and models;
- running RapidOCR/PaddleOCR inference;
- returning normalized OCR text, confidence, and optional text blocks.

This keeps native dependencies, model files, and heavier inference runtime outside the web app boundary.

## Current upstream reference

RapidOCR currently documents Python usage as:

```bash
pip install rapidocr onnxruntime
```

and:

```python
from rapidocr import RapidOCR
engine = RapidOCR()
result = engine(img_url)
```

RapidOCR is published as an Apache-2.0 package on PyPI, requires Python >=3.8 and <4, and the GitHub README describes the project as a free/open-source multi-platform OCR toolkit. The repository also notes that OCR model copyrights are held by Baidu while the engineering code is Apache-2.0. Treat model license and redistribution as a separate deployment decision.

## HTTP contract

The first worker boundary is HTTP JSON over localhost/private network.

Default local URL:

```txt
http://127.0.0.1:8765/ocr
```

### Request

```json
{
  "schemaVersion": "pricevision-ocr-worker-request-v1",
  "requestId": "run-1:det-1",
  "image": {
    "bytesBase64": "...",
    "pixelFormat": "rgba",
    "width": 160,
    "height": 40,
    "filename": "crop-1.png",
    "contentType": "application/x-pricevision-raw-rgba"
  },
  "context": {
    "companyId": "company-1",
    "storeId": "store-1",
    "week": 1,
    "runId": "run-1",
    "itemId": "det-1"
  }
}
```

The request is intentionally based on already extracted crop bytes. The worker does not receive the full shelf photo unless a later protocol version explicitly adds it.

### Success response

```json
{
  "schemaVersion": "pricevision-ocr-worker-response-v1",
  "requestId": "run-1:det-1",
  "ok": true,
  "provider": "rapidocr-worker",
  "model": "rapidocr-v1",
  "text": "Кофе Жокей Традиционный 250 г\nАкция 99,90",
  "confidence": 0.87,
  "blocks": [
    {
      "text": "Акция 99,90",
      "confidence": 0.91,
      "bbox": { "x": 10, "y": 20, "width": 80, "height": 18 }
    }
  ],
  "diagnostics": {
    "durationMs": 42,
    "engine": "rapidocr"
  }
}
```

### Error response

```json
{
  "schemaVersion": "pricevision-ocr-worker-response-v1",
  "requestId": "run-1:det-1",
  "ok": false,
  "provider": "rapidocr-worker",
  "model": "rapidocr-v1",
  "error": {
    "code": "ocr_failed",
    "message": "RapidOCR inference failed"
  },
  "text": "",
  "confidence": null,
  "blocks": [],
  "diagnostics": {
    "durationMs": 7
  }
}
```

## Non-goals for this batch

- No RapidOCR package is added to the Next.js app.
- No Python dependencies are added to `package.json`.
- No model files or weights are committed.
- No Supabase writes are executed.
- No production route is changed.
- No UI is changed.
- No Vercel deployment is triggered.

## Local validation path

Once a real worker is running, the debug flow should become:

```bash
npm run debug:detector-only -- ./photo.jpg \
  --ocr-mode rapidocr-worker \
  --ocr-worker-url http://127.0.0.1:8765/ocr \
  --extract-product-text
```

That mode is intentionally separate from the already merged `mock-worker` mode.
