# PV-14-03 — Debug evidence write plan

Status: dry-run planning only.

PV-14 adds a local debug command that turns detector output into Supabase-shaped payloads without sending them anywhere.

```txt
photo -> detector -> OCR -> price -> product text -> match -> persistence dry-run -> evidenceWritePlan
```

## Command

```bash
npm run debug:evidence-write-plan -- ./path/to/photo.jpg \
  --ocr-mode mock-worker \
  --mock-ocr-text "Кофе Жокей Традиционный 250 г\nЦена 123,45" \
  --mock-ocr-confidence 0.91 \
  --extract-product-text \
  --max-items 1
```

With local OCR worker:

```bash
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr \
npm run debug:evidence-write-plan -- ./path/to/photo.jpg \
  --ocr-mode rapidocr-worker \
  --extract-product-text \
  --max-items 1
```

## Output

The JSON includes:

```txt
persistence.items[].payload
evidenceWritePlan.priceCaptureRunPayload
evidenceWritePlan.evidencePayloads[]
evidenceWritePlan.cleanup
```

Default selection is one item. Use `--max-items N` only after reviewing the one-item output.

## Manual checks before any later admin action

1. `company_id`, `store_id`, `week`, and `processing_run_id` are correct.
2. `raw_name`, `ocr_text`, `price_minor`, and `normalized_product_text` look reasonable.
3. `bbox`, `crop_storage_path`, `crop_width`, and `crop_height` are present.
4. `review_reason` is acceptable.
5. `ai_used` remains false for local pipeline output.
6. Cleanup selector points to the same `processing_run_id`.

No production API path is changed by this document.
