"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { readClinicianReviewReport } = require("./clinician_review_report");
const { readClinicianReviewSession } = require("./clinician_review_session");

const BUNDLE_ID_RE = /^bundle-[a-f0-9]{64}$/;
const ANALYSIS_ID_RE = /^analysis-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function caseDirectory(fileOrDir) {
  const resolved = path.resolve(fileOrDir);
  const dir = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory()
    ? resolved
    : path.dirname(resolved);
  readImageCase(dir);
  return dir;
}

function bundleIdentity(record) {
  return `bundle-${sha256(Buffer.from(canonicalJson(record), "utf8"))}`;
}

function readClinicianReviewBundle(fileOrDir, analysisId, bundleId) {
  requireCondition(ANALYSIS_ID_RE.test(analysisId), "BUNDLE_ANALYSIS_ID");
  requireCondition(BUNDLE_ID_RE.test(bundleId), "BUNDLE_ID");
  const caseDir = caseDirectory(fileOrDir);
  const dir = path.join(caseDir, "analyses", analysisId, "bundles", bundleId);
  const body = readStoreFile(path.join(dir, "bundle.json"), MAX_BYTES, "BUNDLE_FILE_REQUIRED");
  const expectedHash = readStoreFile(path.join(dir, "bundle.sha256"), 65, "BUNDLE_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(HASH_RE.test(expectedHash) && sha256(body) === expectedHash, "BUNDLE_HASH_MISMATCH");
  const artifact = parseStoreJson(body, "BUNDLE_JSON");
  requireCondition(artifact.bundleId === bundleId && artifact.clinicalReleaseAuthorized === false, "BUNDLE_AUTHORITY");
  const { bundleId: _id, ...base } = artifact;
  requireCondition(bundleIdentity(base) === bundleId, "BUNDLE_IDENTITY");
  return artifact;
}

function persistClinicianReviewBundle(fileOrDir, input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "BUNDLE_OBJECT_REQUIRED");
  requireCondition(["analysisId", "reportId", "sessionId"].every(key => Object.hasOwn(input, key)), "BUNDLE_FIELDS");
  requireCondition(Object.keys(input).every(key => ["analysisId", "reportId", "sessionId"].includes(key)), "BUNDLE_FIELDS");
  requireCondition(ANALYSIS_ID_RE.test(input.analysisId), "BUNDLE_ANALYSIS_ID");
  const caseDir = caseDirectory(fileOrDir);
  const report = readClinicianReviewReport(caseDir, input.analysisId, input.reportId);
  const session = readClinicianReviewSession(caseDir, input.analysisId, input.sessionId);
  requireCondition(session.clinicalReleaseAuthorized === false, "BUNDLE_AUTHORITY");
  requireCondition(report.clinicalReleaseAuthorized === false, "BUNDLE_AUTHORITY");
  requireCondition(
    report.analysisId === input.analysisId &&
    session.analysisId === input.analysisId &&
    report.analysisSha256 === session.analysisSha256 &&
    HASH_RE.test(session.analysisSha256) &&
    report.caseId === session.caseId,
    "BUNDLE_BINDING",
  );
  const record = {
    schema: "ekg-clinician-review-bundle-v1",
    analysisId: session.analysisId,
    caseId: session.caseId,
    analysisSha256: session.analysisSha256,
    reportId: report.reportId,
    sessionId: session.sessionId,
    result: session.result,
    criticalError: session.criticalError,
    averaged: false,
    criticalErrorAveragedAway: false,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    runtimeAuthority: false,
  };
  const bundleId = bundleIdentity(record);
  const body = canonicalJson({ ...record, bundleId });
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_BYTES, "BUNDLE_BYTES");
  const parent = path.join(caseDir, "analyses", session.analysisId, "bundles");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = path.join(parent, bundleId);
  if (!fs.existsSync(finalDir)) {
    const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
    try {
      fs.writeFileSync(path.join(stage, "bundle.json"), body, { encoding: "utf8", flag: "wx" });
      fs.writeFileSync(path.join(stage, "bundle.sha256"), `${sha256(Buffer.from(body, "utf8"))}\n`, { encoding: "ascii", flag: "wx" });
      fs.renameSync(stage, finalDir);
    } catch (error) {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  const saved = readClinicianReviewBundle(caseDir, session.analysisId, bundleId);
  requireCondition(canonicalJson(saved) === body, "BUNDLE_REOPEN_MISMATCH");
  const analysisFile = path.join(caseDir, "analyses", session.analysisId, "analysis.json");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === record.analysisSha256, "BUNDLE_ANALYSIS_MUTATED");
  return {
    schema: "ekg-clinician-review-bundle-receipt-v1",
    analysisId: session.analysisId,
    bundleId,
    reportId: report.reportId,
    sessionId: session.sessionId,
    path: path.join(finalDir, "bundle.json"),
    result: saved.result,
    criticalError: saved.criticalError,
    averaged: false,
    clinicalReleaseAuthorized: false,
  };
}

module.exports = {
  persistClinicianReviewBundle,
  readClinicianReviewBundle,
};
