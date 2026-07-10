# PV-15-03 — Real photo failure report runbook

Status: local/debug evaluation only. No Supabase write, no route, no UI.

## Goal

Use 3-5 real shelf photos to find the first practical bottleneck:

1. detector misses price tags;
2. OCR returns empty or noisy text;
3. price parser misses a visible price;
4. product text extraction removes useful text;
5. catalog matching fails or needs review;
6. evidence write plan is empty.

## Step 1 — run each photo through debug write-plan

Use mock OCR only for parser/matcher smoke tests. Use RapidOCR for real photo evaluation.

```bash
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr \
npm run debug:evidence-write-plan -- ./samples/real/photo-1.jpg \
  --ocr-mode rapidocr-worker \
  --extract-product-text \
  --max-items 5 > ./tmp/photo-1.write-plan.json
```

Repeat for 3-5 photos:

```bash
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr \
npm run debug:evidence-write-plan -- ./samples/real/photo-2.jpg \
  --ocr-mode rapidocr-worker \
  --extract-product-text \
  --max-items 5 > ./tmp/photo-2.write-plan.json
```

## Step 2 — build aggregate failure report

```bash
npm run report:real-photo-failures -- \
  ./tmp/photo-1.write-plan.json \
  ./tmp/photo-2.write-plan.json \
  ./tmp/photo-3.write-plan.json \
  --min-detections 3 \
  --low-match-threshold 0.7 > ./tmp/real-photo-failure-report.json
```

## Output

The report contains:

```txt
schemaVersion
photoCount
blockingCount
warningCount
infoCount
metrics
failures[]
nextActions[]
```

Failure kinds:

```txt
detector_no_detections
detector_low_count
ocr_empty
price_not_parsed
product_text_missing
match_missing
match_needs_review
match_low_confidence
write_plan_empty
```

## Interpretation order

Fix in this order:

1. detector failures;
2. crop/OCR failures;
3. price parser failures;
4. product text extraction failures;
5. catalog matching failures;
6. write-plan mapping failures.

Do not tune matching if detector/OCR is still failing on the same photo set.

## Safety

This process does not call Supabase insert/update/delete. It only reads local image files and writes local JSON reports.
