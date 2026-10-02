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
const { persistClinicianCorrection, readClinicianCorrection } = require("../lib/clinician_correction_store");

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
    provenance: { locator: "case://clinician-correction", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-clinician-correction-"));
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

test("a clinician correction is append-only and leaves the analysis bytes unchanged", () => {
  const fx = fixture();
  try {
    const analysisFile = fx.analysisReceipt.path;
    const before = fs.readFileSync(analysisFile);
    const receipt = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Calibration trace is visible. No diagnostic claim is made.",
    });
    assert.strictEqual(receipt.clinicalReleaseAuthorized, false);
    assert.strictEqual(receipt.clinicalValidityInferred, false);
    assert.strictEqual(receipt.diagnosticInterpretationIncluded, false);
    assert.strictEqual(receipt.runtimeAuthority, false);
    assert.match(receipt.notice, /not clinically validated/);
    const saved = readClinicianCorrection(fx.caseReceipt.path, fx.analysisReceipt.analysisId, receipt.correctionId);
    assert.strictEqual(saved.origin, "CLINICIAN_REVIEWED");
    assert.strictEqual(saved.supersedes, null);
    assert.deepStrictEqual(fs.readFileSync(analysisFile), before);
    const again = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Calibration trace is visible. No diagnostic claim is made.",
    });
    assert.strictEqual(again.correctionId, receipt.correctionId);
    const next = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Lead labels remain unverified.",
      supersedes: receipt.correctionId,
    });
    assert.notStrictEqual(next.correctionId, receipt.correctionId);
    assert.strictEqual(readClinicianCorrection(fx.caseReceipt.path, fx.analysisReceipt.analysisId, next.correctionId).supersedes, receipt.correctionId);
    assert.deepStrictEqual(fs.readFileSync(analysisFile), before);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("correction staging remains at the case root instead of the deep content-addressed parent", () => {
  const fx = fixture();
  const realMkdtempSync = fs.mkdtempSync;
  let observedPrefix = null;
  try {
    fs.mkdtempSync = prefix => {
      observedPrefix = prefix;
      return realMkdtempSync(prefix);
    };
    const receipt = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Synthetic review note for Windows staging-path verification.",
    });
    const caseDir = path.dirname(fx.caseReceipt.path);
    assert.strictEqual(observedPrefix, path.join(caseDir, ".correction-staging-"));
    assert.ok(!observedPrefix.includes(path.join("analyses", fx.analysisReceipt.analysisId, "corrections")));
    assert.ok(fs.existsSync(receipt.path));
  } finally {
    fs.mkdtempSync = realMkdtempSync;
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("corrections reject authority claims, patient fields and a missing analysis", () => {
  const fx = fixture();
  try {
    const base = {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Trace quality is limited.",
    };
    assert.throws(() => persistClinicianCorrection(fx.caseReceipt.path, { ...base, statement: "This is clinically validated." }), /CLINICIAN_CORRECTION_AUTHORITY_CLAIM/);
    assert.throws(() => persistClinicianCorrection(fx.caseReceipt.path, { ...base, mrn: "123" }), /CLINICIAN_CORRECTION_FORBIDDEN_FIELD/);
    assert.throws(() => persistClinicianCorrection(fx.caseReceipt.path, { ...base, diagnosis: "normal" }), /CLINICIAN_CORRECTION_FORBIDDEN_FIELD/);
    assert.throws(() => persistClinicianCorrection(fx.caseReceipt.path, { ...base, analysisId: "analysis-" + "a".repeat(64) }), /IMAGE_ANALYSIS_/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ suite: "CLINICIAN_CORRECTION_STORE", pass: true, passed, clinicalReleaseAuthorized: false }));
