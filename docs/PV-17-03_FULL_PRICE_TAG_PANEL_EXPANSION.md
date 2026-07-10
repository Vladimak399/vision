# PV-17-03 Full price tag panel expansion

PV-17 changes OCR crop preparation for real shelf photos.

The user uploads a full shelf photo. PriceVision must internally crop the full price tag, not a small fragment.

For small detector boxes, OCR preprocessing now uses:

```txt
expansionMode = price_tag_panel
panelMinWidth = 260
panelMinHeight = 110
panelWidthMultiplier = 4
panelHeightMultiplier = 8
panelUpwardBias = 0.68
```

The panel crop is expanded upward to include product text above the price.

## Check

Run OCR worker:

```powershell
.venv-ocr\Scripts\Activate.ps1
python tools/ocr-worker/rapidocr_worker.py --host 127.0.0.1 --port 8765
```

Run photo debug:

```powershell
$env:PRICEVISION_OCR_WORKER_URL="http://127.0.0.1:8765/ocr"
npm run debug:evidence-write-plan -- ./samples/real/1.jpg --ocr-mode rapidocr-worker --extract-product-text --max-items 20 --dump-crops --crop-dump-dir tmp/real-photo-runs/crops > tmp/real-photo-runs/1.write-plan.json
npm run debug:evidence-write-plan -- ./samples/real/2.jpg --ocr-mode rapidocr-worker --extract-product-text --max-items 20 --dump-crops --crop-dump-dir tmp/real-photo-runs/crops > tmp/real-photo-runs/2.write-plan.json
```

Inspect:

```txt
tmp/real-photo-runs/crops/1/*.original.png
tmp/real-photo-runs/crops/1/*.ocr-input.png
tmp/real-photo-runs/crops/2/*.original.png
tmp/real-photo-runs/crops/2/*.ocr-input.png
```

Expected: `ocr-input.png` should include product name and price when the detector fragment is near a real price tag.

If `ocr-input.png` is still not a full tag, improve detector next.

If `ocr-input.png` is readable but OCR is empty, tune RapidOCR next.
