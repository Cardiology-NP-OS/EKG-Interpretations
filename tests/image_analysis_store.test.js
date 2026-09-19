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

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function analysisConfig(authority = "SYNTHETIC_TEST_CONFIGURATION_ONLY_NOT_CLINICALLY_VALIDATED") {
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
    thresholdAuthority: authority,
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
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
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator, projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-analysis-store-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const analysis = runImageSignalAnalysis(extraction, analysisConfig());
  return { root, caseReceipt, extractionReceipt, extraction, analysis };
}

test("analysis persists as an immutable content-addressed generation", () => {
  const fx = fixture("case://analysis-store-1");
  const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const reopened = readImageAnalysis(fx.caseReceipt.path, receipt.analysisId);
  assert.ok(/^analysis-[a-f0-9]{64}$/.test(receipt.analysisId));
  assert.strictEqual(reopened.analysisId, receipt.analysisId);
  assert.strictEqual(reopened.caseId, fx.analysis.caseId);
  assert.strictEqual(reopened.extractionId, fx.extraction.extractionId);
  assert.strictEqual(reopened.processedLeadCount, 12);
  assert.strictEqual(reopened.completeStandardTwelveLead, true);
  assert.strictEqual(reopened.diagnosticInterpretationIncluded, false);
  assert.strictEqual(reopened.runtimeAuthority, false);
});

test("identical analysis persistence is idempotent", () => {
  const fx = fixture("case://analysis-store-idempotent");
  const first = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const second = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(first.analysisId, second.analysisId);
  assert.strictEqual(first.sha256, second.sha256);
  const analyses = path.join(path.dirname(fx.caseReceipt.path), "analyses");
  assert.strictEqual(fs.readdirSync(analyses).filter(name => name.startsWith("analysis-")).length, 1);
  assert.strictEqual(fs.readdirSync(analyses).filter(name => name.startsWith(".staging-")).length, 0);
});

test("changed analysis configuration creates a new immutable generation", () => {
  const fx = fixture("case://analysis-store-generation");
  const first = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const changed = runImageSignalAnalysis(
    fx.extraction,
    analysisConfig("SYNTHETIC_ALTERNATE_CONFIGURATION_NOT_CLINICALLY_VALIDATED"),
  );
  const second = persistImageAnalysis(fx.caseReceipt.path, changed);
  assert.notStrictEqual(first.analysisId, second.analysisId);
  const analyses = path.join(path.dirname(fx.caseReceipt.path), "analyses");
  assert.strictEqual(fs.readdirSync(analyses).filter(name => name.startsWith("analysis-")).length, 2);
});

test("analysis reopen rejects analysis-byte tampering", () => {
  const fx = fixture("case://analysis-store-tamper");
  const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  fs.appendFileSync(receipt.path, " ");
  assert.throws(
    () => readImageAnalysis(fx.caseReceipt.path, receipt.analysisId),
    /IMAGE_ANALYSIS_HASH_MISMATCH/,
  );
});

test("analysis reopen revalidates the bound extraction", () => {
  const fx = fixture("case://analysis-store-extraction-tamper");
  const receipt = persistImageAnalysis(fx.caseReceipt.path, fx.analysis);
  const extractionFile = fx.extractionReceipt.path;
  fs.appendFileSync(extractionFile, " ");
  assert.throws(
    () => readImageAnalysis(fx.caseReceipt.path, receipt.analysisId),
    /EXTRACTION_HASH_MISMATCH/,
  );
});

test("persistence rejects injected diagnosis fields", () => {
  const fx = fixture("case://analysis-store-diagnosis");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.diagnosis = "UNSUPPORTED";
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_FORBIDDEN_FIELD/,
  );
});

test("persistence rejects nested authority escalation", () => {
  const fx = fixture("case://analysis-store-authority");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.leadAnalyses[0].features.runtimeAuthority = true;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /IMAGE_ANALYSIS_GOVERNANCE/,
  );
});

test("analysis cannot bind to a substituted extraction identity", () => {
  const fx = fixture("case://analysis-store-extraction-id");
  const changed = JSON.parse(JSON.stringify(fx.analysis));
  changed.extractionId = `extract-${"0".repeat(64)}`;
  assert.throws(
    () => persistImageAnalysis(fx.caseReceipt.path, changed),
    /EXTRACTION_FILE_REQUIRED|IMAGE_ANALYSIS_EXTRACTION_MISMATCH/,
  );
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-analysis-store-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticInterpretationIncluded: false,
  clinicalAuthorityAdded: false,
}));
