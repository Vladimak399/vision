#!/usr/bin/env python3
"""Send one image file to the local PriceVision OCR worker.

Use this to isolate the OCR worker from the TypeScript detector pipeline:

    python tools/ocr-worker/send_image_to_worker.py \
      tmp/real-photo-runs/crops/1/<itemId>.ocr-input.png
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

REQUEST_SCHEMA_VERSION = "pricevision-ocr-worker-request-v1"


def load_rgb_raw_image(path: Path) -> Dict[str, Any]:
    try:
        from PIL import Image  # type: ignore
    except Exception as exc:  # pragma: no cover - optional runtime
        raise RuntimeError("Pillow is required. Install with: pip install pillow") from exc

    image = Image.open(path).convert("RGB")
    raw = image.tobytes()
    return {
        "bytesBase64": base64.b64encode(raw).decode("ascii"),
        "pixelFormat": "rgb",
        "width": image.width,
        "height": image.height,
        "filename": path.name,
        "contentType": mimetypes.guess_type(path.name)[0] or "image/png",
    }


def build_payload(path: Path) -> Dict[str, Any]:
    return {
        "schemaVersion": REQUEST_SCHEMA_VERSION,
        "requestId": f"manual-smoke:{path.name}",
        "image": load_rgb_raw_image(path),
        "context": {
            "companyId": "manual-smoke-company",
            "storeId": "manual-smoke-store",
            "week": 1,
            "runId": "manual-smoke-run",
            "itemId": path.stem,
            "detectionId": path.stem,
        },
        "hints": {"languages": ["ru", "en"]},
    }


def post_json(url: str, payload: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"content-type": "application/json", "accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # nosec B310 - local dev tool
        return json.loads(response.read().decode("utf-8"))


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send a local image file to PriceVision OCR worker")
    parser.add_argument("image_path")
    parser.add_argument("--url", default="http://127.0.0.1:8765/ocr")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--compact", action="store_true")
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    path = Path(args.image_path)
    if not path.exists() or not path.is_file():
        raise SystemExit(f"Image file does not exist: {path}")

    response = post_json(args.url, build_payload(path), args.timeout)
    print(json.dumps(response, ensure_ascii=False, indent=None if args.compact else 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
