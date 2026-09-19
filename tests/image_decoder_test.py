"""Bounded JPEG/PDF decoder tests using generated fixtures only."""
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from lib.image_decoder import DecoderError, decode_source_file, read_source_bytes  # noqa: E402


class ImageDecoderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.out = self.root / "out"
        self.out.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def reset_out(self):
        for child in self.out.iterdir():
            child.unlink()

    def test_jpeg_exif_orientation_normalizes_without_mutating_source(self):
        source = self.root / "rotated.jpg"
        image = Image.new("RGB", (40, 20), "white")
        ImageDraw.Draw(image).rectangle((0, 0, 9, 9), fill="black")
        exif = Image.Exif()
        exif[274] = 6
        image.save(source, "JPEG", quality=95, exif=exif)
        original = source.read_bytes()

        result = decode_source_file(source, self.out)
        self.assertEqual(result["sourceFormat"], "jpeg")
        self.assertEqual(result["pages"][0]["originalOrientation"], 6)
        self.assertEqual((result["pages"][0]["width"], result["pages"][0]["height"]), (20, 40))
        self.assertEqual((self.out / "original.bin").read_bytes(), original)
        with Image.open(self.out / result["pages"][0]["file"]) as normalized:
            self.assertEqual(normalized.mode, "RGB")
            self.assertFalse(normalized.getexif())
            self.assertEqual(normalized.size, (20, 40))
        self.assertFalse(result["runtimeAuthority"])
        self.assertFalse(result["diagnosticInterpretationIncluded"])

    def test_transparent_png_composites_over_white(self):
        source = self.root / "transparent.png"
        image = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
        image.putpixel((5, 5), (0, 0, 0, 255))
        image.save(source)

        result = decode_source_file(source, self.out)
        with Image.open(self.out / result["pages"][0]["file"]) as normalized:
            self.assertEqual(normalized.getpixel((0, 0)), (255, 255, 255))
            self.assertEqual(normalized.getpixel((5, 5)), (0, 0, 0))

    def test_pdf_pages_are_bounded_rasterized_and_preserved(self):
        source = self.root / "two-pages.pdf"
        first = Image.new("RGB", (240, 120), "white")
        ImageDraw.Draw(first).line((0, 60, 239, 60), fill="black", width=2)
        second = Image.new("RGB", (100, 60), "white")
        first.save(source, "PDF", resolution=72, save_all=True, append_images=[second])
        original = source.read_bytes()

        result = decode_source_file(source, self.out, dpi=72)
        self.assertEqual(result["sourceFormat"], "pdf")
        self.assertEqual(len(result["pages"]), 2)
        self.assertEqual([(p["width"], p["height"]) for p in result["pages"]], [(240, 120), (100, 60)])
        self.assertEqual((self.out / "original.bin").read_bytes(), original)

    def test_unsupported_corrupt_animated_and_nonempty_output_fail_closed(self):
        unsupported = self.root / "input.gif"
        Image.new("RGB", (10, 10), "white").save(unsupported, "GIF")
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_FORMAT_UNSUPPORTED"):
            decode_source_file(unsupported, self.out)

        corrupt = self.root / "corrupt.jpg"
        corrupt.write_bytes(b"\xff\xd8broken")
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_IMAGE_INVALID"):
            decode_source_file(corrupt, self.out)

        animated = self.root / "animated.png"
        Image.new("RGB", (10, 10), "white").save(
            animated,
            "PNG",
            save_all=True,
            append_images=[Image.new("RGB", (10, 10), "black")],
            duration=100,
            loop=0,
        )
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_ANIMATION_UNSUPPORTED"):
            decode_source_file(animated, self.out)

        self.reset_out()
        (self.out / "occupied").write_text("x", encoding="utf-8")
        valid = self.root / "valid.png"
        Image.new("RGB", (10, 10), "white").save(valid)
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_OUTPUT_NOT_EMPTY"):
            decode_source_file(valid, self.out)

    def test_pixel_page_and_input_budgets_fail_before_success(self):
        self.reset_out()
        large = self.root / "large.png"
        Image.new("RGB", (2100, 2000), "white").save(large)
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_PIXELS_LIMIT"):
            decode_source_file(large, self.out)

        self.reset_out()
        pages = self.root / "nine.pdf"
        first = Image.new("RGB", (20, 20), "white")
        first.save(
            pages,
            "PDF",
            resolution=72,
            save_all=True,
            append_images=[Image.new("RGB", (20, 20), "white") for _ in range(8)],
        )
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_PAGE_LIMIT"):
            decode_source_file(pages, self.out, dpi=72)

        self.reset_out()
        oversized = self.root / "oversized.png"
        oversized.write_bytes(b"\x89PNG\r\n\x1a\n" + b"x" * (32 * 1024 * 1024))
        with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_INPUT_BYTES_LIMIT"):
            decode_source_file(oversized, self.out)

    def test_source_replacement_between_stat_and_open_is_rejected(self):
        source = self.root / "source.png"
        other = self.root / "other.png"
        Image.new("RGB", (10, 10), "white").save(source)
        Image.new("RGB", (11, 10), "black").save(other)
        original_open = Path.open

        def swapped(path, *args, **kwargs):
            return original_open(other if path == source else path, *args, **kwargs)

        with patch.object(Path, "open", swapped):
            with self.assertRaisesRegex(DecoderError, "IMAGE_DECODER_SOURCE_CHANGED"):
                read_source_bytes(source)

    def test_manifest_is_canonical_and_contains_decoder_identity(self):
        source = self.root / "source.png"
        Image.new("RGB", (12, 8), "white").save(source)
        result = decode_source_file(source, self.out)
        raw = (self.out / "decoder-result.json").read_bytes()
        parsed = json.loads(raw)
        self.assertEqual(parsed, result)
        self.assertEqual(raw[-1:], b"\n")
        self.assertIn("implementationSha256", result["decoder"])
        self.assertEqual(len(result["decoder"]["implementationSha256"]), 64)


if __name__ == "__main__":
    unittest.main(verbosity=2)
