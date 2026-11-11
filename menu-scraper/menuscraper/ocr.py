"""Text recognition for menu photos and scanned pages: RapidOCR (PaddleOCR's models on ONNX Runtime, CPU only).

The website uses it two ways (relay-worker.js /api/server/ocr):
  - a second opinion on Claude's reading: prices Claude listed that OCR didn't see are flagged for a human check;
  - the reader itself when Claude isn't on, in place of the browser's Tesseract (better on photos and columns).

Returns every text line with its box, in image pixels (y grows downwards), plus the image size.
Set ENABLE_OCR=0 to turn it off. The models load on first use (about 15 MB, kept in memory).
"""
from __future__ import annotations

import io
import logging
import os
import threading

log = logging.getLogger(__name__)

MAX_SIDE = int(os.getenv("OCR_MAX_SIDE", "3000"))   # bigger pictures are shrunk first: slower, no more readable
_engine = None
_lock = threading.Lock()


def available() -> bool:
    if os.getenv("ENABLE_OCR", "1") == "0":
        return False
    try:
        import rapidocr  # noqa: F401
        return True
    except ImportError:
        return False


def _get():
    global _engine
    with _lock:
        if _engine is None:
            from rapidocr import RapidOCR
            _engine = RapidOCR()
        return _engine


def read(data: bytes) -> dict:
    """Recognise the text in one picture (JPG, PNG, WebP or GIF bytes)."""
    import numpy as np
    from PIL import Image, ImageOps

    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    scale = min(1.0, MAX_SIDE / max(img.size))
    if scale < 1.0:
        img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    w, h = img.size
    out = _get()(np.asarray(img))
    lines = []
    boxes, txts, scores = getattr(out, "boxes", None), getattr(out, "txts", None), getattr(out, "scores", None)
    if boxes is not None and txts:
        for box, text, score in zip(boxes, txts, scores):
            xs, ys = [float(p[0]) for p in box], [float(p[1]) for p in box]
            text = str(text).strip()
            if text:
                lines.append({"text": text, "box": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
                              "score": round(float(score), 3)})
    log.info("ocr read %d lines from a %dx%d picture", len(lines), w, h)
    return {"width": w, "height": h, "lines": lines}
