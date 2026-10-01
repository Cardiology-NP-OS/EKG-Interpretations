"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { renderClinicianReviewUi } = require("./clinician_review_ui");
const { buildEvidenceBackedInterpretation } = require("./evidence_backed_interpretation");

const ANALYSIS_ID_RE = /^analysis-[a-f0-9]{64}$/;
const BUNDLE_ID_RE = /^bundle-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_BYTES = 1024 * 1024;

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
  const directory = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  readImageCase(directory);
  return directory;
}

function readClinicianReviewPage(fileOrDir, analysisId, bundleId) {
  requireCondition(ANALYSIS_ID_RE.test(analysisId), "REVIEW_PAGE_ANALYSIS_ID");
  requireCondition(BUNDLE_ID_RE.test(bundleId), "REVIEW_PAGE_BUNDLE_ID");
  const caseDir = caseDirectory(fileOrDir);
  const directory = path.join(caseDir, "analyses", analysisId, "review-pages", bundleId);
  const html = readStoreFile(path.join(directory, "page.html"), MAX_BYTES, "REVIEW_PAGE_FILE_REQUIRED");
  const expected = readStoreFile(path.join(directory, "page.sha256"), 65, "REVIEW_PAGE_HASH_FILE_REQUIRED").toString("ascii").trim();
  requireCondition(HASH_RE.test(expected) && sha256(html) === expected, "REVIEW_PAGE_HASH_MISMATCH");
  const recordBody = readStoreFile(path.join(directory, "page.json"), MAX_BYTES, "REVIEW_PAGE_RECORD_REQUIRED");
  const record = parseStoreJson(recordBody, "REVIEW_PAGE_JSON");
  requireCondition(record.bundleId === bundleId && record.analysisId === analysisId, "REVIEW_PAGE_BINDING");
  requireCondition(record.htmlSha256 === expected, "REVIEW_PAGE_BINDING");
  requireCondition(record.evidenceBacked === false && record.clinicalReleaseAuthorized === false, "REVIEW_PAGE_AUTHORITY");
  requireCondition(HASH_RE.test(record.analysisSha256), "REVIEW_PAGE_ANALYSIS_HASH");
  const analysisFile = path.join(caseDir, "analyses", analysisId, "analysis.json");
  requireCondition(sha256(fs.readFileSync(analysisFile)) === record.analysisSha256, "REVIEW_PAGE_ANALYSIS_MUTATED");
  requireCondition(html.toString("utf8") === record.html, "REVIEW_PAGE_REOPEN_MISMATCH");
  return record;
}

function persistClinicianReviewPage(fileOrDir, analysisId, bundleId) {
  const page = renderClinicianReviewUi(fileOrDir, analysisId, bundleId);
  const interpretation = buildEvidenceBackedInterpretation(fileOrDir, analysisId, bundleId);
  requireCondition(page.evidenceBacked === false && page.clinicalReleaseAuthorized === false, "REVIEW_PAGE_AUTHORITY");
  requireCondition(interpretation.evidenceBacked === false && HASH_RE.test(interpretation.analysisSha256), "REVIEW_PAGE_AUTHORITY");
  const caseDir = caseDirectory(fileOrDir);
  const html = Buffer.from(page.html, "utf8");
  const htmlSha256 = sha256(html);
  const record = {
    schema: "ekg-clinician-review-page-v1",
    analysisId,
    bundleId,
    analysisSha256: interpretation.analysisSha256,
    htmlSha256,
    html: page.html,
    evidenceBacked: false,
    diagnosticInterpretationIncluded: false,
    clinicalReleaseAuthorized: false,
    result: page.result,
    criticalError: page.criticalError === true,
    notice: page.notice,
  };
  const body = canonicalJson(record);
  requireCondition(Buffer.byteLength(body, "utf8") <= MAX_BYTES && html.length <= MAX_BYTES, "REVIEW_PAGE_BYTES");
  const parent = path.join(caseDir, "analyses", analysisId, "review-pages");
  fs.mkdirSync(parent, { recursive: true });
  requireStoreDirectory(parent);
  const finalDir = path.join(parent, bundleId);
  if (!fs.existsSync(finalDir)) {
    const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
    try {
      fs.writeFileSync(path.join(stage, "page.html"), html, { flag: "wx" });
      fs.writeFileSync(path.join(stage, "page.sha256"), `${htmlSha256}\n`, { encoding: "ascii", flag: "wx" });
      fs.writeFileSync(path.join(stage, "page.json"), body, { encoding: "utf8", flag: "wx" });
      fs.renameSync(stage, finalDir);
    } catch (error) {
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  const saved = readClinicianReviewPage(caseDir, analysisId, bundleId);
  requireCondition(saved.html === page.html, "REVIEW_PAGE_REOPEN_MISMATCH");
  return {
    schema: "ekg-clinician-review-page-receipt-v1",
    analysisId,
    bundleId,
    path: path.join(finalDir, "page.html"),
    htmlSha256,
    evidenceBacked: false,
    clinicalReleaseAuthorized: false,
    result: saved.result,
  };
}

module.exports = { persistClinicianReviewPage, readClinicianReviewPage };
