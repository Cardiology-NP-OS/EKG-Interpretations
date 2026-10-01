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
const { compareSixAxisScores, persistSixAxisScore, readSixAxisScore } = require("../lib/six_axis_score_store");

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
    provenance: { locator: "case://six-axis", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-six-axis-"));
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

const axes = { accuracy: 3, completeness: 3, findingsSurfaced: 3, significantOmissions: 1, decisionImpact: 2, claimTraceability: 3 };

test("two independent scores keep a critical error and do not grant validation", () => {
  const fx = fixture();
  try {
    const before = fs.readFileSync(fx.analysisReceipt.path);
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
      note: "A fluent summary omitted the failed lead.",
    });
    const comparison = compareSixAxisScores(
      readSixAxisScore(fx.caseReceipt.path, fx.analysisReceipt.analysisId, left.scoreId),
      readSixAxisScore(fx.caseReceipt.path, fx.analysisReceipt.analysisId, right.scoreId),
    );
    assert.deepStrictEqual(comparison.disagreements, ["accuracy"]);
    assert.strictEqual(comparison.result, "FAIL_CRITICAL");
    assert.strictEqual(comparison.averaged, false);
    assert.strictEqual(comparison.criticalErrorAveragedAway, false);
    assert.strictEqual(comparison.clinicalReleaseAuthorized, false);
    assert.deepStrictEqual(fs.readFileSync(fx.analysisReceipt.path), before);
    assert.strictEqual(persistSixAxisScore(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-a",
      axes,
      criticalError: false,
    }).scoreId, left.scoreId);
    assert.throws(() => persistSixAxisScore(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-a",
      axes: { ...axes, accuracy: 0 },
      criticalError: false,
    }), /SIX_AXIS_DUPLICATE_REVIEWER/);
    assert.throws(() => persistSixAxisScore(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-c",
      axes,
      criticalError: false,
      note: "This is clinically validated.",
    }), /SIX_AXIS_AUTHORITY_CLAIM/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ suite: "SIX_AXIS_SCORE", pass: true, passed, clinicalReleaseAuthorized: false }));
