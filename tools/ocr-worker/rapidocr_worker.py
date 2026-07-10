#!/usr/bin/env python3
"""RapidOCR HTTP worker skeleton for PriceVision.

This worker is intentionally outside the Next.js runtime. It uses only Python
stdlib for HTTP serving and lazy-imports RapidOCR so the repository can keep this
file without committing Python dependencies, model weights, or lockfiles.

Local install, outside the web app runtime:

    python -m venv .venv-ocr
    . .venv-ocr/bin/activate
    pip install rapidocr onnxruntime pillow
    python tools/ocr-worker/rapidocr_worker.py --host 127.0.0.1 --port 8765

Pillow is used only to convert raw crop bytes to an image object/file for
RapidOCR. The worker still accepts the protocol documented in
`docs/PV-05-01_RAPIDOCR_WORKER_PROTOCOL.md`.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
import time
import traceback
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple

REQUEST_SCHEMA_VERSION = "pricevision-ocr-worker-request-v1"
RESPONSE_SCHEMA_VERSION = "pricevision-ocr-worker-response-v1"
PROVIDER = "rapidocr-worker"
MODEL = "rapidocr-v1"

_ENGINE: Any = None
_IMPORT_ERROR: Optional[str] = None


@dataclass(frozen=True)
class WorkerConfig:
    host: str
    port: int
    enable_rapidocr: bool


def load_engine(enable_rapidocr: bool) -> Any:
    """Lazy-load RapidOCR once per process."""
    global _ENGINE, _IMPORT_ERROR

    if not enable_rapidocr:
        _IMPORT_ERROR = "RapidOCR is disabled for this worker process."
        return None

    if _ENGINE is not None:
        return _ENGINE

    if _IMPORT_ERROR is not None:
        return None

    try:
        from rapidocr import RapidOCR  # type: ignore

        _ENGINE = RapidOCR()
        return _ENGINE
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        _IMPORT_ERROR = f"Failed to import or initialize RapidOCR: {exc}"
        return None


class RapidOcrWorkerHandler(BaseHTTPRequestHandler):
    server_version = "PriceVisionRapidOCRWorker/0.1"
    config: WorkerConfig

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/health":
            self.write_json(200, {
                "ok": True,
                "provider": PROVIDER,
                "model": MODEL,
                "rapidocrLoaded": _ENGINE is not None,
                "rapidocrError": _IMPORT_ERROR,
            })
            return

        self.write_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path != "/ocr":
            self.write_json(404, {"ok": False, "error": "not_found"})
            return

        started = time.monotonic()
        try:
            payload = self.read_json_body()
            response = handle_ocr_request(payload, self.config, started)
            self.write_json(200, response)
        except ValueError as exc:
            self.write_json(400, build_error_response(
                request_id=None,
                code="invalid_request",
                message=str(exc),
                started=started,
            ))
        except Exception as exc:  # pragma: no cover - defensive server boundary
            self.write_json(500, build_error_response(
                request_id=None,
                code="worker_failed",
                message=str(exc),
                started=started,
                diagnostics={"traceback": traceback.format_exc(limit=8)},
            ))

    def read_json_body(self) -> Dict[str, Any]:
        content_length = self.headers.get("content-length")
        if content_length is None:
            raise ValueError("Missing content-length header.")

        try:
            byte_length = int(content_length)
        except ValueError as exc:
            raise ValueError("Invalid content-length header.") from exc

        if byte_length <= 0:
            raise ValueError("Empty request body.")

        raw = self.rfile.read(byte_length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body.") from exc

        if not isinstance(parsed, dict):
            raise ValueError("JSON body must be an object.")

        return parsed

    def write_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[rapidocr-worker] " + fmt % args + "\n")


def handle_ocr_request(payload: Dict[str, Any], config: WorkerConfig, started: float) -> Dict[str, Any]:
    request_id = str(payload.get("requestId") or "") or None

    if payload.get("schemaVersion") != REQUEST_SCHEMA_VERSION:
        return build_error_response(
            request_id=request_id,
            code="invalid_schema",
            message="Unsupported request schemaVersion.",
            started=started,
        )

    image = payload.get("image")
    if not isinstance(image, dict):
        return build_error_response(request_id, "invalid_image", "image must be an object.", started)

    engine = load_engine(config.enable_rapidocr)
    if engine is None:
        return build_error_response(
            request_id=request_id,
            code="rapidocr_unavailable",
            message=_IMPORT_ERROR or "RapidOCR is unavailable.",
            started=started,
        )

    try:
        image_input = decode_image_input(image)
        text, confidence, blocks = run_rapidocr(engine, image_input)
        return {
            "schemaVersion": RESPONSE_SCHEMA_VERSION,
            "requestId": request_id,
            "ok": True,
            "provider": PROVIDER,
            "model": MODEL,
            "text": text,
            "confidence": confidence,
            "blocks": blocks,
            "diagnostics": {
                "durationMs": duration_ms(started),
                "engine": "rapidocr",
                "blockCount": len(blocks),
            },
        }
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        return build_error_response(
            request_id=request_id,
            code="ocr_failed",
            message=str(exc),
            started=started,
        )


def decode_image_input(image: Dict[str, Any]) -> Any:
    """Decode the protocol image payload into a RapidOCR-compatible input.

    The Node side currently sends raw crop bytes with dimensions/pixel format.
    RapidOCR accepts paths, arrays, and image-like inputs depending on version.
    This skeleton uses Pillow when available to convert raw bytes to an RGB image.
    """
    bytes_base64 = image.get("bytesBase64")
    width = image.get("width")
    height = image.get("height")
    pixel_format = image.get("pixelFormat")

    if not isinstance(bytes_base64, str) or not bytes_base64:
        raise ValueError("image.bytesBase64 must be a non-empty string.")
    if not isinstance(width, int) or width <= 0:
        raise ValueError("image.width must be a positive integer.")
    if not isinstance(height, int) or height <= 0:
        raise ValueError("image.height must be a positive integer.")
    if pixel_format not in {"grayscale", "rgb", "rgba"}:
        raise ValueError("image.pixelFormat must be grayscale, rgb, or rgba.")

    raw = base64.b64decode(bytes_base64)
    mode = {"grayscale": "L", "rgb": "RGB", "rgba": "RGBA"}[pixel_format]

    try:
        from PIL import Image  # type: ignore
    except Exception as exc:  # pragma: no cover - optional runtime
        raise RuntimeError("Pillow is required by the skeleton worker to decode raw crop bytes.") from exc

    image_obj = Image.frombytes(mode, (width, height), raw)
    if mode != "RGB":
        image_obj = image_obj.convert("RGB")
    return image_obj


def run_rapidocr(engine: Any, image_input: Any) -> Tuple[str, Optional[float], List[Dict[str, Any]]]:
    result = engine(image_input)
    items = normalize_rapidocr_result(result)
    text_lines = [item["text"] for item in items if item["text"]]
    confidences = [item["confidence"] for item in items if isinstance(item.get("confidence"), (int, float))]

    confidence = None
    if confidences:
        confidence = round(sum(float(value) for value in confidences) / len(confidences), 4)

    return "\n".join(text_lines), confidence, items


def normalize_rapidocr_result(result: Any) -> List[Dict[str, Any]]:
    """Best-effort normalization across RapidOCR result shapes."""
    raw_items: Any = result
    if hasattr(result, "txts") and hasattr(result, "scores"):
        txts = list(getattr(result, "txts") or [])
        scores = list(getattr(result, "scores") or [])
        boxes = list(getattr(result, "boxes") or [])
        return [build_block(text, score_at(scores, index), box_at(boxes, index)) for index, text in enumerate(txts)]

    if isinstance(result, tuple) and result:
        raw_items = result[0]

    if raw_items is None:
        return []

    if not isinstance(raw_items, list):
        raw_items = list(raw_items) if isinstance(raw_items, tuple) else []

    blocks: List[Dict[str, Any]] = []
    for item in raw_items:
        if isinstance(item, dict):
            blocks.append(build_block(item.get("text"), item.get("confidence") or item.get("score"), item.get("bbox") or item.get("box")))
            continue

        if isinstance(item, (list, tuple)) and len(item) >= 2:
            box = item[0]
            text_or_pair = item[1]
            if isinstance(text_or_pair, (list, tuple)) and text_or_pair:
                text = text_or_pair[0]
                confidence = text_or_pair[1] if len(text_or_pair) > 1 else None
            else:
                text = text_or_pair
                confidence = item[2] if len(item) > 2 else None
            blocks.append(build_block(text, confidence, box))

    return blocks


def build_block(text: Any, confidence: Any, box: Any) -> Dict[str, Any]:
    return {
        "text": str(text or "").strip(),
        "confidence": clamp_unit_float(confidence),
        "bbox": box_to_bbox(box),
    }


def box_to_bbox(box: Any) -> Optional[Dict[str, int]]:
    if not isinstance(box, (list, tuple)) or len(box) == 0:
        return None

    points: List[Tuple[float, float]] = []
    for point in box:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            try:
                points.append((float(point[0]), float(point[1])))
            except (TypeError, ValueError):
                continue

    if not points:
        return None

    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    left = int(min(xs))
    top = int(min(ys))
    right = int(max(xs))
    bottom = int(max(ys))
    return {
        "x": left,
        "y": top,
        "width": max(0, right - left),
        "height": max(0, bottom - top),
    }


def score_at(values: List[Any], index: int) -> Any:
    return values[index] if index < len(values) else None


def box_at(values: List[Any], index: int) -> Any:
    return values[index] if index < len(values) else None


def clamp_unit_float(value: Any) -> Optional[float]:
    if not isinstance(value, (int, float)):
        return None
    return round(min(max(float(value), 0.0), 1.0), 4)


def build_error_response(
    request_id: Optional[str],
    code: str,
    message: str,
    started: float,
    diagnostics: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return {
        "schemaVersion": RESPONSE_SCHEMA_VERSION,
        "requestId": request_id,
        "ok": False,
        "provider": PROVIDER,
        "model": MODEL,
        "error": {
            "code": code,
            "message": message,
        },
        "text": "",
        "confidence": None,
        "blocks": [],
        "diagnostics": {
            "durationMs": duration_ms(started),
            **(diagnostics or {}),
        },
    }


def duration_ms(started: float) -> int:
    return max(0, int((time.monotonic() - started) * 1000))


def build_handler(config: WorkerConfig) -> type[RapidOcrWorkerHandler]:
    class ConfiguredRapidOcrWorkerHandler(RapidOcrWorkerHandler):
        pass

    ConfiguredRapidOcrWorkerHandler.config = config
    return ConfiguredRapidOcrWorkerHandler


def parse_args(argv: Optional[List[str]] = None) -> WorkerConfig:
    parser = argparse.ArgumentParser(description="PriceVision RapidOCR worker skeleton")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--disable-rapidocr", action="store_true")
    args = parser.parse_args(argv)
    return WorkerConfig(host=args.host, port=args.port, enable_rapidocr=not args.disable_rapidocr)


def main(argv: Optional[List[str]] = None) -> int:
    config = parse_args(argv)
    server = ThreadingHTTPServer((config.host, config.port), build_handler(config))
    print(f"[rapidocr-worker] listening on http://{config.host}:{config.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[rapidocr-worker] stopping", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
