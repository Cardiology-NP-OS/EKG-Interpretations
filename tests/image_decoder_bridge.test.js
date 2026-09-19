"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const { encodeGrayscalePng } = require("../lib/image_png_codec");
const { renderPaperEcgRaster, syntheticLeadMap, STANDARD_LEADS } = require("../lib/paper_ecg_raster");
const { DECODER_LIMITS, NORMALIZATION, decodeImageSourceFile, readRegularFile, validateManifest } = require("../lib/image_decoder_bridge");
const { runImageFileIntake } = require("../lib/image_file_intake");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function pythonExecutable() {
  return process.env.EKG_IMAGE_PYTHON || (process.platform === "win32" ? "python" : "python3");
}

function convertWithPillow(sourcePng, outputPath, mode) {
  const code = [
    "from PIL import Image",
    "import sys",
    "src,out,mode=sys.argv[1:4]",
    "im=Image.open(src).convert('RGB')",
    "im.save(out, 'JPEG', quality=100, subsampling=0) if mode=='jpeg' else im.save(out, 'PDF', resolution=72)",
  ].join("\n");
  const run = cp.spawnSync(pythonExecutable(), ["-c", code, sourcePng, outputPath, mode], {
    encoding: "utf8",
    timeout: 30_000,
    shell: false,
  });
  assert.strictEqual(run.status, 0, run.stderr);
}

function externalPreflight(image, sourceKind, format) {
  return {
    source_kind: sourceKind,
    format,
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

function paperFixture() {
  return renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
}

function withEncodedFixture(format, fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-decoder-test-"));
  try {
    const paper = paperFixture();
    const png = path.join(temp, "source.png");
    fs.writeFileSync(png, encodeGrayscalePng(paper.image));
    const encoded = path.join(temp, format === "jpeg" ? "source.jpg" : "source.pdf");
    convertWithPillow(png, encoded, format);
    fn({ temp, paper, encoded });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test("manifest validation rejects path and authority substitution", () => {
  const base = {
    schema: "ekg-image-decoder-result-v1",
    sourceFormat: "jpeg",
    sourceSha256: "a".repeat(64),
    sourceBytes: 100,
    pdfDpi: null,
    limits: { ...DECODER_LIMITS },
    normalization: NORMALIZATION,
    decoder: {
      Pillow: "12.3.0",
      pypdfium2: "5.13.0",
      pdfium: "test",
      implementationSha256: "c".repeat(64),
    },
    pages: [{
      pageIndex: 0,
      file: "page-0001.png",
      width: 10,
      height: 10,
      originalOrientation: 1,
      rasterSha256: "b".repeat(64),
      rasterBytes: 100,
    }],
    runtimeAuthority: false,
    projectGold: false,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    evidenceAdmission: "NOT_ADMITTED",
    metrics: "NOT_REPORTABLE",
    activation: "NOT_ELIGIBLE",
    clinicalValidityInferred: false,
    diagnosticInterpretationIncluded: false,
  };
  assert.doesNotThrow(() => validateManifest(JSON.parse(JSON.stringify(base))));
  const traversal = JSON.parse(JSON.stringify(base));
  traversal.pages[0].file = "../page-0001.png";
  assert.throws(() => validateManifest(traversal), /IMAGE_DECODER_PAGE_PATH/);
  const authority = JSON.parse(JSON.stringify(base));
  authority.runtimeAuthority = true;
  assert.throws(() => validateManifest(authority), /IMAGE_DECODER_GOVERNANCE/);

  const extra = JSON.parse(JSON.stringify(base));
  extra.unexpected = true;
  assert.throws(() => validateManifest(extra), /IMAGE_DECODER_MANIFEST_FIELDS/);

  const limits = JSON.parse(JSON.stringify(base));
  limits.limits.maxPages = 99;
  assert.throws(() => validateManifest(limits), /IMAGE_DECODER_LIMITS/);

  const decoder = JSON.parse(JSON.stringify(base));
  decoder.decoder.implementationSha256 = "not-a-hash";
  assert.throws(() => validateManifest(decoder), /IMAGE_DECODER_IDENTITY/);

  const pageExtra = JSON.parse(JSON.stringify(base));
  pageExtra.pages[0].unexpected = true;
  assert.throws(() => validateManifest(pageExtra), /IMAGE_DECODER_PAGE_MANIFEST_FIELDS/);
});

test("bridge regular-file reads detect replacement between stat and open", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-read-race-"));
  const file = path.join(temp, "artifact.bin");
  fs.writeFileSync(file, Buffer.from("original"));
  const originalOpen = fs.openSync;
  let injected = false;
  fs.openSync = function(target, flags, mode) {
    if (!injected && path.resolve(String(target)) === path.resolve(file)) {
      injected = true;
      fs.writeFileSync(file, Buffer.from("replacement-content"));
    }
    return originalOpen.call(fs, target, flags, mode);
  };
  try {
    assert.throws(
      () => readRegularFile(file, 1024, "IMAGE_DECODER_TEST_READ"),
      /IMAGE_DECODER_TEST_READ/,
    );
  } finally {
    fs.openSync = originalOpen;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("Node bridge decodes real JPEG and verifies source plus normalized raster", () => {
  withEncodedFixture("jpeg", ({ paper, encoded }) => {
    const out = decodeImageSourceFile({ sourcePath: encoded });
    assert.strictEqual(out.sourceFormat, "jpeg");
    assert.strictEqual(out.pages.length, 1);
    assert.strictEqual(out.pages[0].raster.length, paper.image.length);
    assert.strictEqual(out.pages[0].raster[0].length, paper.image[0].length);
    assert.deepStrictEqual(out.originalBytes, fs.readFileSync(encoded));
    assert.strictEqual(out.runtimeAuthority, false);
  });
});

test("JPEG file intake reaches canonical pipeline with source hash and page identity", () => {
  withEncodedFixture("jpeg", ({ paper, encoded }) => {
    const decoded = decodeImageSourceFile({ sourcePath: encoded });
    const out = runImageFileIntake({
      sourcePath: encoded,
      sourceKind: "phone_photo",
      expectedRois: paper.rois,
      paperSpeedMmPerS: 25,
      gainMmPerMv: 10,
      roiLeadIdentityVerified: true,
      preflight: externalPreflight(decoded.pages[0].raster, "phone_photo", "jpeg"),
      provenance: { locator: "case://jpeg-file-intake", projectGold: false },
    });
    assert.strictEqual(out.decoder.sourceFormat, "jpeg");
    assert.strictEqual(out.decoder.pageIndex, 0);
    assert.strictEqual(out.result.report.sourcePageIndex, 0);
    assert.strictEqual(out.result.report.sourceSha256, out.decoder.sourceSha256);
    assert.strictEqual(out.result.report.format, "jpeg");
    assert.strictEqual(out.result.report.analysisPermissions.specificLeadClaimsAllowed, true);
    assert.strictEqual(out.result.report.diagnosticInterpretationIncluded, false);
  });
});

test("PDF file intake selects page zero and preserves PDF decoder identity", () => {
  withEncodedFixture("pdf", ({ paper, encoded }) => {
    const decoded = decodeImageSourceFile({ sourcePath: encoded, pdfDpi: 72 });
    const out = runImageFileIntake({
      sourcePath: encoded,
      pdfDpi: 72,
      pageIndex: 0,
      sourceKind: "original_digital_ecg_pdf",
      expectedRois: paper.rois,
      paperSpeedMmPerS: 25,
      gainMmPerMv: 10,
      roiLeadIdentityVerified: true,
      preflight: externalPreflight(decoded.pages[0].raster, "original_digital_ecg_pdf", "pdf"),
      provenance: { locator: "case://pdf-file-intake", projectGold: false },
    });
    assert.strictEqual(out.decoder.sourceFormat, "pdf");
    assert.strictEqual(out.decoder.pageIndex, 0);
    assert.strictEqual(out.result.report.sourcePageIndex, 0);
    assert.strictEqual(out.result.report.sourceSha256, out.decoder.sourceSha256);
    assert.strictEqual(out.result.report.format, "pdf");
    assert.strictEqual(out.result.report.diagnosticInterpretationIncluded, false);
  });
});

test("decoded file intake rejects a page index outside the decoded document", () => {
  withEncodedFixture("pdf", ({ encoded }) => {
    const decoded = decodeImageSourceFile({ sourcePath: encoded, pdfDpi: 72 });
    assert.throws(() => runImageFileIntake({
      sourcePath: encoded,
      pdfDpi: 72,
      pageIndex: decoded.pages.length,
      sourceKind: "original_digital_ecg_pdf",
      preflight: {},
      provenance: { locator: "case://pdf-page-oob", projectGold: false },
    }), /IMAGE_FILE_INTAKE_PAGE_INDEX/);
  });
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-decoder-bridge-tests-v1",
  pass: true,
  passed,
  total: passed,
  nativeDecoderDependenciesRequired: true,
  clinicalAuthorityAdded: false,
}));
