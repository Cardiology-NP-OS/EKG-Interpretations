"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase } = require("./image_case_store");
const { readImageExtraction } = require("./image_extraction_store");
const { ANALYSIS_GOVERNANCE, STANDARD_LEADS } = require("./image_signal_analysis");

const ANALYSIS_ID_RE = /^analysis-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_ANALYSIS_BYTES = 32 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set([
  "diagnosis",
  "diagnoses",
  "diagnosticConclusion",
  "clinicalDiagnosis",
  "clinicalConclusion",
  "treatmentRecommendation",
  "managementRecommendation",
]);

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

function validateInactiveTree(value, depth = 0) {
  requireCondition(depth <= 64, "IMAGE_ANALYSIS_STRUCTURE");
  if (Array.isArray(value)) {
    for (const child of value) validateInactiveTree(child, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    requireCondition(!FORBIDDEN_KEYS.has(key), "IMAGE_ANALYSIS_FORBIDDEN_FIELD");
    if (key === "runtimeAuthority") requireCondition(child === false, "IMAGE_ANALYSIS_GOVERNANCE");
    if (key === "projectGold") requireCondition(child === false, "IMAGE_ANALYSIS_GOVERNANCE");
    if (key === "diagnosticInterpretationIncluded") requireCondition(child === false, "IMAGE_ANALYSIS_GOVERNANCE");
    if (key === "clinicalValidityInferred") requireCondition(child === false, "IMAGE_ANALYSIS_GOVERNANCE");
    if (key === "metrics") requireCondition(child === "NOT_REPORTABLE", "IMAGE_ANALYSIS_GOVERNANCE");
    if (key === "activation") requireCondition(child === "NOT_ELIGIBLE", "IMAGE_ANALYSIS_GOVERNANCE");
    validateInactiveTree(child, depth + 1);
  }
}

function validateAnalysis(analysis, caseRecord, extraction) {
  requireCondition(analysis && typeof analysis === "object" && !Array.isArray(analysis), "IMAGE_ANALYSIS_REQUIRED");
  validateInactiveTree(analysis);
  requireCondition(analysis.schema === "ekg-image-signal-analysis-v2", "IMAGE_ANALYSIS_SCHEMA");
  requireCondition(analysis.caseId === caseRecord.caseId, "IMAGE_ANALYSIS_CASE_MISMATCH");
  requireCondition(analysis.extractionId === extraction.extractionId, "IMAGE_ANALYSIS_EXTRACTION_MISMATCH");
  requireCondition(analysis.status === "COMPLETE" || analysis.status === "PARTIAL", "IMAGE_ANALYSIS_STATUS");
  requireCondition(Number.isInteger(analysis.attemptedLeadCount) && analysis.attemptedLeadCount >= 1, "IMAGE_ANALYSIS_ATTEMPTED");
  requireCondition(Number.isInteger(analysis.processedLeadCount) && analysis.processedLeadCount >= 1, "IMAGE_ANALYSIS_PROCESSED");
  requireCondition(Array.isArray(analysis.leadAnalyses) && analysis.leadAnalyses.length === analysis.processedLeadCount, "IMAGE_ANALYSIS_RESULTS");
  requireCondition(Array.isArray(analysis.failures), "IMAGE_ANALYSIS_FAILURES");
  requireCondition(analysis.attemptedLeadCount === analysis.processedLeadCount + analysis.failures.length, "IMAGE_ANALYSIS_ACCOUNTING");
  requireCondition(analysis.status === (analysis.failures.length ? "PARTIAL" : "COMPLETE"), "IMAGE_ANALYSIS_STATUS");
  requireCondition(analysis.simultaneousLeadComparisonPerformed === false, "IMAGE_ANALYSIS_SIMULTANEOUS");
  requireCondition(analysis.diagnosticInterpretationIncluded === false, "IMAGE_ANALYSIS_GOVERNANCE");
  for (const [key, value] of Object.entries(ANALYSIS_GOVERNANCE)) {
    requireCondition(analysis[key] === value, "IMAGE_ANALYSIS_GOVERNANCE");
  }

  const extractionNames = new Set(extraction.leads.map(lead => lead.lead));
  const resultNames = new Set();
  for (const row of analysis.leadAnalyses) {
    requireCondition(row && typeof row === "object" && typeof row.leadName === "string", "IMAGE_ANALYSIS_LEAD");
    requireCondition(extractionNames.has(row.leadName), "IMAGE_ANALYSIS_LEAD_SOURCE");
    requireCondition(!resultNames.has(row.leadName), "IMAGE_ANALYSIS_DUPLICATE_LEAD");
    resultNames.add(row.leadName);
    requireCondition(row.extractionQuality && typeof row.extractionQuality === "object", "IMAGE_ANALYSIS_QUALITY");
    requireCondition(row.measurement && row.measurement.schema === "ekg-waveform-measurement-pipeline-v1", "IMAGE_ANALYSIS_MEASUREMENT");
    requireCondition(row.features && row.features.schema === "ekg-rhythm-feature-set-v1", "IMAGE_ANALYSIS_FEATURES");
    requireCondition(row.candidatePhenotypes && row.candidatePhenotypes.schema === "ekg-candidate-phenotype-set-v1", "IMAGE_ANALYSIS_PHENOTYPES");
  }
  for (const failure of analysis.failures) {
    requireCondition(failure && typeof failure.leadName === "string" && typeof failure.reason === "string" && failure.reason.length > 0, "IMAGE_ANALYSIS_FAILURE");
    requireCondition(extractionNames.has(failure.leadName), "IMAGE_ANALYSIS_LEAD_SOURCE");
    requireCondition(!resultNames.has(failure.leadName), "IMAGE_ANALYSIS_DUPLICATE_LEAD");
    resultNames.add(failure.leadName);
  }

  const standardProcessed = new Set(analysis.leadAnalyses.map(row => row.leadName));
  const complete = STANDARD_LEADS.every(lead => standardProcessed.has(lead));
  requireCondition(analysis.completeStandardTwelveLead === complete, "IMAGE_ANALYSIS_TWELVE_LEAD");
  requireCondition(typeof analysis.thresholdAuthority === "string" && analysis.thresholdAuthority.length > 0, "IMAGE_ANALYSIS_THRESHOLD_AUTHORITY");
  requireCondition(analysis.qualityPolicy && typeof analysis.qualityPolicy === "object", "IMAGE_ANALYSIS_QUALITY_POLICY");
  requireCondition(
    analysis.sourcePermissions &&
    JSON.stringify(analysis.sourcePermissions) === JSON.stringify(extraction.analysisPermissions),
    "IMAGE_ANALYSIS_PERMISSION_BINDING",
  );
}

function analysisIdentity(analysis) {
  return `analysis-${sha256(Buffer.from(canonicalJson(analysis), "utf8"))}`;
}

function readImageAnalysis(fileOrDir, analysisId) {
  requireCondition(typeof analysisId === "string" && ANALYSIS_ID_RE.test(analysisId), "IMAGE_ANALYSIS_ID");
  const { dir: caseDir, record } = caseDirectory(fileOrDir);
  const analysisDir = path.join(caseDir, "analyses", analysisId);
  requireCondition(path.basename(analysisDir) === analysisId, "IMAGE_ANALYSIS_PATH");
  const artifactFile = path.join(analysisDir, "analysis.json");
  const hashFile = path.join(analysisDir, "analysis.sha256");
  const stat = regularFile(artifactFile, "IMAGE_ANALYSIS_FILE_REQUIRED");
  requireCondition(stat.size > 0 && stat.size <= MAX_ANALYSIS_BYTES, "IMAGE_ANALYSIS_BYTES");
  regularFile(hashFile, "IMAGE_ANALYSIS_HASH_FILE_REQUIRED");
  const body = fs.readFileSync(artifactFile);
  const expectedHash = fs.readFileSync(hashFile, "utf8").trim();
  requireCondition(HASH_RE.test(expectedHash), "IMAGE_ANALYSIS_HASH_INVALID");
  requireCondition(sha256(body) === expectedHash, "IMAGE_ANALYSIS_HASH_MISMATCH");

  let artifact;
  try { artifact = JSON.parse(body.toString("utf8")); }
  catch (_) { throw new Error("IMAGE_ANALYSIS_JSON"); }
  requireCondition(artifact.analysisId === analysisId, "IMAGE_ANALYSIS_ID");
  const { analysisId: _, ...base } = artifact;
  requireCondition(analysisIdentity(base) === analysisId, "IMAGE_ANALYSIS_IDENTITY");
  const extraction = readImageExtraction(caseDir, artifact.extractionId);
  validateAnalysis(base, record, extraction);
  return artifact;
}

function persistImageAnalysis(fileOrDir, analysis) {
  const { dir: caseDir, record } = caseDirectory(fileOrDir);
  requireCondition(analysis && analysis.analysisId === undefined, "IMAGE_ANALYSIS_ID_PREEXISTING");
  requireCondition(typeof analysis.extractionId === "string", "IMAGE_ANALYSIS_EXTRACTION_ID");
  const extraction = readImageExtraction(caseDir, analysis.extractionId);
  validateAnalysis(analysis, record, extraction);

  const analysisId = analysisIdentity(analysis);
  const artifact = { ...analysis, analysisId };
  const body = canonicalJson(artifact);
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_ANALYSIS_BYTES, "IMAGE_ANALYSIS_BYTES");
  const artifactHash = sha256(Buffer.from(body, "utf8"));
  const parent = path.join(caseDir, "analyses");
  fs.mkdirSync(parent, { recursive: true });
  const finalDir = path.join(parent, analysisId);

  if (fs.existsSync(finalDir)) {
    const existing = readImageAnalysis(caseDir, analysisId);
    requireCondition(canonicalJson(existing) === body, "IMAGE_ANALYSIS_ID_COLLISION");
    return {
      schema: "ekg-image-analysis-receipt-v2",
      caseId: record.caseId,
      extractionId: analysis.extractionId,
      analysisId,
      path: path.join(finalDir, "analysis.json"),
      sha256: artifactHash,
      idempotent: true,
      ...ANALYSIS_GOVERNANCE,
    };
  }

  const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
  try {
    const artifactFile = path.join(stage, "analysis.json");
    const hashFile = path.join(stage, "analysis.sha256");
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

  const reopened = readImageAnalysis(caseDir, analysisId);
  requireCondition(canonicalJson(reopened) === body, "IMAGE_ANALYSIS_REOPEN_MISMATCH");
  return {
    schema: "ekg-image-analysis-receipt-v2",
    caseId: record.caseId,
    extractionId: analysis.extractionId,
    analysisId,
    path: path.join(finalDir, "analysis.json"),
    sha256: artifactHash,
    idempotent: false,
    ...ANALYSIS_GOVERNANCE,
  };
}

module.exports = {
  analysisIdentity,
  persistImageAnalysis,
  readImageAnalysis,
  validateAnalysis,
  validateInactiveTree,
};
