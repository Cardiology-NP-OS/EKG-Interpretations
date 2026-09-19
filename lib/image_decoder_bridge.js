"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const { decodePngToGrayscale } = require("./image_png_codec");

const DECODER_GOVERNANCE = Object.freeze({
  runtimeAuthority: false,
  projectGold: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
});

const HASH_RE = /^[a-f0-9]{64}$/;
const PAGE_FILE_RE = /^page-\d{4}\.png$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const NORMALIZATION = "RGB8_PNG_WHITE_ALPHA_BACKGROUND_EXIF_TRANSPOSE";
const EXPECTED_DECODER_WRAPPERS = Object.freeze({
  Pillow: "12.3.0",
  pypdfium2: "5.13.0",
});
const DECODER_LIMITS = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024,
  maxPages: 8,
  maxPagePixels: 4_000_000,
  maxTotalPixels: 8_000_000,
  maxDimension: 4000,
  maxArtifactBytes: 16 * 1024 * 1024,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function trustedPythonExecutable() {
  const value = process.env.EKG_IMAGE_PYTHON;
  if (!value) return process.platform === "win32" ? "python" : "python3";
  requireCondition(
    typeof value === "string" &&
    value.length > 0 &&
    !/[\r\n\0]/.test(value),
    "IMAGE_DECODER_PYTHON_EXECUTABLE",
  );
  return value;
}

function statIdentity(info) {
  return [info.dev, info.ino, info.size, info.mtimeNs].map(String).join(":");
}

function readRegularFile(file, maxBytes, code) {
  let before;
  let fd = null;
  try {
    before = fs.lstatSync(file, { bigint: true });
    requireCondition(before.isFile() && !before.isSymbolicLink(), code);
    requireCondition(before.size > 0n && before.size <= BigInt(maxBytes), code);
    fd = fs.openSync(file, "r");
    const opened = fs.fstatSync(fd, { bigint: true });
    requireCondition(opened.isFile() && statIdentity(before) === statIdentity(opened), code);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    requireCondition(statIdentity(opened) === statIdentity(after), code);
    requireCondition(bytes.length === Number(after.size), code);
    return bytes;
  } catch (error) {
    if (error && error.message === code) throw error;
    throw new Error(code);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function validateManifest(manifest) {
  requireCondition(
    manifest && typeof manifest === "object" && !Array.isArray(manifest) &&
    Object.getPrototypeOf(manifest) === Object.prototype,
    "IMAGE_DECODER_MANIFEST",
  );
  const governanceKeys = Object.keys(DECODER_GOVERNANCE);
  const expectedKeys = [
    "schema", "sourceFormat", "sourceSha256", "sourceBytes", "pdfDpi",
    "limits", "normalization", "decoder", "pages", ...governanceKeys,
  ];
  requireCondition(
    Object.keys(manifest).length === expectedKeys.length &&
    expectedKeys.every(key => Object.prototype.hasOwnProperty.call(manifest, key)),
    "IMAGE_DECODER_MANIFEST_FIELDS",
  );
  requireCondition(manifest.schema === "ekg-image-decoder-result-v1", "IMAGE_DECODER_MANIFEST");
  requireCondition(["png", "jpeg", "pdf"].includes(manifest.sourceFormat), "IMAGE_DECODER_MANIFEST");
  requireCondition(typeof manifest.sourceSha256 === "string" && HASH_RE.test(manifest.sourceSha256), "IMAGE_DECODER_MANIFEST");
  requireCondition(
    Number.isInteger(manifest.sourceBytes) &&
    manifest.sourceBytes > 0 &&
    manifest.sourceBytes <= MAX_SOURCE_BYTES,
    "IMAGE_DECODER_MANIFEST",
  );
  requireCondition(
    manifest.sourceFormat === "pdf"
      ? Number.isInteger(manifest.pdfDpi) && manifest.pdfDpi >= 72 && manifest.pdfDpi <= 300
      : manifest.pdfDpi === null,
    "IMAGE_DECODER_PDF_DPI",
  );
  requireCondition(
    manifest.normalization === NORMALIZATION,
    "IMAGE_DECODER_NORMALIZATION",
  );
  requireCondition(
    manifest.limits && typeof manifest.limits === "object" && !Array.isArray(manifest.limits) &&
    Object.getPrototypeOf(manifest.limits) === Object.prototype &&
    Object.keys(manifest.limits).length === Object.keys(DECODER_LIMITS).length &&
    Object.entries(DECODER_LIMITS).every(([key, value]) => manifest.limits[key] === value),
    "IMAGE_DECODER_LIMITS",
  );
  requireCondition(
    manifest.decoder && typeof manifest.decoder === "object" && !Array.isArray(manifest.decoder) &&
    Object.getPrototypeOf(manifest.decoder) === Object.prototype,
    "IMAGE_DECODER_IDENTITY",
  );
  const decoderKeys = ["Pillow", "pypdfium2", "pdfium", "implementationSha256"];
  requireCondition(
    Object.keys(manifest.decoder).length === decoderKeys.length &&
    decoderKeys.every(key => Object.prototype.hasOwnProperty.call(manifest.decoder, key)),
    "IMAGE_DECODER_IDENTITY",
  );
  requireCondition(
    manifest.decoder.Pillow === EXPECTED_DECODER_WRAPPERS.Pillow &&
    manifest.decoder.pypdfium2 === EXPECTED_DECODER_WRAPPERS.pypdfium2 &&
    typeof manifest.decoder.pdfium === "string" && manifest.decoder.pdfium.length > 0 &&
    typeof manifest.decoder.implementationSha256 === "string" &&
    HASH_RE.test(manifest.decoder.implementationSha256),
    "IMAGE_DECODER_IDENTITY",
  );
  requireCondition(
    Array.isArray(manifest.pages) &&
    manifest.pages.length >= 1 &&
    manifest.pages.length <= DECODER_LIMITS.maxPages,
    "IMAGE_DECODER_MANIFEST",
  );
  for (const [key, value] of Object.entries(DECODER_GOVERNANCE)) {
    requireCondition(manifest[key] === value, "IMAGE_DECODER_GOVERNANCE");
  }
  let totalPixels = 0;
  manifest.pages.forEach((page, index) => {
    requireCondition(
      page && typeof page === "object" && !Array.isArray(page) &&
      Object.getPrototypeOf(page) === Object.prototype,
      "IMAGE_DECODER_PAGE_MANIFEST",
    );
    const pageKeys = ["pageIndex", "file", "width", "height", "originalOrientation", "rasterSha256", "rasterBytes"];
    requireCondition(
      Object.keys(page).length === pageKeys.length &&
      pageKeys.every(key => Object.prototype.hasOwnProperty.call(page, key)),
      "IMAGE_DECODER_PAGE_MANIFEST_FIELDS",
    );
    requireCondition(page.pageIndex === index, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(page.file === `page-${String(index + 1).padStart(4, "0")}.png`, "IMAGE_DECODER_PAGE_PATH");
    requireCondition(PAGE_FILE_RE.test(page.file), "IMAGE_DECODER_PAGE_PATH");
    requireCondition(Number.isInteger(page.width) && page.width > 0 && page.width <= DECODER_LIMITS.maxDimension, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(Number.isInteger(page.height) && page.height > 0 && page.height <= DECODER_LIMITS.maxDimension, "IMAGE_DECODER_PAGE_MANIFEST");
    const pixels = page.width * page.height;
    requireCondition(pixels <= DECODER_LIMITS.maxPagePixels, "IMAGE_DECODER_PAGE_MANIFEST");
    totalPixels += pixels;
    requireCondition(totalPixels <= DECODER_LIMITS.maxTotalPixels, "IMAGE_DECODER_TOTAL_PIXELS");
    requireCondition(
      Number.isInteger(page.originalOrientation) &&
      page.originalOrientation >= 0 &&
      page.originalOrientation <= 8,
      "IMAGE_DECODER_PAGE_ORIENTATION",
    );
    requireCondition(Number.isInteger(page.rasterBytes) && page.rasterBytes > 0 && page.rasterBytes <= MAX_PAGE_BYTES, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(typeof page.rasterSha256 === "string" && HASH_RE.test(page.rasterSha256), "IMAGE_DECODER_PAGE_MANIFEST");
  });
  return manifest;
}
function decodeImageSourceFile(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "IMAGE_DECODER_INPUT_REQUIRED");
  requireCondition(typeof input.sourcePath === "string" && input.sourcePath.length > 0, "IMAGE_DECODER_SOURCE_PATH");
  const dpi = input.pdfDpi === undefined ? 200 : input.pdfDpi;
  requireCondition(Number.isInteger(dpi) && dpi >= 72 && dpi <= 300, "IMAGE_DECODER_PDF_DPI");

  const worker = path.resolve(__dirname, "..", "tools", "decode_image_source.py");
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-decode-"));
  try {
    const run = cp.spawnSync(
      trustedPythonExecutable(),
      [worker, path.resolve(input.sourcePath), outputDir, "--dpi", String(dpi)],
      {
        encoding: "utf8",
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_MANIFEST_BYTES,
        windowsHide: true,
        shell: false,
      },
    );
    requireCondition(!run.error || run.error.code !== "ETIMEDOUT", "IMAGE_DECODER_TIMEOUT");
    requireCondition(!run.error, "IMAGE_DECODER_WORKER_FAILED");
    if (run.status !== 0) {
      const code = String(run.stderr || "").trim().split(/\s+/)[0];
      throw new Error(code && /^IMAGE_DECODER_[A-Z0-9_]+$/.test(code) ? code : "IMAGE_DECODER_WORKER_FAILED");
    }

    const manifestBytes = readRegularFile(
      path.join(outputDir, "decoder-result.json"),
      MAX_MANIFEST_BYTES,
      "IMAGE_DECODER_MANIFEST_FILE",
    );
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
    catch (_) { throw new Error("IMAGE_DECODER_MANIFEST_JSON"); }
    validateManifest(manifest);

    const originalBytes = readRegularFile(
      path.join(outputDir, "original.bin"),
      MAX_SOURCE_BYTES,
      "IMAGE_DECODER_SOURCE_ARTIFACT",
    );
    requireCondition(originalBytes.length === manifest.sourceBytes, "IMAGE_DECODER_SOURCE_SIZE_MISMATCH");
    requireCondition(sha256(originalBytes) === manifest.sourceSha256, "IMAGE_DECODER_SOURCE_HASH_MISMATCH");

    const pages = manifest.pages.map(page => {
      const file = path.join(outputDir, page.file);
      requireCondition(path.dirname(file) === outputDir, "IMAGE_DECODER_PAGE_PATH");
      const bytes = readRegularFile(file, MAX_PAGE_BYTES, "IMAGE_DECODER_PAGE_FILE");
      requireCondition(bytes.length === page.rasterBytes, "IMAGE_DECODER_PAGE_SIZE_MISMATCH");
      requireCondition(sha256(bytes) === page.rasterSha256, "IMAGE_DECODER_PAGE_HASH_MISMATCH");
      const decoded = decodePngToGrayscale(bytes);
      requireCondition(
        decoded.width === page.width && decoded.height === page.height,
        "IMAGE_DECODER_PAGE_GEOMETRY_MISMATCH",
      );
      return {
        ...page,
        raster: decoded.image,
        normalizedPngBytes: bytes,
      };
    });

    return {
      schema: "ekg-image-decoder-bridge-v1",
      sourceFormat: manifest.sourceFormat,
      sourceSha256: manifest.sourceSha256,
      sourceBytes: manifest.sourceBytes,
      originalBytes,
      pages,
      decoder: manifest.decoder,
      normalization: manifest.normalization,
      ...DECODER_GOVERNANCE,
    };
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

module.exports = {
  DECODER_GOVERNANCE,
  DECODER_LIMITS,
  EXPECTED_DECODER_WRAPPERS,
  NORMALIZATION,
  decodeImageSourceFile,
  readRegularFile,
  validateManifest,
};
