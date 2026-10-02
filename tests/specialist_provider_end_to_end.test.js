"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { encodeGrayscalePng } = require("../lib/image_png_codec");
const { renderPaperEcgRaster, syntheticLeadMap, STANDARD_LEADS } = require("../lib/paper_ecg_raster");
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
    thresholdAuthority: "SYNTHETIC_END_TO_END_PROVIDER_TEST_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  };
}

function externalPreflight(image) {
  return {
    source_kind: "scanned_paper_ecg",
    format: "png",
    readable: true,
    quality_flags: [],
    lead_labels: STANDARD_LEADS.slice(),
    lead_labels_verified: true,
    presented_as_12_lead: true,
    lead_mislabel_suspected: false,
    evidence_complete: true,
    signal_quality_sufficient: true,
    source_identity_established: true,
    serial_comparison_requested: false,
    serial_pair_verified: true,
    machine_text_conflict: false,
    calibration: {
      paper_speed_mm_s: 25,
      gain_mm_mV: 10,
      calibration_source: "visible",
      local_scale_trustworthy: true,
    },
    geometry: {
      rotation_or_skew: false,
      perspective_distortion: false,
      distorted_aspect_ratio: false,
    },
    image: { width_px: image[0].length, height_px: image.length },
    metadata_claims: [],
    measurements: [],
    embedded_text: [],
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-provider-e2e-"));
  const caseRoot = path.join(root, "cases");
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const sourcePath = path.join(root, "source.png");
  fs.writeFileSync(sourcePath, encodeGrayscalePng(paper.image));
  return {
    root,
    caseRoot,
    sourcePath,
    request: {
      operation: "image_case_reader_pipeline",
      caseRoot,
      input: {
        sourcePath,
        sourceKind: "scanned_paper_ecg",
        expectedRois: paper.rois,
        roiLeadIdentityVerified: true,
        paperSpeedMmPerS: 25,
        gainMmPerMv: 10,
        provenance: { locator: "provider-e2e://source.png", projectGold: false },
        preflight: externalPreflight(paper.image),
      },
      analysisConfig: analysisConfig(),
    },
  };
}

test("provider closes real file to persisted structured reader to correction to reader loop", () => {
  const fx = fixture();
  try {
    const first = dispatch(fx.request);
    assert.strictEqual(first.schema, "ekg-specialist-image-case-reader-pipeline-result-v1");
    assert.match(first.caseHandle.caseId, /^[a-f0-9]{64}$/);
    assert.match(first.caseHandle.analysisId, /^analysis-[a-f0-9]{64}$/);
    assert.strictEqual(first.reader.caseId, first.caseHandle.caseId);
    assert.strictEqual(first.reader.analysisId, first.caseHandle.analysisId);
    assert.strictEqual(first.reader.leads.length, 12);
    assert.strictEqual(first.reader.diagnosticRuntime, "GOVERNED_INACTIVE");
    assert.strictEqual(first.reader.clinicalValidityInferred, false);
    assert.strictEqual(first.reader.runtimeAuthority, false);
    assert.strictEqual(JSON.stringify(first).includes(fx.root), false);

    const caseDir = path.join(fx.caseRoot, `case-${first.caseHandle.caseId}`);
    const analysisFile = path.join(caseDir, "analyses", first.caseHandle.analysisId, "analysis.json");
    const beforeHash = sha256(fs.readFileSync(analysisFile));

    const correction = dispatch({
      operation: "clinician_correction_append",
      caseRoot: fx.caseRoot,
      caseId: first.caseHandle.caseId,
      analysisId: first.caseHandle.analysisId,
      reviewerId: "synthetic-reviewer-1",
      statement: "Synthetic end-to-end reviewer correction.",
    });
    assert.strictEqual(correction.schema, "ekg-specialist-clinician-correction-result-v1");
    assert.strictEqual(correction.reader.corrections.items.length, 1);
    assert.deepStrictEqual(correction.reader.corrections.activeHeadIds, [correction.correction.correctionId]);
    assert.strictEqual(JSON.stringify(correction).includes(fx.root), false);
    assert.strictEqual(sha256(fs.readFileSync(analysisFile)), beforeHash);

    const reopened = dispatch({
      operation: "clinician_reader",
      caseRoot: fx.caseRoot,
      caseId: first.caseHandle.caseId,
      analysisId: first.caseHandle.analysisId,
    });
    assert.deepStrictEqual(reopened.reader.corrections, correction.reader.corrections);
    assert.strictEqual(reopened.reader.bindings.analysisSha256, first.reader.bindings.analysisSha256);

    const retry = dispatch(fx.request);
    assert.deepStrictEqual(retry.caseHandle, first.caseHandle);
    assert.strictEqual(retry.reader.bindings.analysisSha256, first.reader.bindings.analysisSha256);
    assert.strictEqual(JSON.stringify(retry).includes(fx.root), false);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test("opaque handle locator is exclusive and bounded", () => {
  const fx = fixture();
  try {
    const first = dispatch(fx.request);
    const base = {
      operation: "clinician_reader",
      caseRoot: fx.caseRoot,
      caseId: first.caseHandle.caseId,
      analysisId: first.caseHandle.analysisId,
    };
    assert.doesNotThrow(() => dispatch(base));
    assert.throws(() => dispatch({ ...base, casePath: "also-supplied" }), /PROVIDER_READER_CASE_LOCATOR/);
    assert.throws(() => dispatch({ operation: "clinician_reader", analysisId: first.caseHandle.analysisId }), /PROVIDER_READER_CASE_LOCATOR/);
    assert.throws(() => dispatch({ ...base, caseId: "../escape" }), /PROVIDER_READER_CASE_ID/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-provider-end-to-end-reader-tests-v1",
  pass: true,
  passed,
  total: passed,
  realEncodedFileInput: true,
  persistedCase: true,
  persistedAnalysis: true,
  structuredReader: true,
  appendOnlyCorrection: true,
  reopen: true,
  clinicalAuthorityAdded: false,
}));
