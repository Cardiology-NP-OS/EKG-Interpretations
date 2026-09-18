"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderPaperEcgRaster, syntheticLeadMap, STANDARD_LEADS, IMAGE_RASTER_GOVERNANCE } = require("../lib/paper_ecg_raster");
const { localizeLeadRois } = require("../lib/image_roi_localization");
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

test("end-to-end raster intake produces a governed report and durable case", () => {
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

test("malformed ROI coordinates fail closed", () => {
  const paper = renderFixture();
  assert.throws(() => localizeLeadRois({
    image: paper.image,
    expectedRois: [{ lead: "I", x: -1, y: 0, width: 10, height: 10 }],
  }), /ROI_BOX_X/);
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
