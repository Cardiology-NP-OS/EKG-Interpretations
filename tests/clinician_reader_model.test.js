"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageIntakeCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { persistImageAnalysis } = require("../lib/image_analysis_store");
const { persistClinicianCorrection } = require("../lib/clinician_correction_store");
const { MAX_PREVIEW_POINTS, buildClinicianReaderModel } = require("../lib/clinician_reader_model");
const { dispatch } = require("../tools/specialist_provider");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");

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
    thresholdAuthority: "SYNTHETIC_READER_TEST_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  };
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
    provenance: { locator: "case://clinician-reader", projectGold: false },
  };
  const result = runImageIntakePipeline(input);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-clinician-reader-"));
  const caseReceipt = persistImageIntakeCase(root, input, result);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, result);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const analysis = runImageSignalAnalysis(extraction, analysisConfig());
  const analysisReceipt = persistImageAnalysis(caseReceipt.path, analysis);
  return { root, caseReceipt, extractionReceipt, extraction, analysisReceipt };
}

test("structured reader binds waveform preview measurements quality and exact persisted hashes", () => {
  const fx = fixture();
  try {
    const out = buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(out.schema, "ekg-clinician-reader-model-v1");
    assert.strictEqual(out.leads.length, 12);
    assert.strictEqual(out.completeStandardTwelveLead, true);
    assert.strictEqual(out.bindings.analysisSha256, sha256(fs.readFileSync(fx.analysisReceipt.path)));
    assert.strictEqual(out.bindings.extractionSha256, sha256(fs.readFileSync(fx.extractionReceipt.path)));
    assert.strictEqual(out.diagnosticRuntime, "GOVERNED_INACTIVE");
    assert.strictEqual(out.evidenceAdmission, "NOT_ADMITTED");
    assert.strictEqual(out.metrics, "NOT_REPORTABLE");
    assert.strictEqual(out.clinicalValidityInferred, false);
    assert.strictEqual(out.diagnosticInterpretationIncluded, false);
    assert.strictEqual(out.clinicalReleaseAuthorized, false);
    assert.strictEqual(out.runtimeAuthority, false);
    const lead = out.leads.find(row => row.leadName === "II" && row.rhythmStrip === true);
    const source = fx.extraction.leads.find(row => row.lead === "II" && row.rhythmStrip === true);
    assert.ok(lead && source);
    assert.strictEqual(lead.waveform.sampleCount, source.sampleCount);
    assert.ok(lead.waveform.preview.returnedPointCount <= MAX_PREVIEW_POINTS);
    assert.strictEqual(lead.waveform.preview.points[0].index, 0);
    assert.strictEqual(lead.waveform.preview.points.at(-1).index, source.samples.length - 1);
    for (const point of lead.waveform.preview.points) assert.strictEqual(point.value, source.samples[point.index]);
    assert.strictEqual(lead.measurement.schema, "ekg-waveform-measurement-pipeline-v1");
    assert.ok(Array.isArray(lead.measurement.intervalMeasurements));
    assert.ok(Array.isArray(lead.measurement.amplitudeMeasurements));
    assert.strictEqual(lead.measurement.diagnosticInterpretationIncluded, false);
    assert.ok(Buffer.byteLength(JSON.stringify(out), "utf8") < 4 * 1024 * 1024);
    assert.strictEqual(JSON.stringify(out).includes(fx.root), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("reader exposes append-only correction roots and active heads without changing analysis bytes", () => {
  const fx = fixture();
  try {
    const before = fs.readFileSync(fx.analysisReceipt.path);
    const first = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Synthetic calibration review note.",
    });
    const second = persistClinicianCorrection(fx.caseReceipt.path, {
      analysisId: fx.analysisReceipt.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Corrected synthetic calibration review note.",
      supersedes: first.correctionId,
    });
    const out = buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId);
    assert.strictEqual(out.corrections.items.length, 2);
    assert.deepStrictEqual(out.corrections.rootIds, [first.correctionId]);
    assert.deepStrictEqual(out.corrections.activeHeadIds, [second.correctionId]);
    assert.ok(out.corrections.items.some(row => row.correctionId === second.correctionId && row.supersedes === first.correctionId));
    assert.deepStrictEqual(fs.readFileSync(fx.analysisReceipt.path), before);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("specialist provider advertises and returns the structured reader without path leakage", () => {
  const fx = fixture();
  try {
    const status = dispatch({ operation: "status" });
    assert.strictEqual(status.operations.clinician_reader.available, true);
    assert.strictEqual(status.imageCapabilities.structuredClinicianReader, true);
    const out = dispatch({ operation: "clinician_reader", casePath: fx.caseReceipt.path, analysisId: fx.analysisReceipt.analysisId });
    assert.strictEqual(out.schema, "ekg-specialist-clinician-reader-result-v1");
    assert.strictEqual(out.reader.analysisId, fx.analysisReceipt.analysisId);
    assert.strictEqual(out.reader.leads.length, 12);
    assert.strictEqual(out.reader.runtimeAuthority, false);
    assert.strictEqual(out.runtimeAuthority, false);
    assert.strictEqual(JSON.stringify(out).includes(fx.root), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("reader fails closed on artifact tamper and unclean correction storage", () => {
  const fx = fixture();
  try {
    const original = fs.readFileSync(fx.extractionReceipt.path);
    fs.appendFileSync(fx.extractionReceipt.path, " ");
    assert.throws(() => buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId), /EXTRACTION_HASH_MISMATCH|READER_EXTRACTION_HASH/);
    fs.writeFileSync(fx.extractionReceipt.path, original);
    const parent = path.join(path.dirname(fx.analysisReceipt.path), "corrections");
    fs.mkdirSync(path.join(parent, ".correction-staging-orphan"), { recursive: true });
    assert.throws(() => buildClinicianReaderModel(fx.caseReceipt.path, fx.analysisReceipt.analysisId), /READER_CORRECTION_STORE_UNCLEAN/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-clinician-reader-model-tests-v1",
  pass: true,
  passed,
  total: passed,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  clinicalAuthorityAdded: false,
}));
