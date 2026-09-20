"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { CASE_GOVERNANCE, readImageCase } = require("./image_case_store");

const EXTRACTION_ID_RE = /^extract-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_LEADS = 64;
const MAX_TOTAL_SAMPLES = 2_000_000;
const MAX_EXTRACTION_BYTES = 32 * 1024 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function regularFile(file, code) {
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (_) { throw new Error(code); }
  requireCondition(stat.isFile() && !stat.isSymbolicLink(), code);
  return stat;
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

function caseDirectory(fileOrDir) {
  const resolved = path.resolve(fileOrDir);
  const dir = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  const record = readImageCase(dir);
  return { dir, record };
}

function validateAnalysisPermissions(value) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype,
    "EXTRACTION_ANALYSIS_PERMISSIONS",
  );
  const keys = [
    "safePartialAnalysisAllowed",
    "exactTimeMeasurementAllowed",
    "exactVoltageMeasurementAllowed",
    "specificLeadClaimsAllowed",
    "twelveLeadClaimsAllowed",
    "measurementsReliable",
  ];
  requireCondition(
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)),
    "EXTRACTION_ANALYSIS_PERMISSIONS_FIELDS",
  );
  for (const key of keys) {
    requireCondition(typeof value[key] === "boolean", "EXTRACTION_ANALYSIS_PERMISSIONS");
  }
  return value;
}

function validateLead(lead, budget) {
  requireCondition(lead && typeof lead === "object" && !Array.isArray(lead), "EXTRACTION_LEAD");
  requireCondition(typeof lead.lead === "string" && lead.lead.length > 0 && lead.lead.length <= 32, "EXTRACTION_LEAD_NAME");
  requireCondition(typeof lead.sampleRateHz === "number" && Number.isFinite(lead.sampleRateHz) && lead.sampleRateHz > 0, "EXTRACTION_SAMPLE_RATE");
  requireCondition(lead.unit === "mV", "EXTRACTION_UNIT");
  requireCondition(Array.isArray(lead.samples) && lead.samples.length > 0, "EXTRACTION_SAMPLES");
  budget.samples += lead.samples.length;
  requireCondition(budget.samples <= MAX_TOTAL_SAMPLES, "EXTRACTION_SAMPLE_BUDGET");
  for (const value of lead.samples) requireCondition(typeof value === "number" && Number.isFinite(value), "EXTRACTION_NONFINITE_SAMPLE");
  requireCondition(Number.isInteger(lead.baselineY), "EXTRACTION_BASELINE");
  if (lead.paperWindow !== null && lead.paperWindow !== undefined) {
    requireCondition(
      lead.paperWindow && typeof lead.paperWindow === "object" &&
      Number.isInteger(lead.paperWindow.row) && lead.paperWindow.row >= 0 &&
      Number.isInteger(lead.paperWindow.col) && lead.paperWindow.col >= 0 &&
      typeof lead.paperWindow.startSeconds === "number" && Number.isFinite(lead.paperWindow.startSeconds) && lead.paperWindow.startSeconds >= 0 &&
      typeof lead.paperWindow.durationSeconds === "number" && Number.isFinite(lead.paperWindow.durationSeconds) && lead.paperWindow.durationSeconds > 0 &&
      typeof lead.paperWindow.rhythmStrip === "boolean" &&
      lead.paperWindow.source === "ROI_LAYOUT_METADATA",
      "EXTRACTION_PAPER_WINDOW",
    );
  }
  requireCondition(lead.quality && typeof lead.quality === "object", "EXTRACTION_QUALITY");
}

function buildExtraction(caseRecord, intakeResult) {
  requireCondition(intakeResult && intakeResult.report && intakeResult.digitized, "EXTRACTION_INPUT_REQUIRED");
  requireCondition(intakeResult.report.caseId === caseRecord.caseId, "EXTRACTION_CASE_MISMATCH");
  requireCondition(intakeResult.report.diagnosticInterpretationIncluded === false, "EXTRACTION_DIAGNOSIS_FORBIDDEN");
  requireCondition(Array.isArray(intakeResult.digitized.leads) && intakeResult.digitized.leads.length >= 1, "EXTRACTION_LEADS_REQUIRED");
  requireCondition(intakeResult.digitized.leads.length <= MAX_LEADS, "EXTRACTION_LEAD_BUDGET");
  const analysisPermissions = validateAnalysisPermissions(intakeResult.report.analysisPermissions);

  const budget = { samples: 0 };
  for (const lead of intakeResult.digitized.leads) validateLead(lead, budget);

  const base = {
    schema: "ekg-image-extraction-v2",
    caseId: caseRecord.caseId,
    source: {
      sourceKind: intakeResult.report.sourceKind,
      format: intakeResult.report.format,
      locator: intakeResult.report.locator,
      orientationTurns: intakeResult.report.orientationTurns,
      roiSource: intakeResult.report.roiSource,
    },
    calibration: intakeResult.report.calibration,
    analysisPermissions,
    preflight: intakeResult.report.preflight,
    sampleRateHz: intakeResult.digitized.sampleRateHz,
    unit: intakeResult.digitized.unit,
    leads: intakeResult.digitized.leads.map(lead => ({
      lead: lead.lead,
      rhythmStrip: lead.rhythmStrip === true,
      sampleRateHz: lead.sampleRateHz,
      unit: lead.unit,
      samples: lead.samples,
      sampleCount: lead.sampleCount,
      baselineY: lead.baselineY,
      paperWindow: lead.paperWindow || null,
      quality: lead.quality,
    })),
    totalSamples: budget.samples,
    diagnosticInterpretationIncluded: false,
    ...CASE_GOVERNANCE,
  };
  const extractionId = `extract-${sha256(Buffer.from(canonicalJson(base), "utf8"))}`;
  return { ...base, extractionId };
}

function verifyExtractionIdentity(artifact) {
  requireCondition(artifact && artifact.schema === "ekg-image-extraction-v2", "EXTRACTION_SCHEMA");
  requireCondition(typeof artifact.extractionId === "string" && EXTRACTION_ID_RE.test(artifact.extractionId), "EXTRACTION_ID");
  const { extractionId, ...base } = artifact;
  requireCondition(
    extractionId === `extract-${sha256(Buffer.from(canonicalJson(base), "utf8"))}`,
    "EXTRACTION_IDENTITY",
  );
  for (const [key, value] of Object.entries(CASE_GOVERNANCE)) {
    requireCondition(artifact[key] === value, "EXTRACTION_GOVERNANCE");
  }
}

function readImageExtraction(fileOrDir, extractionId) {
  requireCondition(typeof extractionId === "string" && EXTRACTION_ID_RE.test(extractionId), "EXTRACTION_ID");
  const { dir: caseDir, record } = caseDirectory(fileOrDir);
  const extractionDir = path.join(caseDir, "extractions", extractionId);
  requireCondition(path.basename(extractionDir) === extractionId, "EXTRACTION_PATH");
  const artifactFile = path.join(extractionDir, "extraction.json");
  const hashFile = path.join(extractionDir, "extraction.sha256");
  const stat = regularFile(artifactFile, "EXTRACTION_FILE_REQUIRED");
  requireCondition(stat.size > 0 && stat.size <= MAX_EXTRACTION_BYTES, "EXTRACTION_BYTES");
  regularFile(hashFile, "EXTRACTION_HASH_FILE_REQUIRED");
  const body = fs.readFileSync(artifactFile);
  const expected = fs.readFileSync(hashFile, "utf8").trim();
  requireCondition(HASH_RE.test(expected), "EXTRACTION_HASH_INVALID");
  requireCondition(sha256(body) === expected, "EXTRACTION_HASH_MISMATCH");
  let artifact;
  try { artifact = JSON.parse(body.toString("utf8")); }
  catch (_) { throw new Error("EXTRACTION_JSON"); }
  requireCondition(artifact.caseId === record.caseId, "EXTRACTION_CASE_MISMATCH");
  verifyExtractionIdentity(artifact);
  return artifact;
}

function persistImageExtraction(fileOrDir, intakeResult) {
  const { dir: caseDir, record } = caseDirectory(fileOrDir);
  const artifact = buildExtraction(record, intakeResult);
  const body = canonicalJson(artifact);
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_EXTRACTION_BYTES, "EXTRACTION_BYTES");
  const artifactHash = sha256(Buffer.from(body, "utf8"));
  const parent = path.join(caseDir, "extractions");
  fs.mkdirSync(parent, { recursive: true });
  const finalDir = path.join(parent, artifact.extractionId);

  if (fs.existsSync(finalDir)) {
    const existing = readImageExtraction(caseDir, artifact.extractionId);
    requireCondition(canonicalJson(existing) === body, "EXTRACTION_ID_COLLISION");
    return {
      schema: "ekg-image-extraction-receipt-v2",
      caseId: record.caseId,
      extractionId: artifact.extractionId,
      path: path.join(finalDir, "extraction.json"),
      sha256: artifactHash,
      idempotent: true,
      ...CASE_GOVERNANCE,
    };
  }

  const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
  try {
    const artifactFile = path.join(stage, "extraction.json");
    const hashFile = path.join(stage, "extraction.sha256");
    fs.writeFileSync(artifactFile, body, { encoding: "utf8", flag: "wx" });
    fs.writeFileSync(hashFile, `${artifactHash}\n`, { encoding: "ascii", flag: "wx" });
    fsyncFile(artifactFile);
    fsyncFile(hashFile);
    fsyncDirectory(stage);
    fs.renameSync(stage, finalDir);
    fsyncDirectory(parent);
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    if (!fs.existsSync(finalDir)) throw error;
  }

  const reopened = readImageExtraction(caseDir, artifact.extractionId);
  requireCondition(canonicalJson(reopened) === body, "EXTRACTION_REOPEN_MISMATCH");
  return {
    schema: "ekg-image-extraction-receipt-v2",
    caseId: record.caseId,
    extractionId: artifact.extractionId,
    path: path.join(finalDir, "extraction.json"),
    sha256: artifactHash,
    idempotent: false,
    ...CASE_GOVERNANCE,
  };
}

module.exports = {
  buildExtraction,
  validateAnalysisPermissions,
  persistImageExtraction,
  readImageExtraction,
  verifyExtractionIdentity,
};
