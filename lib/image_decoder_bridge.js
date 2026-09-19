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

function readRegularFile(file, maxBytes, code) {
  let info;
  try { info = fs.lstatSync(file); }
  catch (_) { throw new Error(code); }
  requireCondition(info.isFile() && !info.isSymbolicLink(), code);
  requireCondition(info.size > 0 && info.size <= maxBytes, code);
  return fs.readFileSync(file);
}

function validateManifest(manifest) {
  requireCondition(
    manifest && typeof manifest === "object" && !Array.isArray(manifest),
    "IMAGE_DECODER_MANIFEST",
  );
  requireCondition(manifest.schema === "ekg-image-decoder-result-v1", "IMAGE_DECODER_MANIFEST");
  requireCondition(["png", "jpeg", "pdf"].includes(manifest.sourceFormat), "IMAGE_DECODER_MANIFEST");
  requireCondition(HASH_RE.test(manifest.sourceSha256), "IMAGE_DECODER_MANIFEST");
  requireCondition(
    Number.isInteger(manifest.sourceBytes) &&
    manifest.sourceBytes > 0 &&
    manifest.sourceBytes <= MAX_SOURCE_BYTES,
    "IMAGE_DECODER_MANIFEST",
  );
  requireCondition(
    Array.isArray(manifest.pages) &&
    manifest.pages.length >= 1 &&
    manifest.pages.length <= 8,
    "IMAGE_DECODER_MANIFEST",
  );
  for (const [key, value] of Object.entries(DECODER_GOVERNANCE)) {
    requireCondition(manifest[key] === value, "IMAGE_DECODER_GOVERNANCE");
  }
  manifest.pages.forEach((page, index) => {
    requireCondition(page && typeof page === "object" && !Array.isArray(page), "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(page.pageIndex === index, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(page.file === `page-${String(index + 1).padStart(4, "0")}.png`, "IMAGE_DECODER_PAGE_PATH");
    requireCondition(PAGE_FILE_RE.test(page.file), "IMAGE_DECODER_PAGE_PATH");
    requireCondition(Number.isInteger(page.width) && page.width > 0 && page.width <= 4000, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(Number.isInteger(page.height) && page.height > 0 && page.height <= 4000, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(page.width * page.height <= 4_000_000, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(Number.isInteger(page.rasterBytes) && page.rasterBytes > 0 && page.rasterBytes <= MAX_PAGE_BYTES, "IMAGE_DECODER_PAGE_MANIFEST");
    requireCondition(HASH_RE.test(page.rasterSha256), "IMAGE_DECODER_PAGE_MANIFEST");
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
  decodeImageSourceFile,
  validateManifest,
};
