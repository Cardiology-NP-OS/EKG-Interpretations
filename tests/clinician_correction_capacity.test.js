"use strict";

// EKG-G1: correction admission capacity must match reader capacity.
// The reader refuses stores with more than MAX_CORRECTIONS entries, so the
// store must refuse to PUBLISH the (MAX_CORRECTIONS+1)-th distinct correction
// instead of committing it and permanently bricking the reader.
// Idempotent replay of an already-persisted correction must still succeed at
// capacity, and the analysis bytes must never change.

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
const { persistClinicianCorrection, MAX_CORRECTIONS } = require("../lib/clinician_correction_store");
const { buildClinicianReaderModel } = require("../lib/clinician_reader_model");

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
    provenance: { locator: "case://clinician-correction-capacity", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-correction-capacity-"));
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

function caseDirOf(fx) {
  return path.dirname(fx.caseReceipt.path);
}

function correctionsDir(fx) {
  return path.join(caseDirOf(fx), "analyses", fx.analysisReceipt.analysisId, "corrections");
}

function persistNote(fx, i) {
  return persistClinicianCorrection(fx.caseReceipt.path, {
    analysisId: fx.analysisReceipt.analysisId,
    reviewerId: "synthetic-reviewer-1",
    statement: `Capacity probe note ${i}. No diagnostic claim is made.`,
  });
}

test("128 distinct corrections persist and the reader opens the full store", () => {
  const fx = fixture();
  try {
    assert.strictEqual(MAX_CORRECTIONS, 128);
    const first = persistNote(fx, 0);
    for (let i = 1; i < MAX_CORRECTIONS; i += 1) persistNote(fx, i);
    assert.strictEqual(fs.readdirSync(correctionsDir(fx)).length, MAX_CORRECTIONS);
    const reader = buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(reader.corrections.items.length, MAX_CORRECTIONS);
    const firstItem = reader.corrections.items.find((c) => c.correctionId === first.correctionId);
    assert.ok(firstItem, "first correction must be listed");
    assert.strictEqual(firstItem.statement, "Capacity probe note 0. No diagnostic claim is made.");
    // The 129th distinct correction is refused BEFORE publish: no new artifact,
    // analysis bytes unchanged, and the reader still opens (no bricked store).
    const analysisFile = fx.analysisReceipt.path;
    const analysisBefore = fs.readFileSync(analysisFile);
    assert.throws(
      () => persistNote(fx, MAX_CORRECTIONS),
      (error) => error.message === "CLINICIAN_CORRECTION_LIMIT",
      "expected CLINICIAN_CORRECTION_LIMIT"
    );
    assert.strictEqual(fs.readdirSync(correctionsDir(fx)).length, MAX_CORRECTIONS);
    assert.deepStrictEqual(fs.readFileSync(analysisFile), analysisBefore);
    const reopened = buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(reopened.corrections.items.length, MAX_CORRECTIONS);
    // Idempotent replay of an already-persisted correction succeeds at capacity.
    const replay = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Capacity probe note 0. No diagnostic claim is made.",
    });
    assert.strictEqual(replay.correctionId, first.correctionId);
    assert.strictEqual(fs.readdirSync(correctionsDir(fx)).length, MAX_CORRECTIONS);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

console.log(`capacity tests passed: ${passed}`);
