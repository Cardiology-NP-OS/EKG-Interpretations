"""Bounded native decoder for ECG image/PDF source files.

This module only decodes and normalizes source bytes. It does not create cases,
extractions, analyses, clinical claims, or runtime authority.
"""
from __future__ import annotations

import hashlib
import importlib.metadata
import io
import json
import math
import os
import re
from contextlib import closing
from pathlib import Path
import stat
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw

GOVERNANCE = {
    "runtimeAuthority": False,
    "projectGold": False,
    "diagnosticRuntime": "GOVERNED_INACTIVE",
    "evidenceAdmission": "NOT_ADMITTED",
    "metrics": "NOT_REPORTABLE",
    "activation": "NOT_ELIGIBLE",
    "clinicalValidityInferred": False,
    "diagnosticInterpretationIncluded": False,
}

LIMITS = {
    "maxInputBytes": 32 * 1024 * 1024,
    "maxPages": 8,
    "maxPagePixels": 4_000_000,
    "maxTotalPixels": 8_000_000,
    "maxDimension": 4000,
    "maxArtifactBytes": 16 * 1024 * 1024,
}

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8"
PDF_SIGNATURE = b"%PDF-"
PAGE_FILE_RE = re.compile(r"page-\d{4}\.png\Z")


class DecoderError(ValueError):
    pass


def check(condition: bool, code: str) -> None:
    if not condition:
        raise DecoderError(code)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_json(value: object) -> bytes:
    try:
        return (
            json.dumps(
                value,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
                ensure_ascii=True,
            )
            + "\n"
        ).encode("ascii")
    except (ValueError, TypeError, RecursionError) as exc:
        raise DecoderError("IMAGE_DECODER_JSON_INVALID") from exc


def _regular_file(path: Path) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as exc:
        raise DecoderError("IMAGE_DECODER_SOURCE_READ_FAILED") from exc
    check(
        stat.S_ISREG(info.st_mode)
        and not (getattr(info, "st_file_attributes", 0) & 0x400),
        "IMAGE_DECODER_SOURCE_REGULAR_FILE_REQUIRED",
    )
    return info


def read_source_bytes(path: Path) -> bytes:
    before = _regular_file(path)
    check(0 < before.st_size <= LIMITS["maxInputBytes"], "IMAGE_DECODER_INPUT_BYTES_LIMIT")
    try:
        with path.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            identity = lambda value: (
                value.st_dev,
                value.st_ino,
                value.st_size,
                value.st_mtime_ns,
            )
            check(
                stat.S_ISREG(opened.st_mode) and identity(before) == identity(opened),
                "IMAGE_DECODER_SOURCE_CHANGED",
            )
            raw = stream.read(LIMITS["maxInputBytes"] + 1)
            check(
                identity(opened) == identity(os.fstat(stream.fileno())),
                "IMAGE_DECODER_SOURCE_CHANGED",
            )
    except DecoderError:
        raise
    except OSError as exc:
        raise DecoderError("IMAGE_DECODER_SOURCE_READ_FAILED") from exc
    check(0 < len(raw) <= LIMITS["maxInputBytes"], "IMAGE_DECODER_INPUT_BYTES_LIMIT")
    return raw


def _output_directory(path: Path) -> Path:
    try:
        info = path.lstat()
    except OSError as exc:
        raise DecoderError("IMAGE_DECODER_OUTPUT_DIRECTORY_REQUIRED") from exc
    check(
        stat.S_ISDIR(info.st_mode)
        and not (getattr(info, "st_file_attributes", 0) & 0x400),
        "IMAGE_DECODER_OUTPUT_DIRECTORY_REQUIRED",
    )
    try:
        check(not any(path.iterdir()), "IMAGE_DECODER_OUTPUT_NOT_EMPTY")
    except OSError as exc:
        raise DecoderError("IMAGE_DECODER_OUTPUT_DIRECTORY_REQUIRED") from exc
    return path


def _dimensions(width: int, height: int, total: int = 0) -> int:
    check(
        type(width) is int
        and type(height) is int
        and 1 <= width <= LIMITS["maxDimension"]
        and 1 <= height <= LIMITS["maxDimension"],
        "IMAGE_DECODER_PIXELS_LIMIT",
    )
    pixels = width * height
    check(
        pixels <= LIMITS["maxPagePixels"]
        and total + pixels <= LIMITS["maxTotalPixels"],
        "IMAGE_DECODER_PIXELS_LIMIT",
    )
    return pixels


def _write_bytes(path: Path, raw: bytes) -> None:
    check(len(raw) <= LIMITS["maxArtifactBytes"], "IMAGE_DECODER_OUTPUT_BYTES_LIMIT")
    try:
        with path.open("xb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError as exc:
        raise DecoderError("IMAGE_DECODER_OUTPUT_WRITE_FAILED") from exc


def _cleanup_output(path: Path) -> None:
    allowed = {"original.bin", "decoder-result.json"}
    try:
        for item in path.iterdir():
            if item.name in allowed or PAGE_FILE_RE.fullmatch(item.name):
                try:
                    info = item.lstat()
                    if stat.S_ISREG(info.st_mode) and not item.is_symlink():
                        item.unlink()
                except OSError:
                    pass
    except OSError:
        pass


def _png_bytes(image: Image.Image) -> bytes:
    clean = Image.new("RGB", image.size, "white")
    clean.paste(image)
    try:
        stream = io.BytesIO()
        clean.save(stream, format="PNG", compress_level=6, optimize=False)
        return stream.getvalue()
    finally:
        clean.close()


def _detect_format(raw: bytes) -> str:
    if raw.startswith(PDF_SIGNATURE):
        return "pdf"
    if raw.startswith(PNG_SIGNATURE):
        return "png"
    if raw.startswith(JPEG_SIGNATURE):
        return "jpeg"
    raise DecoderError("IMAGE_DECODER_FORMAT_UNSUPPORTED")


def _decode_pdf(raw: bytes, dpi: int):
    check(type(dpi) is int and 72 <= dpi <= 300, "IMAGE_DECODER_PDF_DPI")
    try:
        with pdfium.PdfDocument(raw) as document:
            check(
                pdfium_raw.FPDF_GetSecurityHandlerRevision(document) < 0,
                "IMAGE_DECODER_PDF_ENCRYPTED",
            )
            check(document.get_formtype() == 0, "IMAGE_DECODER_PDF_FORMS_UNSUPPORTED")
            check(1 <= len(document) <= LIMITS["maxPages"], "IMAGE_DECODER_PAGE_LIMIT")
            total = 0
            for index in range(len(document)):
                with closing(document[index]) as page:
                    width_pt, height_pt = page.get_size()
                    check(
                        math.isfinite(width_pt)
                        and math.isfinite(height_pt)
                        and 1 <= width_pt <= 100000
                        and 1 <= height_pt <= 100000,
                        "IMAGE_DECODER_PIXELS_LIMIT",
                    )
                    scale = dpi / 72
                    width = math.ceil(width_pt * scale)
                    height = math.ceil(height_pt * scale)
                    pixels = _dimensions(width, height, total)
                    with closing(page.render(scale=scale, draw_annots=True)) as bitmap:
                        image = bitmap.to_pil().convert("RGB")
                        try:
                            _dimensions(image.width, image.height, total)
                            total += pixels
                            yield index, image.copy(), 0
                        finally:
                            image.close()
    except DecoderError:
        raise
    except Exception as exc:
        raise DecoderError("IMAGE_DECODER_PDF_INVALID") from exc


def _decode_image(raw: bytes, source_format: str):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw), formats=["PNG", "JPEG"]) as source:
                check(
                    (source_format == "png" and source.format == "PNG")
                    or (source_format == "jpeg" and source.format == "JPEG"),
                    "IMAGE_DECODER_FORMAT_MISMATCH",
                )
                _dimensions(*source.size)
                check(getattr(source, "n_frames", 1) == 1, "IMAGE_DECODER_ANIMATION_UNSUPPORTED")
                orientation = source.getexif().get(274, 1)
                source.load()
                oriented = ImageOps.exif_transpose(source)
                try:
                    rgba = oriented.convert("RGBA")
                    try:
                        background = Image.new("RGBA", rgba.size, "white")
                        try:
                            image = Image.alpha_composite(background, rgba).convert("RGB")
                            yield 0, image, orientation
                        finally:
                            background.close()
                    finally:
                        rgba.close()
                finally:
                    oriented.close()
    except DecoderError:
        raise
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise DecoderError("IMAGE_DECODER_PIXELS_LIMIT") from exc
    except (OSError, ValueError, UnidentifiedImageError) as exc:
        raise DecoderError("IMAGE_DECODER_IMAGE_INVALID") from exc


def decode_source_file(source: str | Path, output_dir: str | Path, dpi: int = 200) -> dict:
    source_path = Path(source).absolute()
    out = _output_directory(Path(output_dir).absolute())
    try:
        raw = read_source_bytes(source_path)
        source_format = _detect_format(raw)

        _write_bytes(out / "original.bin", raw)

        pages = []
        iterator = _decode_pdf(raw, dpi) if source_format == "pdf" else _decode_image(raw, source_format)
        for index, image, orientation in iterator:
            try:
                name = f"page-{index + 1:04d}.png"
                png = _png_bytes(image)
                _write_bytes(out / name, png)
                pages.append(
                    {
                        "pageIndex": index,
                        "file": name,
                        "width": image.width,
                        "height": image.height,
                        "originalOrientation": orientation,
                        "rasterSha256": sha256(png),
                        "rasterBytes": len(png),
                    }
                )
            finally:
                image.close()

        check(bool(pages), "IMAGE_DECODER_PAGE_LIMIT")
        check(len(pages) <= LIMITS["maxPages"], "IMAGE_DECODER_PAGE_LIMIT")

        manifest = {
            "schema": "ekg-image-decoder-result-v1",
            "sourceFormat": source_format,
            "sourceSha256": sha256(raw),
            "sourceBytes": len(raw),
            "pdfDpi": dpi if source_format == "pdf" else None,
            "limits": dict(LIMITS),
            "normalization": "RGB8_PNG_WHITE_ALPHA_BACKGROUND_EXIF_TRANSPOSE",
            "decoder": {
                "Pillow": importlib.metadata.version("Pillow"),
                "pypdfium2": str(pdfium.PYPDFIUM_INFO),
                "pdfium": str(pdfium.PDFIUM_INFO),
                "implementationSha256": sha256(Path(__file__).read_bytes()),
            },
            "pages": pages,
            **GOVERNANCE,
        }
        _write_bytes(out / "decoder-result.json", canonical_json(manifest))
        return manifest
    except Exception:
        _cleanup_output(out)
        raise
