# Image decoder dependencies and boundary

The encoded-file decoder is deliberately isolated from case, extraction, analysis, and clinical-authority logic.

`requirements-image.txt` pins **Pillow 12.3.0** and **pypdfium2 5.13.0**. No donor source, model weights, real ECG datasets, credentials, or clinical evidence are imported.

## Decoder role

`lib/image_decoder.py` accepts a regular local PNG, JPEG, or PDF file and writes only:

- `original.bin` — the exact bytes read after file-identity checks;
- one or more normalized `page-NNNN.png` RGB rasters;
- `decoder-result.json` — source/raster hashes, dimensions, decoder versions, limits, and governed-inactive metadata.

`lib/image_decoder_bridge.js` executes the fixed worker script with `shell:false`, a wall-clock timeout, bounded stdout, fixed canonical page filenames, SHA-256 verification, and automatic temporary-directory cleanup. The normalized PNG is then decoded through the repository's existing strict PNG codec and handed to the canonical image-intake path.

The worker does **not** create cases, extractions, analyses, reports, gold evidence, diagnoses, or runtime authority.

## Limits

Current decoder limits are intentionally conservative:

- source bytes: 32 MiB maximum;
- pages: 8 maximum;
- pixels per page: 4,000,000 maximum;
- aggregate pixels: 8,000,000 maximum;
- single dimension: 4,000 pixels maximum;
- normalized PNG artifact: 16 MiB maximum;
- PDF render DPI: 72–300;
- Node worker deadline: 60 seconds.

JPEG/PNG are accepted by file signature, not extension. Animated/multiframe image input fails closed. EXIF orientation is normalized. Alpha is flattened on white. PDF forms and encrypted/security-handler PDFs fail closed. Native decoder failures are returned as bounded `IMAGE_DECODER_*` errors.

## Security boundary

Pillow and PDFium are native/compiled parsing dependencies. The spawned worker is a process boundary with input/page/pixel/time limits, **not** a hardened OS sandbox or memory cgroup. A network-facing deployment still requires process isolation, access control, dependency patching, and distribution review.

Pillow license information: https://pillow.readthedocs.io/en/stable/about/

pypdfium2 licensing information: https://pypdfium2.readthedocs.io/en/stable/readme.html#licensing

pypdfium2 API/lifecycle information: https://pypdfium2.readthedocs.io/en/stable/python_api.html

Preserve the distributed Pillow, pypdfium2, PDFium, and binary dependency license notices when packaging the decoder. Pinning the wrapper versions is not equivalent to a completed commercial distribution review.
