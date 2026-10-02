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
const { dispatch } = require("../tools/specialist_provider");

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
    provenance: { locator: "provider-test://correction", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-provider-correction-"));
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
    thresholdAuthority: "SYNTHETIC_PROVIDER_CORRECTION_TEST_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  });
  const analysisReceipt = persistImageAnalysis(caseReceipt.path, analysis);
  return { root, caseReceipt, analysisReceipt };
}

test("provider appends correction and returns refreshed reader without path leakage", () => {
  const fx = fixture();
  try {
    const before = fs.readFileSync(fx.analysisReceipt.path);
    const first = dispatch({
      operation: "clinician_correction_append",
      caseRoot: fx.root,
      caseId: fx.caseReceipt.caseId,
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Synthetic reviewer correction one.",
    });
    assert.strictEqual(first.schema, "ekg-specialist-clinician-correction-result-v1");
    assert.deepStrictEqual(first.caseRef, { caseId: fx.caseReceipt.caseId, analysisId: fx.analysisReceipt.analysisId });
    assert.strictEqual(first.correction.analysisId, fx.analysisReceipt.analysisId);
    assert.ok(first.correction.file === "correction.json");
    assert.strictEqual(Object.hasOwn(first.correction, "path"), false);
    assert.strictEqual(first.reader.corrections.items.length, 1);
    assert.deepStrictEqual(first.reader.corrections.activeHeadIds, [first.correction.correctionId]);
    assert.strictEqual(first.reader.runtimeAuthority, false);
    assert.strictEqual(first.runtimeAuthority, false);
    assert.strictEqual(JSON.stringify(first).includes(fx.root), false);

    const second = dispatch({
      operation: "clinician_correction_append",
      caseRoot: fx.root,
      caseId: fx.caseReceipt.caseId,
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Synthetic reviewer correction two.",
      supersedes: first.correction.correctionId,
    });
    assert.strictEqual(second.reader.corrections.items.length, 2);
    assert.deepStrictEqual(second.reader.corrections.rootIds, [first.correction.correctionId]);
    assert.deepStrictEqual(second.reader.corrections.activeHeadIds, [second.correction.correctionId]);
    assert.ok(second.reader.corrections.items.some(row =>
      row.correctionId === second.correction.correctionId &&
      row.supersedes === first.correction.correctionId
    ));
    assert.deepStrictEqual(fs.readFileSync(fx.analysisReceipt.path), before);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("provider correction operation rejects unknown fields and authority claims", () => {
  const fx = fixture();
  try {
    const base = {
      operation: "clinician_correction_append",
      caseRoot: fx.root,
      caseId: fx.caseReceipt.caseId,
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Synthetic reviewer note.",
    };
    assert.throws(() => dispatch({ ...base, casePath: fx.caseReceipt.path }), /PROVIDER_CORRECTION_CASE_LOCATOR_AMBIGUOUS/);
    assert.throws(() => dispatch({ ...base, caseId: "../escape" }), /PROVIDER_CORRECTION_CASE_ID_REQUIRED/);
    assert.throws(() => dispatch({ ...base, patientId: "forbidden" }), /PROVIDER_CORRECTION_FIELDS/);
    assert.throws(() => dispatch({ ...base, statement: "This is clinically validated." }), /CLINICIAN_CORRECTION_AUTHORITY_CLAIM/);
    assert.throws(() => dispatch({ ...base, supersedes: "correction-" + "a".repeat(64) }), /CLINICIAN_CORRECTION_/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-specialist-provider-correction-tests-v1",
  pass: true,
  passed,
  total: passed,
  appendOnly: true,
  clinicalAuthorityAdded: false,
}));
