"use strict";
const assert = require("assert");
const { encodeGrayscalePng, decodePngToGrayscale, PNG_GOVERNANCE } = require("../lib/image_png_codec");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

test("PNG codec roundtrips an 8-bit grayscale matrix", () => {
  const src = [
    [255, 16, 196],
    [228, 16, 255],
  ];
  const bytes = encodeGrayscalePng(src);
  const out = decodePngToGrayscale(bytes);
  assert.strictEqual(out.width, 3);
  assert.strictEqual(out.height, 2);
  assert.deepStrictEqual(out.image, src);
  assert.strictEqual(PNG_GOVERNANCE.activation, "NOT_ELIGIBLE");
  assert.throws(() => decodePngToGrayscale(bytes.subarray(0, 20)), /PNG_/);
});

test("intake decodes PNG bytes when no raster matrix is supplied", () => {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const bytes = encodeGrayscalePng(paper.image);
  const out = runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "png",
    bytes,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    provenance: { locator: "case://png-1", projectGold: false },
  });
  assert.strictEqual(out.report.encodedSource, "png-v1");
  assert.strictEqual(out.report.roiSource, "DISCOVERED_3X4_RHYTHM");
  assert.strictEqual(out.rois.completeTwelveLeadPanels, true);
  assert.strictEqual(out.report.diagnosticInterpretationIncluded, false);
});

test("JPEG without a raster still fails closed", () => {
  assert.throws(() => runImageIntakePipeline({
    sourceKind: "phone_photo",
    format: "jpeg",
    provenance: { locator: "case://jpeg-1", projectGold: false },
  }), /INTAKE_ENCODED_IMAGE_RASTERIZATION_REQUIRED/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({ schema: "ekg-image-png-tests-v1", pass: true, passed, total: passed }));
