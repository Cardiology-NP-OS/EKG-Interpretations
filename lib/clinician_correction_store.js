"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { readImageAnalysis } = require("./image_analysis_store");

const CORRECTION_ID_RE = /^correction-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const REVIEWER_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_STATEMENT = 4000;
const MAX_CORRECTION_BYTES = 64 * 1024;
const FORBIDDEN_KEYS = new Set([
  "diagnosis",
  "diagnoses",
  "diagnosticconclusion",
  "clinicaldiagnosis",
  "treatmentrecommendation",
  "managementrecommendation",
  "patient",
  "patientid",
  "patientref",
  "mrn",
  "phi",
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

function assertPlain(value, depth = 0) {
  requireCondition(depth <= 8, "CLINICIAN_CORRECTION_STRUCTURE");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  requireCondition(value && typeof value === "object", "CLINICIAN_CORRECTION_NOT_PLAIN");
  requireCondition(!Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, "CLINICIAN_CORRECTION_NOT_PLAIN");
  for (const [key, child] of Object.entries(value)) {
    requireCondition(!FORBIDDEN_KEYS.has(key.replace(/[_\s-]/g, "").toLowerCase()), "CLINICIAN_CORRECTION_FORBIDDEN_FIELD");
    if (child && typeof child === "object") assertPlain(child, depth + 1);
  }
}

function caseDirectory(fileOrDir) {
  const resolved = path.resolve(fileOrDir);
  const dir = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  readImageCase(dir);
  return dir;
}

function correctionIdentity(record) {
  return `correction-${sha256(Buffer.from(canonicalJson(record), "utf8"))}`;
}

function correctionDirectory(caseDir, analysisId, correctionId) {
  return path.join(caseDir, "analyses", analysisId, "corrections", correctionId);
}

function readClinicianCorrection(fileOrDir, analysisId, correctionId) {
  requireCondition(CORRECTION_ID_RE.test(correctionId), "CLINICIAN_CORRECTION_ID");
  const caseDir = caseDirectory(fileOrDir);
  const dir = correctionDirectory(caseDir, analysisId, correctionId);
  const artifactFile = path.join(dir, "correction.json");
  const hashFile = path.join(dir, "correction.sha256");
  const body = readStoreFile(artifactFile, MAX_CORRECTION_BYTES, "CLINICIAN_CORRECTION_FILE_REQUIRED");
  const expectedHash = readStoreFile(hashFile, 65, "CLINICIAN_CORRECTION_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(HASH_RE.test(expectedHash) && sha256(body) === expectedHash, "CLINICIAN_CORRECTION_HASH_MISMATCH");
  const artifact = parseStoreJson(body, "CLINICIAN_CORRECTION_JSON");
  requireCondition(artifact.correctionId === correctionId, "CLINICIAN_CORRECTION_ID");
  const { correctionId: _id, ...base } = artifact;
  requireCondition(correctionIdentity(base) === correctionId, "CLINICIAN_CORRECTION_IDENTITY");
  return artifact;
}

function persistClinicianCorrection(fileOrDir, input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "CLINICIAN_CORRECTION_OBJECT_REQUIRED");
  assertPlain(input);
  const keys = Object.keys(input);
  requireCondition(keys.every(key => ["analysisId", "reviewerId", "statement", "supersedes"].includes(key)), "CLINICIAN_CORRECTION_FIELDS");
  requireCondition(["analysisId", "reviewerId", "statement"].every(key => Object.hasOwn(input, key)), "CLINICIAN_CORRECTION_FIELDS");
  requireCondition(typeof input.statement === "string" && input.statement.length >= 1 && input.statement.length <= MAX_STATEMENT, "CLINICIAN_CORRECTION_STATEMENT");
  requireCondition(!/clinically validated|diagnostic authority|clinical release/i.test(input.statement), "CLINICIAN_CORRECTION_AUTHORITY_CLAIM");
  requireCondition(REVIEWER_RE.test(input.reviewerId), "CLINICIAN_CORRECTION_REVIEWER");
  const caseDir = caseDirectory(fileOrDir);
  const analysis = readImageAnalysis(caseDir, input.analysisId);
  const analysisFile = path.join(caseDir, "analyses", analysis.analysisId, "analysis.json");
  const analysisBytes = fs.readFileSync(analysisFile);
  const analysisSha256 = sha256(analysisBytes);
  let supersedes = null;
  if (Object.hasOwn(input, "supersedes")) {
    requireCondition(input.supersedes === null || CORRECTION_ID_RE.test(input.supersedes), "CLINICIAN_CORRECTION_SUPERSEDES");
    if (input.supersedes) {
      const prior = readClinicianCorrection(caseDir, analysis.analysisId, input.supersedes);
      requireCondition(prior.statement !== input.statement, "CLINICIAN_CORRECTION_UNCHANGED");
      supersedes = input.supersedes;
    }
  }
  const record = {
    schema: "ekg-clinician-correction-v1",
    analysisId: analysis.analysisId,
    caseId: analysis.caseId,
    analysisSha256,
    reviewerId: input.reviewerId,
    statement: input.statement,
    origin: "CLINICIAN_REVIEWED",
    supersedes,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    diagnosticInterpretationIncluded: false,
    runtimeAuthority: false,
  };
  const correctionId = correctionIdentity(record);
  const artifact = { ...record, correctionId };
  const body = canonicalJson(artifact);
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_CORRECTION_BYTES, "CLINICIAN_CORRECTION_BYTES");
  const artifactHash = sha256(Buffer.from(body, "utf8"));
  const parent = path.join(caseDir, "analyses", analysis.analysisId, "corrections");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = correctionDirectory(caseDir, analysis.analysisId, correctionId);
  if (!fs.existsSync(finalDir)) {
    const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
    try {
      const artifactFile = path.join(stage, "correction.json");
      const hashFile = path.join(stage, "correction.sha256");
      fs.writeFileSync(artifactFile, body, { encoding: "utf8", flag: "wx" });
      fs.writeFileSync(hashFile, `${artifactHash}\n`, { encoding: "ascii", flag: "wx" });
      fs.renameSync(stage, finalDir);
    } catch (error) {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  const saved = readClinicianCorrection(caseDir, analysis.analysisId, correctionId);
  requireCondition(canonicalJson(saved) === body, "CLINICIAN_CORRECTION_REOPEN_MISMATCH");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === analysisSha256, "CLINICIAN_CORRECTION_ANALYSIS_MUTATED");
  return {
    schema: "ekg-clinician-correction-receipt-v1",
    caseId: analysis.caseId,
    analysisId: analysis.analysisId,
    correctionId,
    path: path.join(finalDir, "correction.json"),
    sha256: artifactHash,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    diagnosticInterpretationIncluded: false,
    runtimeAuthority: false,
    notice: "Engineering output - not clinically validated. Clinician review required.",
  };
}

module.exports = {
  correctionIdentity,
  persistClinicianCorrection,
  readClinicianCorrection,
};
