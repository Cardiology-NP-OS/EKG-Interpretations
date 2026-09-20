"use strict";

const assert = require("assert");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { renderLeadLabel } = require("../lib/image_lead_identity");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { buildExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const {
  addDeterministicNoise,
  adjustIntensity,
  deterministicNoiseField,
  occludeRectangle,
} = require("../lib/image_robustness");

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
    thresholdAuthority: "SYNTHETIC_DEGRADATION_MATRIX_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  };
}

function labeledFixture() {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const discovery = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://degradation-label-layout", projectGold: false },
  });
  const image = paper.image.map(row => row.slice());
  for (const roi of discovery.discovery.rois) {
    renderLeadLabel(image, roi.lead, roi.x + 4, roi.y + 4, { scale: 2, value: 8 });
  }
  return { paper, discovery, image };
}

function runAutomatic(image, locator) {
  const result = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: image,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    verifyLeadLabelsFromRaster: true,
    leadLabelScale: 2,
    leadLabelDarkThreshold: 100,
    leadLabelSearchRadius: 5,
    leadLabelMinScore: 0.82,
    leadLabelOffsetX: 4,
    leadLabelOffsetY: 4,
    allowTraceBaselineEstimation: true,
    provenance: { locator, projectGold: false },
  });
  const extraction = buildExtraction({ caseId: result.report.caseId }, result);
  const analysis = runImageSignalAnalysis(extraction, analysisConfig());
  return { result, extraction, analysis };
}

function assertFullAutomatic(out) {
  assert.strictEqual(out.result.report.roi.leadIdentityVerified, true);
  assert.strictEqual(out.result.report.calibration.verifiedVoltageBaseline, true);
  assert.strictEqual(out.result.report.analysisPermissions.exactTimeMeasurementAllowed, true);
  assert.strictEqual(out.result.report.analysisPermissions.exactVoltageMeasurementAllowed, true);
  assert.strictEqual(out.result.report.analysisPermissions.specificLeadClaimsAllowed, true);
  assert.strictEqual(out.result.report.analysisPermissions.twelveLeadClaimsAllowed, true);
  assert.strictEqual(out.analysis.status, "COMPLETE");
  assert.strictEqual(out.analysis.processedLeadCount, 12);
  assert.strictEqual(out.analysis.completeStandardTwelveLead, true);
  assert.strictEqual(out.analysis.simultaneousPaperGroups.length, 4);
  assert.strictEqual(out.analysis.runtimeAuthority, false);
}

test("clean labeled synthetic paper survives the complete automatic chain", () => {
  const fx = labeledFixture();
  assertFullAutomatic(runAutomatic(fx.image, "case://degradation-clean"));
});

test("mild linear intensity shift survives the complete automatic chain", () => {
  const fx = labeledFixture();
  const degraded = adjustIntensity(fx.image, { gain: 0.9, offset: 15 });
  assertFullAutomatic(runAutomatic(degraded, "case://degradation-intensity"));
});

test("bounded deterministic pixel noise survives the complete automatic chain", () => {
  const fx = labeledFixture();
  const field = deterministicNoiseField(fx.image[0].length, fx.image.length, {
    amplitude: 4,
    period: 17,
  });
  const degraded = addDeterministicNoise(fx.image, field);
  assertFullAutomatic(runAutomatic(degraded, "case://degradation-noise"));
});

test("destroying one printed lead label fails closed at lead identity verification", () => {
  const fx = labeledFixture();
  const v1 = fx.discovery.discovery.rois.find(roi => roi.lead === "V1" && roi.rhythmStrip !== true);
  assert.ok(v1);
  const damaged = occludeRectangle(fx.image, {
    x: v1.x,
    y: v1.y,
    width: Math.min(60, v1.width),
    height: Math.min(24, v1.height),
    value: 255,
  });
  assert.throws(
    () => runAutomatic(damaged, "case://degradation-label-occlusion"),
    /INTAKE_LEAD_IDENTITY_VERIFICATION_FAILED/,
  );
});

test("destroying a contiguous trace run fails closed without relaxing the two-column hold", () => {
  const fx = labeledFixture();
  const v4 = fx.discovery.discovery.rois.find(roi => roi.lead === "V4");
  assert.ok(v4);
  const damaged = occludeRectangle(fx.image, {
    x: v4.x + Math.floor(v4.width / 2),
    y: v4.y,
    width: 6,
    height: v4.height,
    value: 255,
  });
  assert.throws(
    () => runAutomatic(damaged, "case://degradation-trace-occlusion"),
    /DIGITIZATION_MISSING_RUN_EXCEEDED/,
  );
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-degradation-matrix-tests-v1",
  pass: true,
  passed,
  total: passed,
  profiles: {
    survives: ["clean", "intensity-gain-0.9-offset-15", "deterministic-noise-amplitude-4"],
    failsClosed: ["v1-label-occlusion", "v4-six-column-trace-occlusion"],
  },
  syntheticOnly: true,
  clinicalPerformanceClaimed: false,
  clinicalAuthorityAdded: false,
}));
