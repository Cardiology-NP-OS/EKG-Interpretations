"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase, readImageCase } = require("../lib/image_case_store");
const { buildExtraction, persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis, selectCanonicalLeads } = require("../lib/image_signal_analysis");

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
    thresholdAuthority: "SYNTHETIC_TEST_CONFIGURATION_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: {
      maxHeldGapColumns: 2,
      maxHeldFraction: 0.2,
    },
  };
}

function fixture(locator) {
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
    provenance: { locator, projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-analysis-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const caseRecord = readImageCase(caseReceipt.path);
  return { paper, input, result, root, caseReceipt, extractionReceipt, extraction, caseRecord };
}

test("duplicate lead selection prefers the rhythm strip and yields twelve canonical leads", () => {
  const fx = fixture("case://image-analysis-select");
  const selected = selectCanonicalLeads(fx.extraction.leads);
  assert.strictEqual(selected.length, 12);
  const leadII = selected.find(lead => lead.lead === "II");
  assert.ok(leadII);
  assert.strictEqual(leadII.rhythmStrip, true);
  assert.ok(leadII.sampleCount > fx.extraction.leads.find(lead => lead.lead === "II" && !lead.rhythmStrip).sampleCount);
});

test("canonical image analysis processes all twelve synthetic leads through existing engines", () => {
  const fx = fixture("case://image-analysis-complete");
  const out = runImageSignalAnalysis(fx.extraction, analysisConfig());
  assert.strictEqual(out.status, "COMPLETE");
  assert.strictEqual(out.attemptedLeadCount, 12);
  assert.strictEqual(out.processedLeadCount, 12);
  assert.strictEqual(out.completeStandardTwelveLead, true);
  assert.strictEqual(out.failures.length, 0);
  assert.strictEqual(out.leadAnalyses.length, 12);
  assert.ok(out.leadAnalyses.every(row => row.measurement.schema === "ekg-waveform-measurement-pipeline-v1"));
  assert.ok(out.leadAnalyses.every(row => row.features.schema === "ekg-rhythm-feature-set-v1"));
  assert.ok(out.leadAnalyses.every(row => row.candidatePhenotypes.schema === "ekg-candidate-phenotype-set-v1"));
});

test("analysis remains explicitly non-diagnostic and non-authoritative", () => {
  const fx = fixture("case://image-analysis-governance");
  const out = runImageSignalAnalysis(fx.extraction, analysisConfig());
  assert.strictEqual(out.simultaneousLeadComparisonPerformed, false);
  assert.strictEqual(out.diagnosticInterpretationIncluded, false);
  assert.strictEqual(out.runtimeAuthority, false);
  assert.strictEqual(out.projectGold, false);
  assert.strictEqual(out.metrics, "NOT_REPORTABLE");
  assert.strictEqual(out.activation, "NOT_ELIGIBLE");
  assert.ok(!Object.prototype.hasOwnProperty.call(out, "diagnosis"));
});

test("one quality-gated lead becomes a partial result without corrupting other leads", () => {
  const fx = fixture("case://image-analysis-partial");
  const changed = JSON.parse(JSON.stringify(fx.result));
  const target = changed.digitized.leads.find(lead => lead.lead === "I");
  target.quality.maxHeldGapColumns = 3;
  target.quality.heldColumnCount = Math.max(target.quality.heldColumnCount, 3);
  const extraction = buildExtraction(fx.caseRecord, changed);
  const out = runImageSignalAnalysis(extraction, analysisConfig());
  assert.strictEqual(out.status, "PARTIAL");
  assert.strictEqual(out.attemptedLeadCount, 12);
  assert.strictEqual(out.processedLeadCount, 11);
  assert.strictEqual(out.completeStandardTwelveLead, false);
  assert.deepStrictEqual(out.failures, [{ leadName: "I", reason: "IMAGE_ANALYSIS_QUALITY_GATE" }]);
  assert.ok(out.leadAnalyses.some(row => row.leadName === "II"));
});

test("if every canonical lead fails quality, analysis fails closed", () => {
  const fx = fixture("case://image-analysis-no-usable");
  const changed = JSON.parse(JSON.stringify(fx.result));
  for (const lead of changed.digitized.leads) {
    lead.quality.maxHeldGapColumns = 3;
    lead.quality.heldColumnCount = Math.max(lead.quality.heldColumnCount, 3);
  }
  const extraction = buildExtraction(fx.caseRecord, changed);
  assert.throws(
    () => runImageSignalAnalysis(extraction, analysisConfig()),
    /IMAGE_ANALYSIS_NO_USABLE_LEADS/,
  );
});

test("immutable extraction calibration permissions cannot be bypassed by later analysis", () => {
  const fx = fixture("case://image-analysis-permission-calibration");
  const changed = JSON.parse(JSON.stringify(fx.result));
  changed.report.analysisPermissions.exactTimeMeasurementAllowed = false;
  const extraction = buildExtraction(fx.caseRecord, changed);
  assert.throws(
    () => runImageSignalAnalysis(extraction, analysisConfig()),
    /IMAGE_ANALYSIS_MEASUREMENT_PERMISSION_REQUIRED/,
  );
});

test("immutable lead-identity permission blocks named-lead analysis", () => {
  const fx = fixture("case://image-analysis-permission-lead");
  const changed = JSON.parse(JSON.stringify(fx.result));
  changed.report.analysisPermissions.specificLeadClaimsAllowed = false;
  changed.report.analysisPermissions.twelveLeadClaimsAllowed = false;
  const extraction = buildExtraction(fx.caseRecord, changed);
  assert.throws(
    () => runImageSignalAnalysis(extraction, analysisConfig()),
    /IMAGE_ANALYSIS_LEAD_IDENTITY_PERMISSION_REQUIRED/,
  );
});

test("twelve-lead permission controls completeness even when twelve traces are processed", () => {
  const fx = fixture("case://image-analysis-permission-twelve");
  const changed = JSON.parse(JSON.stringify(fx.result));
  changed.report.analysisPermissions.twelveLeadClaimsAllowed = false;
  const extraction = buildExtraction(fx.caseRecord, changed);
  const out = runImageSignalAnalysis(extraction, analysisConfig());
  assert.strictEqual(out.processedLeadCount, 12);
  assert.strictEqual(out.completeStandardTwelveLead, false);
  assert.strictEqual(out.sourcePermissions.twelveLeadClaimsAllowed, false);
});

test("analysis rejects extraction identity substitution", () => {
  const fx = fixture("case://image-analysis-identity");
  const changed = JSON.parse(JSON.stringify(fx.extraction));
  changed.leads[0].samples[0] += 0.001;
  assert.throws(
    () => runImageSignalAnalysis(changed, analysisConfig()),
    /EXTRACTION_IDENTITY/,
  );
});

test("invalid quality policy fails before analysis", () => {
  const fx = fixture("case://image-analysis-quality-config");
  const config = analysisConfig();
  config.quality.maxHeldFraction = 1.1;
  assert.throws(
    () => runImageSignalAnalysis(fx.extraction, config),
    /IMAGE_ANALYSIS_MAX_HELD_FRACTION/,
  );
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-signal-analysis-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticInterpretationIncluded: false,
  clinicalAuthorityAdded: false,
}));
