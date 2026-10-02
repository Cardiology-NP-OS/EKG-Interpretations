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
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const DISCLAIMER = "Engineering output - not clinically validated. Clinician review required.";

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

function extractionFixture(mutate = () => {}) {
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
  mutate(result);
  return buildExtraction({ caseId: result.report.caseId }, result);
}
test("provider status exposes full specialist surfaces without authority", () => {
  const out = dispatch({ operation: "status" });
  assert.strictEqual(out.operations.waveform_execute.available, true);
  assert.strictEqual(out.operations.image_file_intake.available, true);
  assert.strictEqual(out.operations.image_case_pipeline.available, true);
  assert.strictEqual(out.operations.image_case_reader_pipeline.available, true);
  assert.strictEqual(out.operations.image_case_reader_pipeline.returnsStructuredReader, true);
  assert.strictEqual(out.operations.image_review.available, true);
  assert.strictEqual(out.operations.clinician_reader.available, true);
  assert.strictEqual(out.operations.clinician_correction_append.available, true);
  assert.strictEqual(out.operations.clinician_correction_append.appendOnly, true);
  assert.strictEqual(out.imageCapabilities.pdf, true);
  assert.strictEqual(out.imageCapabilities.multileadReview, true);
  assert.strictEqual(out.imageCapabilities.structuredClinicianReader, true);
  assert.strictEqual(out.imageCapabilities.appendOnlyClinicianCorrectionProvider, true);
  assert.strictEqual(out.imageCapabilities.endToEndPersistedReaderWorkflow, true);
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

test("provider preserves measurements, provenance and separate canonical and supplemental failures", () => {
  for (const failedSource of [null, "canonical", "supplemental"]) {
    const extraction = extractionFixture(result => {
      if (failedSource) {
        const lead = result.digitized.leads.find(row => row.lead === (failedSource === "canonical" ? "I" : "II") && !row.rhythmStrip);
        lead.quality.heldColumnCount = 999;
      }
    });
    const request = { operation: "image_review", extraction, analysisConfig: analysisConfig() };
    const review = runImageSignalAnalysis(extraction, request.analysisConfig);
    const out = dispatch(request);
    assert.strictEqual(out.disclaimer, DISCLAIMER);
    assert.deepStrictEqual(out.review, { ...review, disclaimer: DISCLAIMER, origin: "SYSTEM_DERIVED", reviewState: "UNREVIEWED" });
    assert.strictEqual(out.review.status, failedSource === "canonical" ? "PARTIAL" : "COMPLETE");
    assert.strictEqual(out.review.failures.length, failedSource === "canonical" ? 1 : 0);
    assert.strictEqual(out.review.supplementalPaperWindowFailures.length, failedSource === "supplemental" ? 1 : 0);
    for (const row of out.review.leadAnalyses) {
      assert.ok(row.measurement.provenance.locator.includes(extraction.extractionId));
      assert.strictEqual(row.measurement.diagnosticInterpretationIncluded, false);
    }
    const cli = cp.spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "specialist_provider.js")], {
      input: JSON.stringify(request), encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.strictEqual(cli.status, 0, cli.stderr);
    assert.deepStrictEqual(JSON.parse(cli.stdout), out);
  }
});

test("provider rejects invalid detector configuration before creating a case", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-provider-invalid-config-"));
  try {
    const config = analysisConfig();
    config.measurement.detector.algorithm = "MISSPELLED_V2";
    assert.throws(() => dispatch({ operation: "image_case_pipeline", caseRoot: path.join(root, "cases"), input: {}, analysisConfig: config }), /PIPELINE_DETECTOR_ALGORITHM/);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
