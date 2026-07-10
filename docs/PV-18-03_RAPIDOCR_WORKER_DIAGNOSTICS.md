# PV-18-03 RapidOCR worker diagnostics

PV-18 isolates OCR worker failures after PV-16/PV-17 showed:

- detector produced crops;
- panel expansion produced larger OCR inputs;
- RapidOCR worker returned empty text for all crops.

## What changed

The worker now defaults to a safer RapidOCR input path:

```txt
raw protocol bytes -> Pillow RGB image -> temporary RGB PNG path -> RapidOCR(path)
```

This avoids version-specific RapidOCR behavior around `PIL.Image` inputs.

The worker also exposes diagnostics:

```txt
rapidocrInputMode
rapidocrInputType
decodedImage.width/height/sourcePixelFormat/pilMode/rawByteLength
rapidocrResultType
normalizedBlockCount
debugDumpPath, when enabled
```

## Run worker with debug dump

```bash
python tools/ocr-worker/rapidocr_worker.py \
  --host 127.0.0.1 \
  --port 8765 \
  --rapidocr-input-mode path \
  --debug-dump-dir tmp/real-photo-runs/worker-inputs
```

Health check:

```bash
curl http://127.0.0.1:8765/health
```

Expected health fields:

```txt
ok: true
provider: rapidocr-worker
rapidocrInputMode: path
debugDumpDir: tmp/real-photo-runs/worker-inputs
```

## Check one existing crop directly

After running PV-16/PV-17 debug with `--dump-crops`, send one OCR input image directly to the worker:

```bash
python tools/ocr-worker/send_image_to_worker.py \
  tmp/real-photo-runs/crops/1/<itemId>.ocr-input.png
```

This bypasses the detector and TypeScript pipeline. If this returns text, the worker can read the crop and the issue is likely in the TypeScript protocol path. If this is empty, the issue is OCR quality/config/input image quality.

## Re-run full photo pipeline

```bash
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr \
npm run debug:evidence-write-plan -- ./samples/real/1.jpg \
  --ocr-mode rapidocr-worker \
  --extract-product-text \
  --max-items 20 \
  --dump-crops \
  --crop-dump-dir tmp/real-photo-runs/crops \
  > tmp/real-photo-runs/1.write-plan.json
```

Repeat for `samples/real/2.jpg`.

## Interpretation

If worker `debugDumpPath` images are readable by eye but OCR text is empty, fix RapidOCR configuration or try another OCR engine.

If worker dump images are wrong while `ocr-input.png` looks right, fix the HTTP/raw protocol conversion.

If OCR text appears but price/product extraction remains empty, move to price parser/product text extractor.

Do not write to Supabase while running this diagnostic.
