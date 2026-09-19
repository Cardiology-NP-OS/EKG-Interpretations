"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { decodePngToGrayscale, encodeGrayscalePng } = require("./image_png_codec");
const { rotate90 } = require("./image_robustness");
const { rotateArbitraryNearest } = require("./image_geometry_normalization");

const CASE_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
});

const CASE_ID_RE = /^[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_ORIGINAL_BYTES = 32 * 1024 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateCaseId(caseId) {
  requireCondition(typeof caseId === "string" && CASE_ID_RE.test(caseId), "CASE_ID_INVALID");
  return caseId;
}

function fsyncFile(file) {
  const fd = fs.openSync(file, "r");
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function fsyncDirectory(dir) {
  if (process.platform === "win32") return;
  const fd = fs.openSync(dir, "r");
  try { fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function removeStagingDirectory(stage) {
  if (!stage || !fs.existsSync(stage)) return;
  const base = path.basename(stage);
  requireCondition(base.startsWith(".staging-"), "CASE_STAGE_SCOPE");
  fs.rmSync(stage, { recursive: true, force: true });
}

function requireRegularFile(file, code) {
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile() && !stat.isSymbolicLink(), code);
  return stat;
}

function prepareArtifacts(sourceArtifacts) {
  requireCondition(
    sourceArtifacts === undefined ||
    (sourceArtifacts && typeof sourceArtifacts === "object" && !Array.isArray(sourceArtifacts)),
    "CASE_ARTIFACTS_OBJECT_REQUIRED",
  );
  const supplied = sourceArtifacts || {};
  let originalBytes = null;
  if (supplied.originalBytes !== undefined && supplied.originalBytes !== null) {
    requireCondition(
      Buffer.isBuffer(supplied.originalBytes) || supplied.originalBytes instanceof Uint8Array,
      "CASE_ORIGINAL_BYTES_REQUIRED",
    );
    originalBytes = Buffer.isBuffer(supplied.originalBytes)
      ? Buffer.from(supplied.originalBytes)
      : Buffer.from(supplied.originalBytes);
    requireCondition(originalBytes.length > 0 && originalBytes.length <= MAX_ORIGINAL_BYTES, "CASE_ORIGINAL_BYTES_LIMIT");
  }

  let normalizedPng = null;
  if (supplied.normalizedRaster !== undefined && supplied.normalizedRaster !== null) {
    normalizedPng = encodeGrayscalePng(supplied.normalizedRaster);
  }

  return {
    originalBytes,
    normalizedPng,
    summary: {
      original: originalBytes ? {
        file: "original.bin",
        bytes: originalBytes.length,
        sha256: sha256(originalBytes),
      } : null,
      normalizedRaster: normalizedPng ? {
        file: "normalized.png",
        bytes: normalizedPng.length,
        sha256: sha256(normalizedPng),
        encoding: "PNG_GRAYSCALE8_STRICT_SUBSET",
      } : null,
    },
  };
}

function buildRecord(intakeResult, artifactSummary = { original: null, normalizedRaster: null }) {
  requireCondition(intakeResult && intakeResult.report && intakeResult.report.caseId, "CASE_REPORT_REQUIRED");
  validateCaseId(intakeResult.report.caseId);
  requireCondition(intakeResult.report.diagnosticInterpretationIncluded !== true, "CASE_DIAGNOSIS_FORBIDDEN");
  requireCondition(intakeResult.digitized && Array.isArray(intakeResult.digitized.leads), "CASE_DIGITIZED_REQUIRED");
  return {
    schema: "ekg-image-case-v2",
    caseId: intakeResult.report.caseId,
    createdAt: "1970-01-01T00:00:00.000Z",
    report: intakeResult.report,
    digitizedLeads: intakeResult.digitized.leads.map(lead => ({
      lead: lead.lead,
      sampleRateHz: lead.sampleRateHz,
      unit: lead.unit,
      sampleCount: lead.sampleCount,
      rhythmStrip: lead.rhythmStrip,
      quality: lead.quality || null,
    })),
    artifacts: artifactSummary,
    persistence: {
      publication: "ATOMIC_DIRECTORY_RENAME",
      manifestIntegrity: "SHA256_SIDECAR",
      originalBytesPreserved: artifactSummary.original !== null,
      normalizedRasterPreserved: artifactSummary.normalizedRaster !== null,
      immutableExtractionGenerations: false,
    },
    ...CASE_GOVERNANCE,
  };
}

function readImageCase(fileOrDir) {
  requireCondition(typeof fileOrDir === "string" && fileOrDir.length > 0, "CASE_FILE_REQUIRED");
  let manifest = path.resolve(fileOrDir);
  if (fs.existsSync(manifest) && fs.lstatSync(manifest).isDirectory()) manifest = path.join(manifest, "manifest.json");
  requireRegularFile(manifest, "CASE_MANIFEST_REGULAR_FILE_REQUIRED");
  const hashFile = path.join(path.dirname(manifest), "manifest.sha256");
  requireRegularFile(hashFile, "CASE_HASH_REGULAR_FILE_REQUIRED");
  const body = fs.readFileSync(manifest);
  const expected = fs.readFileSync(hashFile, "utf8").trim();
  requireCondition(HASH_RE.test(expected), "CASE_HASH_INVALID");
  requireCondition(sha256(body) === expected, "CASE_MANIFEST_HASH_MISMATCH");

  let record;
  try { record = JSON.parse(body.toString("utf8")); }
  catch (_) { throw new Error("CASE_MANIFEST_JSON"); }

  requireCondition(record && record.schema === "ekg-image-case-v2", "CASE_SCHEMA");
  validateCaseId(record.caseId);
  requireCondition(path.basename(path.dirname(manifest)) === `case-${record.caseId}`, "CASE_DIRECTORY_IDENTITY");
  requireCondition(record.diagnosticInterpretationIncluded === false, "CASE_DIAGNOSIS_FORBIDDEN");
  for (const [key, value] of Object.entries(CASE_GOVERNANCE)) {
    requireCondition(record[key] === value, "CASE_GOVERNANCE");
  }
  requireCondition(
    record.persistence &&
    record.persistence.publication === "ATOMIC_DIRECTORY_RENAME" &&
    record.persistence.manifestIntegrity === "SHA256_SIDECAR",
    "CASE_PERSISTENCE_CONTRACT",
  );
  requireCondition(record.artifacts && typeof record.artifacts === "object", "CASE_ARTIFACTS_MANIFEST");

  for (const key of ["original", "normalizedRaster"]) {
    const artifact = record.artifacts[key];
    const preserved = key === "original"
      ? record.persistence.originalBytesPreserved
      : record.persistence.normalizedRasterPreserved;
    requireCondition((artifact !== null) === preserved, "CASE_ARTIFACT_PRESERVATION_MISMATCH");
    if (artifact === null) continue;
    const expectedFile = key === "original" ? "original.bin" : "normalized.png";
    requireCondition(
      artifact && artifact.file === expectedFile &&
      Number.isInteger(artifact.bytes) && artifact.bytes > 0 &&
      typeof artifact.sha256 === "string" && HASH_RE.test(artifact.sha256),
      "CASE_ARTIFACT_MANIFEST",
    );
    const artifactPath = path.join(path.dirname(manifest), expectedFile);
    const stat = requireRegularFile(artifactPath, "CASE_ARTIFACT_REGULAR_FILE_REQUIRED");
    requireCondition(stat.size === artifact.bytes, "CASE_ARTIFACT_SIZE_MISMATCH");
    requireCondition(sha256(fs.readFileSync(artifactPath)) === artifact.sha256, "CASE_ARTIFACT_HASH_MISMATCH");
  }
  return record;
}

function derivePersistenceArtifacts(intakeInput, intakeResult) {
  requireCondition(
    intakeInput && typeof intakeInput === "object" && !Array.isArray(intakeInput),
    "CASE_INTAKE_INPUT_REQUIRED",
  );
  requireCondition(
    intakeResult && intakeResult.report && Number.isInteger(intakeResult.report.orientationTurns),
    "CASE_INTAKE_RESULT_REQUIRED",
  );

  let normalizedRaster = intakeInput.raster || null;
  if (!normalizedRaster && intakeInput.format === "png" && intakeInput.bytes) {
    normalizedRaster = decodePngToGrayscale(intakeInput.bytes).image;
  }
  requireCondition(
    Array.isArray(normalizedRaster) && normalizedRaster.length > 0,
    "CASE_NORMALIZED_RASTER_REQUIRED",
  );

  const geometry = intakeResult.report.geometryNormalization;
  if (geometry && geometry.deskewApplied === true) {
    requireCondition(
      typeof geometry.deskewCorrectionDegrees === "number" &&
      Number.isFinite(geometry.deskewCorrectionDegrees),
      "CASE_DESKEW_CORRECTION_REQUIRED",
    );
    normalizedRaster = rotateArbitraryNearest(normalizedRaster, {
      degrees: geometry.deskewCorrectionDegrees,
    });
  }
  for (let turn = 0; turn < intakeResult.report.orientationTurns; turn += 1) {
    normalizedRaster = rotate90(normalizedRaster);
  }
  requireCondition(
    normalizedRaster.length === intakeResult.report.rasterHeight &&
    normalizedRaster[0].length === intakeResult.report.rasterWidth,
    "CASE_NORMALIZED_RASTER_DIMENSIONS",
  );

  let originalBytes = null;
  if (intakeInput.bytes !== undefined && intakeInput.bytes !== null) {
    requireCondition(
      Buffer.isBuffer(intakeInput.bytes) || intakeInput.bytes instanceof Uint8Array,
      "CASE_ORIGINAL_BYTES_REQUIRED",
    );
    originalBytes = Buffer.isBuffer(intakeInput.bytes)
      ? Buffer.from(intakeInput.bytes)
      : Buffer.from(intakeInput.bytes);
  }
  return { originalBytes, normalizedRaster };
}

function persistImageIntakeCase(root, intakeInput, intakeResult) {
  return persistImageCase(root, intakeResult, derivePersistenceArtifacts(intakeInput, intakeResult));
}

function persistImageCase(root, intakeResult, sourceArtifacts) {
  requireCondition(typeof root === "string" && root.length > 0, "CASE_ROOT_REQUIRED");
  const rootDir = path.resolve(root);
  fs.mkdirSync(rootDir, { recursive: true });
  requireCondition(fs.lstatSync(rootDir).isDirectory(), "CASE_ROOT_DIRECTORY_REQUIRED");

  const preparedArtifacts = prepareArtifacts(sourceArtifacts);
  const record = buildRecord(intakeResult, preparedArtifacts.summary);
  const body = canonicalJson(record);
  const manifestHash = sha256(Buffer.from(body, "utf8"));
  const finalDir = path.join(rootDir, `case-${record.caseId}`);

  if (fs.existsSync(finalDir)) {
    const existing = readImageCase(finalDir);
    requireCondition(canonicalJson(existing) === body, "CASE_ID_COLLISION");
    return {
      schema: "ekg-image-case-receipt-v2",
      caseId: record.caseId,
      path: path.join(finalDir, "manifest.json"),
      sha256: manifestHash,
      idempotent: true,
      ...CASE_GOVERNANCE,
    };
  }

  const stage = fs.mkdtempSync(path.join(rootDir, ".staging-"));
  try {
    const manifest = path.join(stage, "manifest.json");
    const hashFile = path.join(stage, "manifest.sha256");
    fs.writeFileSync(manifest, body, { encoding: "utf8", flag: "wx" });
    fs.writeFileSync(hashFile, `${manifestHash}\n`, { encoding: "ascii", flag: "wx" });
    if (preparedArtifacts.originalBytes) {
      fs.writeFileSync(path.join(stage, "original.bin"), preparedArtifacts.originalBytes, { flag: "wx" });
      fsyncFile(path.join(stage, "original.bin"));
    }
    if (preparedArtifacts.normalizedPng) {
      fs.writeFileSync(path.join(stage, "normalized.png"), preparedArtifacts.normalizedPng, { flag: "wx" });
      fsyncFile(path.join(stage, "normalized.png"));
    }
    fsyncFile(manifest);
    fsyncFile(hashFile);
    fsyncDirectory(stage);
    fs.renameSync(stage, finalDir);
    fsyncDirectory(rootDir);
  } catch (error) {
    removeStagingDirectory(stage);
    if (fs.existsSync(finalDir)) {
      const existing = readImageCase(finalDir);
      requireCondition(canonicalJson(existing) === body, "CASE_ID_COLLISION");
    } else {
      throw error;
    }
  }

  const reopened = readImageCase(finalDir);
  requireCondition(canonicalJson(reopened) === body, "CASE_REOPEN_MISMATCH");
  return {
    schema: "ekg-image-case-receipt-v2",
    caseId: record.caseId,
    path: path.join(finalDir, "manifest.json"),
    sha256: manifestHash,
    idempotent: false,
    ...CASE_GOVERNANCE,
  };
}

module.exports = {
  CASE_GOVERNANCE,
  buildRecord,
  prepareArtifacts,
  derivePersistenceArtifacts,
  persistImageCase,
  persistImageIntakeCase,
  readImageCase,
};
