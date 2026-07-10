# PV-19 RapidOCR result normalization

Fixes the worker crash caused by numpy arrays in RapidOCR result fields.

Observed error:

```text
ValueError: The truth value of an array with more than one element is ambiguous
```

Cause: `getattr(result, "boxes") or []` was unsafe when `boxes` was a numpy array.

Change: convert `txts`, `scores`, `boxes`, points, and numpy scalar values through safe normalizers before building OCR blocks.

Expected result: `send_image_to_worker.py` should no longer return `ok: false` because of result normalization. OCR text can still be empty if RapidOCR cannot read the crop.
