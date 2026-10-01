"use strict";

const { readClinicianReviewBundle } = require("./clinician_review_bundle");
const { readClinicianReviewReport } = require("./clinician_review_report");

const ANALYSIS_ID_RE = /^analysis-[a-f0-9]{64}$/;
const BUNDLE_ID_RE = /^bundle-[a-f0-9]{64}$/;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function buildEvidenceBackedInterpretation(fileOrDir, analysisId, bundleId) {
  requireCondition(ANALYSIS_ID_RE.test(analysisId), "INTERPRETATION_ANALYSIS_ID");
  requireCondition(BUNDLE_ID_RE.test(bundleId), "INTERPRETATION_BUNDLE_ID");
  const bundle = readClinicianReviewBundle(fileOrDir, analysisId, bundleId);
  const report = readClinicianReviewReport(fileOrDir, analysisId, bundle.reportId);
  requireCondition(report.diagnosticInterpretationIncluded === false, "INTERPRETATION_AUTHORITY");
  requireCondition(report.clinicalReleaseAuthorized === false && bundle.clinicalReleaseAuthorized === false, "INTERPRETATION_AUTHORITY");
  requireCondition(report.analysisSha256 === bundle.analysisSha256, "INTERPRETATION_BINDING");
  return Object.freeze({
    schema: "ekg-evidence-backed-interpretation-v1",
    analysisId: bundle.analysisId,
    caseId: bundle.caseId,
    bundleId: bundle.bundleId,
    reportId: report.reportId,
    analysisSha256: bundle.analysisSha256,
    evidenceBacked: false,
    reason: "NO_ADMITTED_CLINICAL_GOLD",
    approvedAdjudicatedGoldCount: 0,
    statements: Object.freeze([]),
    citedIntervals: Object.freeze(JSON.parse(JSON.stringify(report.intervals))),
    result: bundle.result,
    criticalError: bundle.criticalError === true,
    averaged: false,
    diagnosticInterpretationIncluded: false,
    clinicalValidity: "NOT_INFERRED",
    diagnosticRuntime: "GOVERNED_INACTIVE",
    clinicalReleaseAuthorized: false,
    notice: "Engineering output - not clinically validated. Clinician review required.",
  });
}

module.exports = { buildEvidenceBackedInterpretation };
