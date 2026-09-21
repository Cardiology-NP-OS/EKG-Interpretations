"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { buildExtraction } = require("../lib/image_extraction_store");
const { dispatch } = require("../tools/specialist_provider");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function analysisConfig() {
  return {
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
    thresholdAuthority: "SYNTHETIC_PROVIDER_TEST_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  };
}

function extractionFixture() {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const result = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    roiLeadIdentityVerified: true,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "provider-test://image", projectGold: false },
  });
  return buildExtraction({ caseId: result.report.caseId }, result);
}
test("provider status exposes full specialist surfaces without authority", () => {
  const out = dispatch({ operation: "status" });
  assert.strictEqual(out.operations.waveform_execute.available, true);
  assert.strictEqual(out.operations.image_file_intake.available, true);
  assert.strictEqual(out.operations.image_case_pipeline.available, true);
  assert.strictEqual(out.operations.image_review.available, true);
  assert.strictEqual(out.imageCapabilities.pdf, true);
  assert.strictEqual(out.imageCapabilities.multileadReview, true);
  assert.strictEqual(out.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(out.runtimeAuthority, false);
});

test("provider image review executes existing specialist analysis", () => {
  const out = dispatch({
    operation: "image_review",
    extraction: extractionFixture(),
    analysisConfig: analysisConfig(),
  });
  assert.strictEqual(out.review.status, "COMPLETE");
  assert.strictEqual(out.review.processedLeadCount, 12);
  assert.strictEqual(out.review.completeStandardTwelveLead, true);
  assert.strictEqual(out.review.diagnosticInterpretationIncluded, false);
  assert.strictEqual(out.runtimeAuthority, false);
  assert.strictEqual(out.metrics, "NOT_REPORTABLE");
});
test("provider CLI uses JSON stdin and emits one governed JSON result", () => {
  const run = cp.spawnSync(
    process.execPath,
    [path.join(__dirname, "..", "tools", "specialist_provider.js")],
    { input: JSON.stringify({ operation: "status" }), encoding: "utf8" },
  );
  assert.strictEqual(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.strictEqual(out.schema, "ekg-specialist-provider-status-v1");
  assert.strictEqual(out.clinicalValidityInferred, false);
});

test("unknown provider operations fail closed", () => {
  assert.throws(() => dispatch({ operation: "diagnose_patient" }), /PROVIDER_OPERATION_UNSUPPORTED/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-specialist-provider-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  clinicalAuthorityAdded: false,
}));
