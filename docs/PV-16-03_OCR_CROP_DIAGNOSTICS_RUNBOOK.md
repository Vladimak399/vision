# PV-16-03 OCR crop diagnostics runbook

Цель: проверить, что именно получает OCR на реальных фото полок.

## Команды

Положить фото в:

```txt
samples/real/1.jpg
samples/real/2.jpg
```

Запустить RapidOCR worker в отдельном терминале:

```bash
python tools/ocr-worker/rapidocr_worker.py --host 127.0.0.1 --port 8765
```

Проверить первое фото:

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

Проверить второе фото:

```bash
PRICEVISION_OCR_WORKER_URL=http://127.0.0.1:8765/ocr \
npm run debug:evidence-write-plan -- ./samples/real/2.jpg \
  --ocr-mode rapidocr-worker \
  --extract-product-text \
  --max-items 20 \
  --dump-crops \
  --crop-dump-dir tmp/real-photo-runs/crops \
  > tmp/real-photo-runs/2.write-plan.json
```

Собрать общий отчет:

```bash
npm run report:real-photo-failures -- \
  tmp/real-photo-runs/1.write-plan.json \
  tmp/real-photo-runs/2.write-plan.json \
  --min-detections 3 \
  --low-match-threshold 0.7 \
  > tmp/real-photo-runs/real-photo-failure-report.json
```

## Где смотреть crop

```txt
tmp/real-photo-runs/crops/1/<itemId>.original.png
tmp/real-photo-runs/crops/1/<itemId>.ocr-input.png
tmp/real-photo-runs/crops/2/<itemId>.original.png
tmp/real-photo-runs/crops/2/<itemId>.ocr-input.png
```

`original.png` показывает, что detector реально вырезал из исходного фото.

`ocr-input.png` показывает crop после bbox expansion и upscale. Именно его получает OCR worker.

## Как читать результат

Если `original.png` не содержит ценник, значит сначала чинить detector.

Если `original.png` содержит только маленькую полоску, штрихкод или часть цифры, значит detector нашел фрагмент внутри ценника, а не весь ценник.

Если `ocr-input.png` стал крупнее, но все еще не содержит весь ценник, значит нужно усиливать bbox expansion или переходить к panel detector.

Если `ocr-input.png` глазами читаемый, но OCR возвращает пустой текст, значит следующий bottleneck — RapidOCR worker/config.

В JSON смотреть:

```txt
ocr.items[].cropDiagnostics.originalWidth
ocr.items[].cropDiagnostics.originalHeight
ocr.items[].cropDiagnostics.ocrInputWidth
ocr.items[].cropDiagnostics.ocrInputHeight
ocr.items[].cropDiagnostics.isProbablyTooSmallForOcr
ocr.items[].cropDiagnostics.dumpOriginalPath
ocr.items[].cropDiagnostics.dumpOcrInputPath
```

## Текущий критерий проблемы

BBox считается подозрительно маленьким, если он меньше OCR source threshold. В таком случае diagnostics содержит:

```txt
reviewReason = detected_bbox_too_small_for_ocr
```

Для случаев вроде `70x10 px` crop расширяется и масштабируется до OCR input не меньше `320x80 px`, насколько это позволяют границы изображения.

## Ограничения

Этот runbook не делает запись в Supabase.

Команды не используют `insert:evidence-test-row`.

Это debug flow, а не production route.
