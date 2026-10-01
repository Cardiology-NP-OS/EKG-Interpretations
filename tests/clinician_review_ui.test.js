"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { persistImageAnalysis } = require("../lib/image_analysis_store");
const { persistClinicianReviewReport, readClinicianReviewReport } = require("../lib/clinician_review_report");
const { persistSixAxisScore } = require("../lib/six_axis_score_store");
const { addSessionScore, closeClinicianReviewSession, openClinicianReviewSession } = require("../lib/clinician_review_session");
const { persistClinicianReviewBundle } = require("../lib/clinician_review_bundle");
const { buildEvidenceBackedInterpretation } = require("../lib/evidence_backed_interpretation");
const { renderClinicianReviewUi } = require("../lib/clinician_review_ui");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function fixture() {
  const paper = renderPaperEcgRaster({ leads: syntheticLeadMap(250, 10), sampleRateHz: 250, geometry: { pxPerMm: 5 } });
  const input = {
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    roiLeadIdentityVerified: true,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://review-ui", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-review-ui-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const analysis = runImageSignalAnalysis(readImageExtraction(caseReceipt.path, extractionReceipt.extractionId), {
    measurement: {
      detector: { minAbsoluteDeviation: 0.25, refractoryMs: 240 },
      delineation: {
        baseline: 0,
        qrs: { threshold: 0.35, beforeMs: 80, afterMs: 80 },
        p: { threshold: 0.15, searchStartMsBeforeR: 240, searchEndMsBeforeR: 80 },
        t: { threshold: 0.2, searchStartMsAfterR: 100, searchEndMsAfterR: 400 },
      },
    },
    phenotypes: {
      minBeatCount: 2,
      rrIrregularity: { minIntervals: 2, cvAtOrAbove: 0.1, maxSuccessiveDeltaMsAtOrAbove: 100 },
      pause: { minIntervals: 1, absoluteRrMsAtOrAbove: 1400, medianMultipleAtOrAbove: 1.5 },
      qrsDuration: { medianMsAtOrAbove: 120 },
      pWaveCoverage: { ratioAtOrBelow: 0.5 },
      prDuration: { medianMsAtOrAbove: 200 },
    },
    thresholdAuthority: "SYNTHETIC_TEST_CONFIGURATION_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  });
  return { root, caseReceipt, analysisReceipt: persistImageAnalysis(caseReceipt.path, analysis) };
}

test("the review page shows the critical result and refuses an evidence-backed diagnosis", () => {
  const fx = fixture();
  try {
    const report = persistClinicianReviewReport(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    const opened = openClinicianReviewSession(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    const axes = { accuracy: 3, completeness: 3, findingsSurfaced: 3, significantOmissions: 1, decisionImpact: 2, claimTraceability: 3 };
    const left = persistSixAxisScore(fx.caseReceipt.path, { analysisId: fx.analysisReceipt.analysisId, reviewerId: "synthetic-reviewer-a", axes, criticalError: false });
    const right = persistSixAxisScore(fx.caseReceipt.path, { analysisId: fx.analysisReceipt.analysisId, reviewerId: "synthetic-reviewer-b", axes: { ...axes, accuracy: 1 }, criticalError: true });
    const closed = closeClinicianReviewSession(addSessionScore(addSessionScore(opened, left.scoreId), right.scoreId));
    const bundle = persistClinicianReviewBundle(fx.caseReceipt.path, { analysisId: fx.analysisReceipt.analysisId, reportId: report.reportId, sessionId: closed.sessionId });
    const interpretation = buildEvidenceBackedInterpretation(fx.caseReceipt.path, fx.analysisReceipt.analysisId, bundle.bundleId);
    assert.equal(interpretation.evidenceBacked, false);
    assert.equal(interpretation.reason, "NO_ADMITTED_CLINICAL_GOLD");
    assert.equal(interpretation.approvedAdjudicatedGoldCount, 0);
    assert.deepEqual(interpretation.statements, []);
    assert.equal(interpretation.clinicalValidity, "NOT_INFERRED");
    assert.equal(interpretation.diagnosticRuntime, "GOVERNED_INACTIVE");
    assert.equal(interpretation.clinicalReleaseAuthorized, false);
    assert.equal(interpretation.result, "FAIL_CRITICAL");
    assert.equal(interpretation.criticalError, true);
    assert.equal(interpretation.averaged, false);
    const savedReport = readClinicianReviewReport(fx.caseReceipt.path, fx.analysisReceipt.analysisId, report.reportId);
    assert.deepEqual(interpretation.citedIntervals, savedReport.intervals);
    assert.equal(interpretation.analysisSha256, savedReport.analysisSha256);
    assert.equal(Object.isFrozen(interpretation.statements), true);
    const page = renderClinicianReviewUi(fx.caseReceipt.path, fx.analysisReceipt.analysisId, bundle.bundleId);
    const again = renderClinicianReviewUi(fx.caseReceipt.path, fx.analysisReceipt.analysisId, bundle.bundleId);
    assert.equal(again.html, page.html);
    assert.equal(crypto.createHash("sha256").update(again.html).digest("hex"), crypto.createHash("sha256").update(page.html).digest("hex"));
    assert.equal(page.html.startsWith("<!DOCTYPE html>"), true);
    assert.equal(page.html.includes("<script"), false);
    assert.equal(page.html.includes("FAIL_CRITICAL"), true);
    assert.equal(page.html.includes("NO_ADMITTED_CLINICAL_GOLD"), true);
    assert.equal(page.html.includes("Engineering output - not clinically validated. Clinician review required."), true);
    assert.equal(page.html.includes("release control"), true);
    assert.equal(page.html.includes("Cited engineering intervals are not a diagnosis."), true);
    assert.equal(page.clinicalReleaseAuthorized, false);
    assert.equal(page.evidenceBacked, false);
    const printed = spawnSync(process.execPath, [path.join(__dirname, "..", "bin", "print-review-ui.js"), fx.caseReceipt.path, fx.analysisReceipt.analysisId, bundle.bundleId], { encoding: "utf8" });
    assert.equal(printed.status, 0);
    assert.equal(printed.stdout, page.html);
    const missing = spawnSync(process.execPath, [path.join(__dirname, "..", "bin", "print-review-ui.js")], { encoding: "utf8" });
    assert.equal(missing.status, 2);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ suite: "CLINICIAN_REVIEW_UI", pass: true, passed, evidenceBacked: false, clinicalReleaseAuthorized: false }));
