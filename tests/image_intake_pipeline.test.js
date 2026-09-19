"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");
const { renderPaperEcgRaster, syntheticLeadMap, STANDARD_LEADS, IMAGE_RASTER_GOVERNANCE } = require("../lib/paper_ecg_raster");
const { localizeLeadRois } = require("../lib/image_roi_localization");
const { discoverStandardLayoutRois } = require("../lib/image_roi_discovery");
const { rotate90 } = require("../lib/image_robustness");
const { rotateArbitraryExpandedNearest } = require("../lib/image_geometry_normalization");
const { estimateGridCalibration } = require("../lib/image_grid_calibration");
const { digitizeLeadRois, pearson, peakAmplitude } = require("../lib/image_digitization");
const { runImageIntakePipeline, INTAKE_GOVERNANCE } = require("../lib/image_intake_pipeline");
const { encodeGrayscalePng } = require("../lib/image_png_codec");
const { persistImageCase, persistImageIntakeCase, readImageCase } = require("../lib/image_case_store");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

const sampleRateHz = 250;
function renderFixture(geometry) {
  return renderPaperEcgRaster({
    leads: syntheticLeadMap(sampleRateHz, 10),
    sampleRateHz,
    geometry,
  });
}

function externalPreflight(image, options = {}) {
  const sourceKind = options.sourceKind || "phone_photo";
  const format = options.format || "raster_matrix";
  const leadLabels = options.leadLabels || STANDARD_LEADS.slice();
  const verified = options.leadLabelsVerified === undefined ? true : options.leadLabelsVerified;
  const paperSpeed = options.paperSpeedMmPerS === undefined ? 25 : options.paperSpeedMmPerS;
  const gain = options.gainMmPerMv === undefined ? 10 : options.gainMmPerMv;
  return {
    source_kind: sourceKind,
    format,
    readable: options.readable === undefined ? true : options.readable,
    quality_flags: options.qualityFlags || [],
    lead_labels: leadLabels,
    lead_labels_verified: verified,
    presented_as_12_lead: options.presentedAs12Lead === undefined ? true : options.presentedAs12Lead,
    lead_mislabel_suspected: options.leadMislabelSuspected === true,
    evidence_complete: options.evidenceComplete === undefined ? true : options.evidenceComplete,
    signal_quality_sufficient: options.signalQualitySufficient === undefined ? true : options.signalQualitySufficient,
    source_identity_established: options.sourceIdentityEstablished === undefined ? true : options.sourceIdentityEstablished,
    serial_comparison_requested: false,
    serial_pair_verified: true,
    machine_text_conflict: false,
    calibration: {
      paper_speed_mm_s: paperSpeed,
      gain_mm_mV: gain,
      calibration_source: options.calibrationSource || "visible",
      local_scale_trustworthy: options.localScaleTrustworthy === undefined ? true : options.localScaleTrustworthy,
    },
    geometry: {
      rotation_or_skew: options.rotationOrSkew === true,
      perspective_distortion: options.perspectiveDistortion === true,
      distorted_aspect_ratio: options.distortedAspectRatio === true,
    },
    image: { width_px: image[0].length, height_px: image.length },
    metadata_claims: [],
    measurements: [],
    embedded_text: [],
  };
}

test("paper raster is rectangular grayscale with twelve-lead ROIs", () => {
  const paper = renderFixture();
  assert.strictEqual(paper.image.length, paper.height);
  assert.strictEqual(paper.image[0].length, paper.width);
  assert.ok(paper.rois.length >= 13);
  const panels = paper.rois.filter(r => !r.rhythmStrip).map(r => r.lead).sort();
  assert.deepStrictEqual(panels, STANDARD_LEADS.slice().sort());
  assert.strictEqual(IMAGE_RASTER_GOVERNANCE.diagnosticInterpretationIncluded, false);
});

test("ROI localization accepts exact layout and rejects empty ink boxes", () => {
  const paper = renderFixture();
  const found = localizeLeadRois({ image: paper.image, expectedRois: paper.rois });
  assert.strictEqual(found.completeTwelveLeadPanels, true);
  assert.strictEqual(found.missingStandardLeads.length, 0);
  const empty = { ...paper.rois[0], x: 0, y: 0, width: 12, height: 12 };
  empty.lead = "I";
  assert.throws(
    () => localizeLeadRois({
      image: paper.image.map(row => row.map(() => 255)),
      expectedRois: [empty],
      minInkFraction: 0.01,
    }),
    /ROI_NO_INK/,
  );
});

test("grid calibration recovers 5 px/mm on the synthetic paper", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const grid = estimateGridCalibration({ image: paper.image, paperSpeedMmPerS: 25, gainMmPerMv: 10 });
  assert.strictEqual(grid.pxPerMm, 5);
  assert.strictEqual(grid.pxPerSecond, 125);
  assert.strictEqual(grid.pxPerMv, 50);
  assert.strictEqual(grid.localScaleTrustworthy, true);
});

test("digitization recovers QRS polarity and correlated morphology on lead II", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const grid = estimateGridCalibration({ image: paper.image, paperSpeedMmPerS: 25, gainMmPerMv: 10 });
  const rhythm = paper.rois.find(r => r.rhythmStrip && r.lead === "II");
  const digitized = digitizeLeadRois({ image: paper.image, rois: [rhythm], calibration: grid });
  const recovered = digitized.leads[0].samples;
  const source = syntheticLeadMap(sampleRateHz, 10).II;
  const step = sampleRateHz / grid.pxPerSecond;
  const resampled = recovered.map((_, i) => {
    const srcIndex = Math.min(source.length - 1, Math.round(i * step));
    return source[srcIndex];
  });
  const r = pearson(recovered, resampled);
  assert.ok(r > 0.55, `correlation ${r}`);
  assert.ok(peakAmplitude(recovered) > 0.4);
});

function sparseTraceFixture(missingColumns) {
  const image = Array.from({ length: 20 }, () => Array(12).fill(255));
  for (let x = 0; x < 12; x += 1) {
    if (!missingColumns.includes(x)) image[10][x] = 0;
  }
  return image;
}

test("digitization records a bounded two-column hold explicitly", () => {
  const out = digitizeLeadRois({
    image: sparseTraceFixture([4, 5]),
    rois: [{ lead: "II", x: 0, y: 0, width: 12, height: 20, baselineY: 10 }],
    calibration: { pxPerSecond: 100, pxPerMv: 10, paperSpeedMmPerS: 25, gainMmPerMv: 10 },
  });
  const lead = out.leads[0];
  assert.strictEqual(lead.sampleCount, 12);
  assert.strictEqual(lead.quality.observedInkColumns, 10);
  assert.strictEqual(lead.quality.heldColumnCount, 2);
  assert.strictEqual(lead.quality.maxHeldGapColumns, 2);
  assert.strictEqual(lead.quality.maxHeldColumns, 2);
  assert.strictEqual(lead.quality.holdPolicy, "BOUNDED_LAST_OBSERVATION_CARRY_FORWARD");
  assert.strictEqual(lead.quality.baselineSource, "EXPLICIT_ROI");
});

test("digitization marks geometry-derived baseline as an assumption", () => {
  const out = digitizeLeadRois({
    image: sparseTraceFixture([]),
    rois: [{ lead: "II", x: 0, y: 0, width: 12, height: 20 }],
    calibration: { pxPerSecond: 100, pxPerMv: 10 },
  });
  assert.strictEqual(out.leads[0].baselineY, 11);
  assert.strictEqual(out.leads[0].quality.baselineSource, "ROI_GEOMETRY_ASSUMPTION_55_PERCENT");
});

test("digitization rejects a missing run longer than the configured hold", () => {
  assert.throws(() => digitizeLeadRois({
    image: sparseTraceFixture([4, 5, 6]),
    rois: [{ lead: "II", x: 0, y: 0, width: 12, height: 20, baselineY: 10 }],
    calibration: { pxPerSecond: 100, pxPerMv: 10 },
  }), /DIGITIZATION_MISSING_RUN_EXCEEDED:II:6:3/);
});

test("digitization can require complete column coverage with zero hold", () => {
  assert.throws(() => digitizeLeadRois({
    image: sparseTraceFixture([4]),
    rois: [{ lead: "II", x: 0, y: 0, width: 12, height: 20, baselineY: 10 }],
    calibration: { pxPerSecond: 100, pxPerMv: 10 },
    maxHeldColumns: 0,
  }), /DIGITIZATION_MISSING_RUN_EXCEEDED/);
});

test("digitization rejects unsafe sparse-hold limits", () => {
  assert.throws(() => digitizeLeadRois({
    image: sparseTraceFixture([]),
    rois: [{ lead: "II", x: 0, y: 0, width: 12, height: 20, baselineY: 10 }],
    calibration: { pxPerSecond: 100, pxPerMv: 10 },
    maxHeldColumns: 9,
  }), /DIGITIZATION_MAX_HELD_COLUMNS/);
});

test("intake fails closed on PDF bytes without a raster", () => {
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "original_digital_ecg_pdf",
    format: "pdf",
    provenance: { locator: "case://pdf-1", projectGold: false },
  }), /INTAKE_PDF_RASTERIZATION_REQUIRED/);
});

test("intake rejects encoded photos without an explicit raster matrix", () => {
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "jpeg",
    provenance: { locator: "case://photo-1", projectGold: false },
  }), /INTAKE_ENCODED_IMAGE_RASTERIZATION_REQUIRED/);
});

test("assumed paper speed or gain cannot grant downstream exact-measurement permission", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    provenance: { locator: "case://assumed-grid-permission", projectGold: false },
  });
  assert.strictEqual(out.grid.speedSource, "STANDARD_ASSUMPTION_25");
  assert.strictEqual(out.grid.gainSource, "STANDARD_ASSUMPTION_10");
  assert.strictEqual(out.report.analysisPermissions.exactTimeMeasurementAllowed, false);
  assert.strictEqual(out.report.analysisPermissions.exactVoltageMeasurementAllowed, false);
});

test("geometry-derived baseline blocks downstream exact-voltage permission", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const rois = paper.rois.map(({ baselineY, ...roi }) => roi);
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://assumed-baseline-permission", projectGold: false },
  });
  assert.strictEqual(out.report.analysisPermissions.exactTimeMeasurementAllowed, true);
  assert.strictEqual(out.report.analysisPermissions.exactVoltageMeasurementAllowed, false);
  assert.ok(out.digitized.leads.every(lead => lead.quality.baselineSource === "ROI_GEOMETRY_ASSUMPTION_55_PERCENT"));
});

test("external image intake requires preflight", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://preflight-required", projectGold: false },
  }), /INTAKE_PREFLIGHT_REQUIRED/);
});

test("external preflight must bind source kind format dimensions and calibration", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const base = {
    sourceKind: "phone_photo",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://preflight-binding", projectGold: false },
  };
  assert.throws(() => runImageIntakePipeline({
    ...base,
    preflight: externalPreflight(paper.image, { sourceKind: "screenshot", format: "raster_matrix" }),
  }), /INTAKE_PREFLIGHT_SOURCE_KIND_MISMATCH/);
  assert.throws(() => runImageIntakePipeline({
    ...base,
    preflight: externalPreflight(paper.image, { sourceKind: "phone_photo", format: "png" }),
  }), /INTAKE_PREFLIGHT_FORMAT_MISMATCH/);
  const wrongDimensions = externalPreflight(paper.image, { sourceKind: "phone_photo", format: "raster_matrix" });
  wrongDimensions.image.width_px += 1;
  assert.throws(() => runImageIntakePipeline({ ...base, preflight: wrongDimensions }), /INTAKE_PREFLIGHT_DIMENSIONS_MISMATCH/);
  assert.throws(() => runImageIntakePipeline({
    ...base,
    preflight: externalPreflight(paper.image, {
      sourceKind: "phone_photo",
      format: "raster_matrix",
      paperSpeedMmPerS: 50,
    }),
  }), /INTAKE_PREFLIGHT_PAPER_SPEED_MISMATCH/);
});

test("unverified external lead identity propagates restrictive analysis permissions", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, {
      sourceKind: "phone_photo",
      format: "raster_matrix",
      leadLabelsVerified: false,
    }),
    provenance: { locator: "case://preflight-lead-identity", projectGold: false },
  });
  assert.strictEqual(out.report.analysisPermissions.specificLeadClaimsAllowed, false);
  assert.strictEqual(out.report.analysisPermissions.twelveLeadClaimsAllowed, false);
});

test("end-to-end raster intake produces a governed report and basic persisted case", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://synthetic-paper-1", projectGold: false, runtimeAuthority: false },
    connectMeasurements: false,
  });
  assert.strictEqual(out.report.completeTwelveLeadPanels, undefined);
  assert.strictEqual(out.rois.completeTwelveLeadPanels, true);
  assert.strictEqual(out.grid.pxPerMm, 5);
  assert.strictEqual(out.digitized.leadCount, paper.rois.length);
  assert.strictEqual(out.report.diagnosticInterpretationIncluded, false);
  assert.strictEqual(INTAKE_GOVERNANCE.activation, "NOT_ELIGIBLE");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-"));
  const receipt = persistImageCase(dir, out);
  const stored = readImageCase(receipt.path);
  assert.strictEqual(stored.caseId, out.report.caseId);
  assert.strictEqual(stored.diagnosticInterpretationIncluded, false);
});

test("intake-aware persistence automatically preserves PNG source and normalized raster", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const originalBytes = encodeGrayscalePng(paper.image);
  const intakeInput = {
    sourceKind: "phone_photo",
    format: "png",
    bytes: originalBytes,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "phone_photo", format: "png" }),
    provenance: { locator: "case://persist-auto-artifacts", projectGold: false },
  };
  const out = runImageIntakePipeline(intakeInput);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-auto-artifacts-"));
  const receipt = persistImageIntakeCase(dir, intakeInput, out);
  const stored = readImageCase(receipt.path);
  assert.strictEqual(stored.persistence.originalBytesPreserved, true);
  assert.strictEqual(stored.persistence.normalizedRasterPreserved, true);
  assert.deepStrictEqual(fs.readFileSync(path.join(path.dirname(receipt.path), "original.bin")), originalBytes);
});

test("fixture CLI automatically persists its normalized raster", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-cli-store-"));
  const result = cp.spawnSync(process.execPath, [
    path.join(__dirname, "..", "tools", "run_image_intake.js"),
    "--fixture",
    "--out",
    dir,
  ], { encoding: "utf8" });
  assert.strictEqual(result.status, 0, result.stderr);
  const caseDir = fs.readdirSync(dir).find(name => name.startsWith("case-"));
  assert.ok(caseDir);
  const stored = readImageCase(path.join(dir, caseDir));
  assert.strictEqual(stored.persistence.originalBytesPreserved, false);
  assert.strictEqual(stored.persistence.normalizedRasterPreserved, true);
  assert.ok(fs.existsSync(path.join(dir, caseDir, "normalized.png")));
});

test("case persistence preserves and verifies supplied original and normalized artifacts", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const originalBytes = encodeGrayscalePng(paper.image);
  const out = runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "png",
    bytes: originalBytes,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "phone_photo", format: "png" }),
    provenance: { locator: "case://persist-artifacts", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-artifacts-"));
  const receipt = persistImageCase(dir, out, {
    originalBytes,
    normalizedRaster: paper.image,
  });
  const stored = readImageCase(receipt.path);
  const caseDir = path.dirname(receipt.path);
  assert.strictEqual(stored.persistence.originalBytesPreserved, true);
  assert.strictEqual(stored.persistence.normalizedRasterPreserved, true);
  assert.deepStrictEqual(fs.readFileSync(path.join(caseDir, "original.bin")), originalBytes);
  assert.strictEqual(stored.artifacts.original.bytes, originalBytes.length);
  assert.ok(stored.artifacts.normalizedRaster.bytes > 0);
  assert.strictEqual(stored.artifacts.normalizedRaster.encoding, "PNG_GRAYSCALE8_STRICT_SUBSET");
});

test("case reopen rejects preserved source artifact tampering", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const originalBytes = encodeGrayscalePng(paper.image);
  const out = runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "png",
    bytes: originalBytes,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "phone_photo", format: "png" }),
    provenance: { locator: "case://persist-artifact-tamper", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-artifact-tamper-"));
  const receipt = persistImageCase(dir, out, {
    originalBytes,
    normalizedRaster: paper.image,
  });
  const original = path.join(path.dirname(receipt.path), "original.bin");
  fs.appendFileSync(original, Buffer.from([0]));
  assert.throws(() => readImageCase(receipt.path), /CASE_ARTIFACT_SIZE_MISMATCH|CASE_ARTIFACT_HASH_MISMATCH/);
});

test("case reopen rejects normalized raster artifact tampering", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-raster-tamper", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-raster-tamper-"));
  const receipt = persistImageCase(dir, out, { normalizedRaster: paper.image });
  const raster = path.join(path.dirname(receipt.path), "normalized.png");
  fs.appendFileSync(raster, Buffer.from([0]));
  assert.throws(() => readImageCase(receipt.path), /CASE_ARTIFACT_SIZE_MISMATCH|CASE_ARTIFACT_HASH_MISMATCH/);
});

test("case reopen rejects substituted artifact filenames even with a matching manifest hash", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-artifact-path", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-artifact-path-"));
  const receipt = persistImageCase(dir, out, { normalizedRaster: paper.image });
  const caseDir = path.dirname(receipt.path);
  const manifest = JSON.parse(fs.readFileSync(receipt.path, "utf8"));
  manifest.artifacts.normalizedRaster.file = "../normalized.png";
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(receipt.path, body);
  fs.writeFileSync(
    path.join(caseDir, "manifest.sha256"),
    `${crypto.createHash("sha256").update(body).digest("hex")}\n`,
  );
  assert.throws(() => readImageCase(receipt.path), /CASE_ARTIFACT_MANIFEST/);
});

test("case persistence is content-stable and idempotent", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-idempotent", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-idem-"));
  const first = persistImageCase(dir, out);
  const second = persistImageCase(dir, out);
  assert.strictEqual(first.idempotent, false);
  assert.strictEqual(second.idempotent, true);
  assert.strictEqual(first.sha256, second.sha256);
  assert.strictEqual(first.path, second.path);
  assert.strictEqual(fs.readdirSync(dir).filter(name => name.startsWith("case-")).length, 1);
  assert.strictEqual(fs.readdirSync(dir).filter(name => name.startsWith(".staging-")).length, 0);
});

test("case reopen rejects manifest tampering", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-tamper", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-tamper-"));
  const receipt = persistImageCase(dir, out);
  fs.appendFileSync(receipt.path, " ");
  assert.throws(() => readImageCase(receipt.path), /CASE_MANIFEST_HASH_MISMATCH/);
});

test("case reopen rejects hash-sidecar substitution", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-hash-tamper", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-hash-"));
  const receipt = persistImageCase(dir, out);
  fs.writeFileSync(path.join(path.dirname(receipt.path), "manifest.sha256"), `${"0".repeat(64)}\n`);
  assert.throws(() => readImageCase(receipt.path), /CASE_MANIFEST_HASH_MISMATCH/);
});

test("failed atomic publication leaves no published or staging case", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-interrupted", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-fail-"));
  const originalRename = fs.renameSync;
  fs.renameSync = () => { throw new Error("INJECTED_RENAME_FAILURE"); };
  try {
    assert.throws(() => persistImageCase(dir, out), /INJECTED_RENAME_FAILURE/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.strictEqual(fs.readdirSync(dir).filter(name => name.startsWith("case-")).length, 0);
  assert.strictEqual(fs.readdirSync(dir).filter(name => name.startsWith(".staging-")).length, 0);
});

test("case directory identity cannot be substituted", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://persist-dir-identity", projectGold: false },
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-case-dir-"));
  const receipt = persistImageCase(dir, out);
  const originalDir = path.dirname(receipt.path);
  const substituted = path.join(dir, `case-${"0".repeat(64)}`);
  fs.renameSync(originalDir, substituted);
  assert.throws(() => readImageCase(substituted), /CASE_DIRECTORY_IDENTITY/);
});

test("optional measurement connection stays non-diagnostic", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "scanned_paper_ecg", format: "raster_matrix" }),
    roiLeadIdentityVerified: true,
    provenance: { locator: "case://scan-measure-1", projectGold: false },
    connectMeasurements: true,
    measureLead: "II",
  });
  assert.ok(out.measurements);
  assert.ok(out.measurements.candidateRPeaks.events.length >= 1);
  assert.strictEqual(out.measurements.diagnosticInterpretationIncluded, false);
  assert.strictEqual(out.report.measurementsConnected, true);
});

test("external named-lead permissions require explicit ROI-to-lead identity verification", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const base = {
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "scanned_paper_ecg", format: "raster_matrix" }),
    provenance: { locator: "case://scan-roi-lead-identity", projectGold: false },
  };
  const out = runImageIntakePipeline(base);
  assert.strictEqual(out.report.analysisPermissions.specificLeadClaimsAllowed, false);
  assert.strictEqual(out.report.analysisPermissions.twelveLeadClaimsAllowed, false);
  assert.strictEqual(out.report.preflight.roiLeadIdentityVerified, false);
  assert.throws(
    () => runImageIntakePipeline({ ...base, connectMeasurements: true, measureLead: "II" }),
    /INTAKE_MEASUREMENT_ROI_LEAD_IDENTITY_UNVERIFIED/,
  );
  const verified = runImageIntakePipeline({ ...base, roiLeadIdentityVerified: true });
  assert.strictEqual(verified.report.analysisPermissions.specificLeadClaimsAllowed, true);
  assert.strictEqual(verified.report.analysisPermissions.twelveLeadClaimsAllowed, true);
  assert.strictEqual(verified.report.preflight.roiLeadIdentityVerified, true);
});

test("measurement connection rejects assumed paper speed or gain", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    preflight: externalPreflight(paper.image, { sourceKind: "scanned_paper_ecg", format: "raster_matrix" }),
    provenance: { locator: "case://scan-assumed-calibration", projectGold: false },
    connectMeasurements: true,
    measureLead: "II",
  }), /INTAKE_MEASUREMENT_EXPLICIT_CALIBRATION_REQUIRED/);
});

test("measurement connection rejects auto-discovered lead identity", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "scanned_paper_ecg", format: "raster_matrix" }),
    provenance: { locator: "case://scan-discovered-layout", projectGold: false },
    connectMeasurements: true,
    measureLead: "II",
  }), /INTAKE_MEASUREMENT_EXPLICIT_ROIS_REQUIRED/);
});

test("measurement connection requires an explicit baseline for every supplied ROI", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const withoutBaselines = paper.rois.map(({ baselineY, ...roi }) => roi);
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: withoutBaselines,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    preflight: externalPreflight(paper.image, { sourceKind: "scanned_paper_ecg", format: "raster_matrix" }),
    provenance: { locator: "case://scan-missing-baseline", projectGold: false },
    connectMeasurements: true,
    measureLead: "II",
  }), /INTAKE_MEASUREMENT_BASELINE_REQUIRED/);
});

test("malformed ROI coordinates fail closed", () => {
  const paper = renderFixture();
  assert.throws(() => localizeLeadRois({
    image: paper.image,
    expectedRois: [{ lead: "I", x: -1, y: 0, width: 10, height: 10 }],
  }), /ROI_BOX_X/);
});

test("standard-layout discovery recovers twelve panels without supplied ROIs", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const grid = estimateGridCalibration({ image: paper.image, paperSpeedMmPerS: 25, gainMmPerMv: 10 });
  const found = discoverStandardLayoutRois({ image: paper.image, pxPerMm: grid.pxPerMm, paperSpeedMmPerS: 25 });
  assert.strictEqual(found.completeTwelveLeadPanels, true);
  assert.strictEqual(found.roiCount, paper.rois.length);
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://discover-1", projectGold: false },
  });
  assert.strictEqual(out.report.roiSource, "DISCOVERED_3X4_RHYTHM");
  assert.strictEqual(out.rois.completeTwelveLeadPanels, true);
  assert.strictEqual(out.digitized.leadCount, found.roiCount);
});

test("continuous deskew recovers a three-degree synthetic page before layout discovery", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const skewed = rotateArbitraryExpandedNearest(paper.image, { degrees: 3 });
  const out = runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: skewed,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    allowDeskewSearch: true,
    maxDeskewDegrees: 5,
    deskewStepDegrees: 0.5,
    deskewDarkThreshold: 210,
    provenance: { locator: "case://deskew-3deg", projectGold: false },
  });
  assert.strictEqual(out.rois.completeTwelveLeadPanels, true);
  assert.strictEqual(out.report.roiSource, "DISCOVERED_3X4_RHYTHM");
  assert.strictEqual(out.report.geometryNormalization.deskewApplied, true);
  assert.ok(
    Math.abs(out.report.geometryNormalization.deskewCorrectionDegrees + 3) <= 0.5,
    JSON.stringify(out.report.geometryNormalization),
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-deskew-case-"));
  const receipt = persistImageIntakeCase(dir, {
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: skewed,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    allowDeskewSearch: true,
    maxDeskewDegrees: 5,
    deskewStepDegrees: 0.5,
    deskewDarkThreshold: 210,
    provenance: { locator: "case://deskew-3deg", projectGold: false },
  }, out);
  const stored = readImageCase(receipt.path);
  assert.strictEqual(stored.persistence.normalizedRasterPreserved, true);
});

test("automatic deskew rejects fixed ROI coordinates", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    allowDeskewSearch: true,
    provenance: { locator: "case://deskew-fixed-roi", projectGold: false },
  }), /INTAKE_DESKEW_WITH_EXPLICIT_ROIS_UNSUPPORTED/);
});

test("orientation search recovers a 90-degree rotated synthetic page", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const rotated = rotate90(paper.image);
  const out = runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "raster_matrix",
    raster: rotated,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    allowOrientationSearch: true,
    preflight: externalPreflight(rotated, {
      sourceKind: "phone_photo",
      format: "raster_matrix",
      rotationOrSkew: true,
    }),
    provenance: { locator: "case://rotated-1", projectGold: false },
  });
  assert.ok(out.report.orientationTurns >= 1);
  assert.strictEqual(out.rois.completeTwelveLeadPanels, true);
  assert.strictEqual(out.report.diagnosticInterpretationIncluded, false);
});

test("project gold provenance is rejected", () => {
  const paper = renderFixture();
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "synthetic_raster",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    provenance: { locator: "x", projectGold: true },
  }), /INTAKE_PROJECT_GOLD_FORBIDDEN/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-intake-tests-v1",
  pass: true,
  passed,
  total: passed,
  diagnosticRuntime: "GOVERNED_INACTIVE",
}));
