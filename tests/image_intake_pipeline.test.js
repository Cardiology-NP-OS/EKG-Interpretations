"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap, STANDARD_LEADS, IMAGE_RASTER_GOVERNANCE } = require("../lib/paper_ecg_raster");
const { localizeLeadRois } = require("../lib/image_roi_localization");
const { discoverStandardLayoutRois } = require("../lib/image_roi_discovery");
const { rotate90 } = require("../lib/image_robustness");
const { estimateGridCalibration } = require("../lib/image_grid_calibration");
const { digitizeLeadRois, pearson, peakAmplitude } = require("../lib/image_digitization");
const { runImageIntakePipeline, INTAKE_GOVERNANCE } = require("../lib/image_intake_pipeline");
const { persistImageCase, readImageCase } = require("../lib/image_case_store");

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

test("optional measurement connection stays non-diagnostic", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  const out = runImageIntakePipeline({
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://scan-measure-1", projectGold: false },
    connectMeasurements: true,
    measureLead: "II",
  });
  assert.ok(out.measurements);
  assert.ok(out.measurements.candidateRPeaks.events.length >= 1);
  assert.strictEqual(out.measurements.diagnosticInterpretationIncluded, false);
  assert.strictEqual(out.report.measurementsConnected, true);
});

test("measurement connection rejects assumed paper speed or gain", () => {
  const paper = renderFixture({ pxPerMm: 5 });
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "scanned_paper_ecg",
    format: "raster_matrix",
    raster: paper.image,
    expectedRois: paper.rois,
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
