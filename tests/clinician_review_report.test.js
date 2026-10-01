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
const { persistImageAnalysis, readImageAnalysis } = require("../lib/image_analysis_store");
const { persistClinicianReviewReport, readClinicianReviewReport } = require("../lib/clinician_review_report");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function fixture() {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const input = {
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    roiLeadIdentityVerified: true,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://clinician-report", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-clinician-report-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const analysis = runImageSignalAnalysis(extraction, {
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
  const analysisReceipt = persistImageAnalysis(caseReceipt.path, analysis);
  return { root, caseReceipt, analysisReceipt };
}

test("a saved review report copies measurements and does not add an interpretation", () => {
  const fx = fixture();
  try {
    const before = fs.readFileSync(fx.analysisReceipt.path);
    const receipt = persistClinicianReviewReport(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(receipt.diagnosticInterpretationIncluded, false);
    assert.strictEqual(receipt.clinicalReleaseAuthorized, false);
    assert.match(receipt.notice, /not clinically validated/);
    const saved = readClinicianReviewReport(fx.caseReceipt.path, fx.analysisReceipt.analysisId, receipt.reportId);
    const analysis = readImageAnalysis(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(saved.origin, "SYSTEM_DERIVED");
    assert.strictEqual(saved.reviewState, "UNREVIEWED");
    assert.deepStrictEqual(saved.intervals, analysis.crossLeadConsistency);
    assert.strictEqual(JSON.stringify(saved).includes("diagnosis"), false);
    assert.deepStrictEqual(fs.readFileSync(fx.analysisReceipt.path), before);
    const again = persistClinicianReviewReport(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(again.reportId, receipt.reportId);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ suite: "CLINICIAN_REVIEW_REPORT", pass: true, passed, diagnosticInterpretationIncluded: false }));
