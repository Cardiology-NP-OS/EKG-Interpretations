#!/usr/bin/env python3
"""CLI wrapper for the bounded ECG image/PDF decoder."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.image_decoder import DecoderError, decode_source_file  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output_dir")
    parser.add_argument("--dpi", type=int, default=200)
    args = parser.parse_args()
    try:
        result = decode_source_file(args.source, args.output_dir, dpi=args.dpi)
    except DecoderError as exc:
        sys.stderr.write(f"{exc}\n")
        return 2
    sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
