#!/usr/bin/env python3
"""RapidOCR HTTP worker for PriceVision.

This worker is intentionally outside the Next.js runtime. It accepts the
PriceVision OCR protocol, decodes raw RGB/RGBA/grayscale crop bytes, converts the
crop into a normal RGB PNG image, and sends a RapidOCR-compatible input to the
local RapidOCR engine.

Local install, outside the web app runtime:

    python -m venv .venv-ocr
    . .venv-ocr/bin/activate
    pip install rapidocr onnxruntime pillow
    python tools/ocr-worker/rapidocr_worker.py --host 127.0.0.1 --port 8765

For real photo debugging, keep decoded worker inputs:

    python tools/ocr-worker/rapidocr_worker.py \
      --host 127.0.0.1 \
      --port 8765 \
      --debug-dump-dir tmp/real-photo-runs/worker-inputs
"""

from __future__ import annotations

import argparse
import base64
import json
import numbers
import os
import re
import sys
import tempfile
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
    rapidocr_input_mode: str
    debug_dump_dir: Optional[str]


@dataclass(frozen=True)
class DecodedWorkerImage:
    image: Any
    width: int
    height: int
    source_pixel_format: str
    pil_mode: str
    raw_byte_length: int


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
    server_version = "PriceVisionRapidOCRWorker/0.2"
    config: WorkerConfig

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if self.path == "/health":
            self.write_json(200, {
                "ok": True,
                "provider": PROVIDER,
                "model": MODEL,
                "rapidocrLoaded": _ENGINE is not None,
                "rapidocrError": _IMPORT_ERROR,
                "rapidocrInputMode": self.config.rapidocr_input_mode,
                "debugDumpDir": self.config.debug_dump_dir,
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

    temporary_path: Optional[str] = None
    try:
        decoded = decode_image_input(image)
        rapidocr_input, input_diagnostics, temporary_path = prepare_rapidocr_input(decoded, config, request_id)
        text, confidence, blocks, result_diagnostics = run_rapidocr(engine, rapidocr_input)
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
                "decodedImage": {
                    "width": decoded.width,
                    "height": decoded.height,
                    "sourcePixelFormat": decoded.source_pixel_format,
                    "pilMode": decoded.pil_mode,
                    "rawByteLength": decoded.raw_byte_length,
                },
                **input_diagnostics,
                **result_diagnostics,
            },
        }
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        return build_error_response(
            request_id=request_id,
            code="ocr_failed",
            message=str(exc),
            started=started,
            diagnostics={"traceback": traceback.format_exc(limit=8)},
        )
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def decode_image_input(image: Dict[str, Any]) -> DecodedWorkerImage:
    """Decode protocol image payload into a normal RGB Pillow image."""
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
    expected_lengths = {
        "grayscale": width * height,
        "rgb": width * height * 3,
        "rgba": width * height * 4,
    }
    expected_length = expected_lengths[pixel_format]
    if len(raw) != expected_length:
        raise ValueError(f"image raw byte length {len(raw)} does not match expected {expected_length} for {pixel_format}.")

    mode = {"grayscale": "L", "rgb": "RGB", "rgba": "RGBA"}[pixel_format]

    try:
        from PIL import Image  # type: ignore
    except Exception as exc:  # pragma: no cover - optional runtime
        raise RuntimeError("Pillow is required by the worker to decode raw crop bytes.") from exc

    image_obj = Image.frombytes(mode, (width, height), raw)
    if image_obj.mode != "RGB":
        image_obj = image_obj.convert("RGB")

    return DecodedWorkerImage(
        image=image_obj,
        width=width,
        height=height,
        source_pixel_format=str(pixel_format),
        pil_mode=image_obj.mode,
        raw_byte_length=len(raw),
    )


def prepare_rapidocr_input(
    decoded: DecodedWorkerImage,
    config: WorkerConfig,
    request_id: Optional[str],
) -> Tuple[Any, Dict[str, Any], Optional[str]]:
    """Prepare a RapidOCR-compatible input.

    `path` is the default because it avoids version-specific PIL/ndarray support
    issues in RapidOCR. The worker still supports `pil` and `numpy` as explicit
    debug modes.
    """
    mode = config.rapidocr_input_mode
    diagnostics: Dict[str, Any] = {"rapidocrInputMode": mode}

    if config.debug_dump_dir:
        os.makedirs(config.debug_dump_dir, exist_ok=True)
        dump_path = os.path.join(config.debug_dump_dir, f"{safe_name(request_id or 'request')}.worker-input.png")
        decoded.image.save(dump_path, format="PNG")
        diagnostics["debugDumpPath"] = dump_path

    if mode == "pil":
        diagnostics["rapidocrInputType"] = "PIL.Image.Image"
        return decoded.image, diagnostics, None

    if mode == "numpy":
        try:
            import numpy as np  # type: ignore
        except Exception as exc:  # pragma: no cover - optional runtime
            raise RuntimeError("numpy rapidocr input mode requested, but numpy is unavailable.") from exc
        diagnostics["rapidocrInputType"] = "numpy.ndarray"
        return np.array(decoded.image), diagnostics, None

    # Default/recommended mode: write a regular RGB PNG and pass its path.
    temp = tempfile.NamedTemporaryFile(prefix="pricevision-rapidocr-", suffix=".png", delete=False)
    temporary_path = temp.name
    temp.close()
    decoded.image.save(temporary_path, format="PNG")
    diagnostics["rapidocrInputType"] = "png_path"
    diagnostics["temporaryInputPath"] = temporary_path
    return temporary_path, diagnostics, temporary_path


def run_rapidocr(engine: Any, image_input: Any) -> Tuple[str, Optional[float], List[Dict[str, Any]], Dict[str, Any]]:
    result = engine(image_input)
    items = normalize_rapidocr_result(result)
    text_lines = [item["text"] for item in items if item["text"]]
    confidences = [item["confidence"] for item in items if isinstance(item.get("confidence"), numbers.Real)]

    confidence = None
    if confidences:
        confidence = round(sum(float(value) for value in confidences) / len(confidences), 4)

    diagnostics = {
        "rapidocrResultType": type(result).__name__,
        "rapidocrResultHasTxts": hasattr(result, "txts"),
        "rapidocrResultHasScores": hasattr(result, "scores"),
        "rapidocrResultHasBoxes": hasattr(result, "boxes"),
        "normalizedBlockCount": len(items),
    }
    return "\n".join(text_lines), confidence, items, diagnostics


def normalize_rapidocr_result(result: Any) -> List[Dict[str, Any]]:
    """Best-effort normalization across RapidOCR result shapes.

    RapidOCR versions may expose result.txts/scores/boxes as lists, tuples, or
    numpy arrays. Never use `value or []` for these values: numpy arrays raise
    `ValueError: The truth value of an array with more than one element is ambiguous`.
    """
    raw_items: Any = result
    if hasattr(result, "txts") and hasattr(result, "scores"):
        txts = value_to_list(getattr(result, "txts", None))
        scores = value_to_list(getattr(result, "scores", None))
        boxes = value_to_list(getattr(result, "boxes", None))
        return [build_block(text, score_at(scores, index), box_at(boxes, index)) for index, text in enumerate(txts)]

    if isinstance(result, tuple) and result:
        raw_items = result[0]

    raw_items = value_to_list(raw_items)
    if not raw_items:
        return []

    blocks: List[Dict[str, Any]] = []
    for raw_item in raw_items:
        item = normalize_python_value(raw_item)
        if isinstance(item, dict):
            blocks.append(build_block(item.get("text"), item.get("confidence") or item.get("score"), item.get("bbox") or item.get("box")))
            continue

        if isinstance(item, (list, tuple)) and len(item) >= 2:
            box = item[0]
            text_or_pair = normalize_python_value(item[1])
            if isinstance(text_or_pair, (list, tuple)) and len(text_or_pair) > 0:
                text = text_or_pair[0]
                confidence = text_or_pair[1] if len(text_or_pair) > 1 else None
            else:
                text = text_or_pair
                confidence = item[2] if len(item) > 2 else None
            blocks.append(build_block(text, confidence, box))

    return blocks


def build_block(text: Any, confidence: Any, box: Any) -> Dict[str, Any]:
    return {
        "text": normalize_text(text),
        "confidence": clamp_unit_float(confidence),
        "bbox": box_to_bbox(box),
    }


def box_to_bbox(box: Any) -> Optional[Dict[str, int]]:
    box = normalize_python_value(box)
    if not isinstance(box, (list, tuple)) or len(box) == 0:
        return None

    points: List[Tuple[float, float]] = []
    for raw_point in box:
        point = normalize_python_value(raw_point)
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


def value_to_list(value: Any) -> List[Any]:
    value = normalize_python_value(value)
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    try:
        return list(value)
    except TypeError:
        return []


def normalize_python_value(value: Any) -> Any:
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            return value
    if hasattr(value, "item") and not isinstance(value, (str, bytes, bytearray)):
        try:
            return value.item()
        except Exception:
            return value
    return value


def normalize_text(value: Any) -> str:
    value = normalize_python_value(value)
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def score_at(values: List[Any], index: int) -> Any:
    return values[index] if index < len(values) else None


def box_at(values: List[Any], index: int) -> Any:
    return values[index] if index < len(values) else None


def clamp_unit_float(value: Any) -> Optional[float]:
    value = normalize_python_value(value)
    if not isinstance(value, numbers.Real):
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


def safe_name(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._-")
    return normalized[:120] or "request"


def build_handler(config: WorkerConfig) -> type[RapidOcrWorkerHandler]:
    class ConfiguredRapidOcrWorkerHandler(RapidOcrWorkerHandler):
        pass

    ConfiguredRapidOcrWorkerHandler.config = config
    return ConfiguredRapidOcrWorkerHandler


def parse_args(argv: Optional[List[str]] = None) -> WorkerConfig:
    parser = argparse.ArgumentParser(description="PriceVision RapidOCR worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--disable-rapidocr", action="store_true")
    parser.add_argument("--rapidocr-input-mode", choices=["path", "numpy", "pil"], default="path")
    parser.add_argument("--debug-dump-dir", default=None)
    args = parser.parse_args(argv)
    return WorkerConfig(
        host=args.host,
        port=args.port,
        enable_rapidocr=not args.disable_rapidocr,
        rapidocr_input_mode=args.rapidocr_input_mode,
        debug_dump_dir=args.debug_dump_dir,
    )


def main(argv: Optional[List[str]] = None) -> int:
    config = parse_args(argv)
    server = ThreadingHTTPServer((config.host, config.port), build_handler(config))
    print(
        f"[rapidocr-worker] listening on http://{config.host}:{config.port} "
        f"input_mode={config.rapidocr_input_mode} debug_dump_dir={config.debug_dump_dir}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[rapidocr-worker] stopping", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())