"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { persistImageAnalysis } = require("../lib/image_analysis_store");
const { persistClinicianReviewReport } = require("../lib/clinician_review_report");
const { persistSixAxisScore } = require("../lib/six_axis_score_store");
const { addSessionScore, closeClinicianReviewSession, openClinicianReviewSession } = require("../lib/clinician_review_session");
const { persistClinicianReviewBundle } = require("../lib/clinician_review_bundle");
const { persistClinicianReviewPage } = require("../lib/clinician_review_page");
const { createCaseRootStage, removeCaseRootStage } = require("../lib/case_root_stage");

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
    provenance: { locator: "case://review-staging", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-review-staging-"));
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
    thresholdAuthority: "SYNTHETIC_STAGING_TEST_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  });
  return { root, caseReceipt, analysisReceipt: persistImageAnalysis(caseReceipt.path, analysis) };
}

const axes = { accuracy: 3, completeness: 3, findingsSurfaced: 3, significantOmissions: 1, decisionImpact: 2, claimTraceability: 3 };

test("all deep review artifacts stage at the case root before atomic publication", () => {
  const fx = fixture();
  const caseDir = path.dirname(fx.caseReceipt.path);
  const deepAnalysisParent = path.join(caseDir, "analyses", fx.analysisReceipt.analysisId);
  const observed = [];
  const originalMkdtemp = fs.mkdtempSync;
  try {
    fs.mkdtempSync = prefix => {
      observed.push(prefix);
      return originalMkdtemp(prefix);
    };
    const report = persistClinicianReviewReport(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    const left = persistSixAxisScore(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-a",
      axes,
      criticalError: false,
    });
    const right = persistSixAxisScore(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-b",
      axes: { ...axes, accuracy: 1 },
      criticalError: true,
    });
    const opened = openClinicianReviewSession(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    const closed = closeClinicianReviewSession(addSessionScore(addSessionScore(opened, left.scoreId), right.scoreId));
    const bundle = persistClinicianReviewBundle(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reportId: report.reportId,
      sessionId: closed.sessionId,
    });
    const page = persistClinicianReviewPage(fx.caseReceipt.path, fx.analysisReceipt.analysisId, bundle.bundleId);
    assert.ok(fs.existsSync(report.path));
    assert.ok(fs.existsSync(left.path));
    assert.ok(fs.existsSync(right.path));
    assert.ok(fs.existsSync(closed.path));
    assert.ok(fs.existsSync(bundle.path));
    assert.ok(fs.existsSync(page.path));
  } finally {
    fs.mkdtempSync = originalMkdtemp;
  }
  try {
    assert.deepStrictEqual(observed.map(prefix => path.basename(prefix)), [
      ".review-report-staging-",
      ".six-axis-staging-",
      ".six-axis-staging-",
      ".review-session-staging-",
      ".review-bundle-staging-",
      ".review-page-staging-",
    ]);
    for (const prefix of observed) {
      assert.strictEqual(path.dirname(prefix), caseDir);
      assert.strictEqual(prefix.includes(deepAnalysisParent), false);
    }
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("case-root stage cleanup refuses a directory outside its exact scope", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-stage-scope-"));
  const caseDir = path.join(root, "case-synthetic");
  fs.mkdirSync(caseDir);
  const stage = createCaseRootStage(caseDir, "review-page");
  const outside = fs.mkdtempSync(path.join(root, "outside-"));
  try {
    assert.throws(() => removeCaseRootStage(outside, caseDir, "review-page"), /CASE_ROOT_STAGE_SCOPE/);
    assert.strictEqual(fs.existsSync(outside), true);
    removeCaseRootStage(stage, caseDir, "review-page");
    assert.strictEqual(fs.existsSync(stage), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-review-case-root-staging-tests-v1",
  pass: true,
  passed,
  total: passed,
  windowsPathRiskReduced: true,
  clinicalAuthorityAdded: false,
}));
