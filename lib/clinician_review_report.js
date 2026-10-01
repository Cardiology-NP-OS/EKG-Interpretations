"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { readImageAnalysis } = require("./image_analysis_store");

const REPORT_ID_RE = /^report-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_REPORT_BYTES = 1024 * 1024;

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

function reportIdentity(record) {
  return `report-${sha256(Buffer.from(canonicalJson(record), "utf8"))}`;
}

function readClinicianReviewReport(fileOrDir, analysisId, reportId) {
  requireCondition(REPORT_ID_RE.test(reportId), "CLINICIAN_REPORT_ID");
  const caseDir = caseDirectory(fileOrDir);
  const dir = path.join(caseDir, "analyses", analysisId, "reports", reportId);
  const body = readStoreFile(path.join(dir, "report.json"), MAX_REPORT_BYTES, "CLINICIAN_REPORT_FILE_REQUIRED");
  const expectedHash = readStoreFile(path.join(dir, "report.sha256"), 65, "CLINICIAN_REPORT_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(HASH_RE.test(expectedHash) && sha256(body) === expectedHash, "CLINICIAN_REPORT_HASH_MISMATCH");
  const artifact = parseStoreJson(body, "CLINICIAN_REPORT_JSON");
  requireCondition(artifact.reportId === reportId, "CLINICIAN_REPORT_ID");
  const { reportId: _id, ...base } = artifact;
  requireCondition(reportIdentity(base) === reportId, "CLINICIAN_REPORT_IDENTITY");
  requireCondition(artifact.diagnosticInterpretationIncluded === false, "CLINICIAN_REPORT_AUTHORITY");
  requireCondition(artifact.clinicalReleaseAuthorized === false, "CLINICIAN_REPORT_AUTHORITY");
  return artifact;
}

function persistClinicianReviewReport(fileOrDir, analysisId) {
  requireCondition(typeof analysisId === "string", "CLINICIAN_REPORT_ANALYSIS_ID");
  const caseDir = caseDirectory(fileOrDir);
  const analysis = readImageAnalysis(caseDir, analysisId);
  const analysisFile = path.join(caseDir, "analyses", analysis.analysisId, "analysis.json");
  const analysisBytes = fs.readFileSync(analysisFile);
  const record = {
    schema: "ekg-clinician-review-report-v1",
    analysisId: analysis.analysisId,
    caseId: analysis.caseId,
    analysisSha256: sha256(analysisBytes),
    status: analysis.status,
    processedLeadCount: analysis.processedLeadCount,
    intervals: analysis.crossLeadConsistency,
    origin: "SYSTEM_DERIVED",
    reviewState: "UNREVIEWED",
    diagnosticInterpretationIncluded: false,
    clinicalValidityInferred: false,
    clinicalReleaseAuthorized: false,
    runtimeAuthority: false,
    notice: "Engineering output - not clinically validated. Clinician review required.",
  };
  const reportId = reportIdentity(record);
  const artifact = { ...record, reportId };
  const body = canonicalJson(artifact);
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_REPORT_BYTES, "CLINICIAN_REPORT_BYTES");
  const parent = path.join(caseDir, "analyses", analysis.analysisId, "reports");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = path.join(parent, reportId);
  if (!fs.existsSync(finalDir)) {
    const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
    try {
      fs.writeFileSync(path.join(stage, "report.json"), body, { encoding: "utf8", flag: "wx" });
      fs.writeFileSync(path.join(stage, "report.sha256"), `${sha256(Buffer.from(body, "utf8"))}\n`, { encoding: "ascii", flag: "wx" });
      fs.renameSync(stage, finalDir);
    } catch (error) {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  const saved = readClinicianReviewReport(caseDir, analysis.analysisId, reportId);
  requireCondition(canonicalJson(saved) === body, "CLINICIAN_REPORT_REOPEN_MISMATCH");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === record.analysisSha256, "CLINICIAN_REPORT_ANALYSIS_MUTATED");
  return {
    schema: "ekg-clinician-review-report-receipt-v1",
    caseId: analysis.caseId,
    analysisId: analysis.analysisId,
    reportId,
    path: path.join(finalDir, "report.json"),
    sha256: sha256(Buffer.from(body, "utf8")),
    diagnosticInterpretationIncluded: false,
    clinicalReleaseAuthorized: false,
    notice: record.notice,
  };
}

module.exports = {
  persistClinicianReviewReport,
  readClinicianReviewReport,
  reportIdentity,
};
