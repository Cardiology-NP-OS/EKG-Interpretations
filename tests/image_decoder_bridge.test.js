"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const { encodeGrayscalePng } = require("../lib/image_png_codec");
const { renderPaperEcgRaster, syntheticLeadMap, STANDARD_LEADS } = require("../lib/paper_ecg_raster");
const { DECODER_LIMITS, EXPECTED_DECODER_WRAPPERS, NORMALIZATION, decodeImageSourceFile, readRegularFile, validateManifest } = require("../lib/image_decoder_bridge");
const { runImageFileIntake, persistImageFileIntakeCase, runAndPersistImageFileIntake } = require("../lib/image_file_intake");
const { readImageCase } = require("../lib/image_case_store");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { projectRectangleToQuadrilateral } = require("../lib/image_geometry_normalization");
const { renderLeadLabel } = require("../lib/image_lead_identity");
const { runImageIntakePipeline } = require("../lib/image_intake_pipeline");
const { persistImageAnalysis, readImageAnalysis } = require("../lib/image_analysis_store");

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

function createTwoPagePdf(sourcePng, outputPath) {
  const code = [
    "from PIL import Image",
    "import sys",
    "src,out=sys.argv[1:3]",
    "im=Image.open(src).convert('RGB')",
    "second=im.copy()",
    "im.save(out,'PDF',resolution=72,save_all=True,append_images=[second])",
  ].join("\n");
  const run = cp.spawnSync(pythonExecutable(), ["-c", code, sourcePng, outputPath], {
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
    thresholdAuthority: "SYNTHETIC_FILE_DECODER_TEST_ONLY_NOT_CLINICALLY_VALIDATED",
    quality: { maxHeldGapColumns: 2, maxHeldFraction: 0.2 },
  };
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

  const wrapperVersion = JSON.parse(JSON.stringify(base));
  wrapperVersion.decoder.Pillow = "0.0.0";
  assert.throws(() => validateManifest(wrapperVersion), /IMAGE_DECODER_IDENTITY/);
  assert.deepStrictEqual(EXPECTED_DECODER_WRAPPERS, {
    Pillow: "12.3.0",
    pypdfium2: "5.13.0",
  });

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

test("manifest validation independently enforces aggregate pixel budget", () => {
  const manifest = {
    schema: "ekg-image-decoder-result-v1",
    sourceFormat: "pdf",
    sourceSha256: "a".repeat(64),
    sourceBytes: 100,
    pdfDpi: 72,
    limits: {
      maxInputBytes: 32 * 1024 * 1024,
      maxPages: 8,
      maxPagePixels: 4_000_000,
      maxTotalPixels: 8_000_000,
      maxDimension: 4000,
      maxArtifactBytes: 16 * 1024 * 1024,
    },
    normalization: "RGB8_PNG_WHITE_ALPHA_BACKGROUND_EXIF_TRANSPOSE",
    decoder: {
      Pillow: "12.3.0",
      pypdfium2: "5.13.0",
      pdfium: "test",
      implementationSha256: "b".repeat(64),
    },
    pages: [0, 1, 2].map(index => ({
      pageIndex: index,
      file: `page-${String(index + 1).padStart(4, "0")}.png`,
      width: 2000,
      height: 2000,
      originalOrientation: 0,
      rasterSha256: "c".repeat(64),
      rasterBytes: 1024,
    })),
    runtimeAuthority: false,
    projectGold: false,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    evidenceAdmission: "NOT_ADMITTED",
    metrics: "NOT_REPORTABLE",
    activation: "NOT_ELIGIBLE",
    clinicalValidityInferred: false,
    diagnosticInterpretationIncluded: false,
  };
  assert.throws(() => validateManifest(manifest), /IMAGE_DECODER_TOTAL_PIXELS/);
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

test("generated JPEG phone photo reaches automatic perspective recovery without supplied ROIs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-jpeg-auto-perspective-"));
  try {
    const paper = paperFixture();
    const canvasWidth = paper.width + 160;
    const canvasHeight = paper.height + 120;
    const corners = {
      topLeft: { x: 62, y: 42 },
      topRight: { x: canvasWidth - 78, y: 18 },
      bottomRight: { x: canvasWidth - 46, y: canvasHeight - 68 },
      bottomLeft: { x: 34, y: canvasHeight - 38 },
    };
    const distorted = projectRectangleToQuadrilateral(paper.image, {
      destinationCorners: corners,
      canvasWidth,
      canvasHeight,
    });
    const png = path.join(temp, "distorted.png");
    const jpeg = path.join(temp, "distorted.jpg");
    fs.writeFileSync(png, encodeGrayscalePng(distorted));
    convertWithPillow(png, jpeg, "jpeg");

    const decoded = decodeImageSourceFile({ sourcePath: jpeg });
    const persisted = runAndPersistImageFileIntake(path.join(temp, "cases"), {
      sourcePath: jpeg,
      sourceKind: "phone_photo",
      paperSpeedMmPerS: 25,
      gainMmPerMv: 10,
      allowPerspectiveDetection: true,
      perspectiveDetectionDarkThreshold: 245,
      perspectiveDetectionMinAreaFraction: 0.4,
      perspectiveDetectionMinEdgeSupportFraction: 0.15,
      perspectiveDetectionEdgeTolerancePx: 6,
      perspectiveOutputWidth: paper.width,
      perspectiveOutputHeight: paper.height,
      allowDeskewSearch: true,
      maxDeskewDegrees: 3,
      deskewStepDegrees: 0.5,
      deskewDarkThreshold: 210,
      preflight: externalPreflight(decoded.pages[0].raster, "phone_photo", "jpeg"),
      provenance: { locator: "case://jpeg-auto-perspective", projectGold: false },
    });

    const report = persisted.fileIntake.result.report;
    assert.strictEqual(report.format, "jpeg");
    assert.strictEqual(report.geometryNormalization.perspective.applied, true);
    assert.strictEqual(report.geometryNormalization.perspective.source, "AUTOMATIC_DARK_SUPPORT");
    assert.strictEqual(report.geometryNormalization.perspective.cornersVerified, false);
    assert.strictEqual(report.roi.completeTwelveLeadPanels, true);
    assert.strictEqual(report.roiSource, "DISCOVERED_3X4_RHYTHM");
    assert.strictEqual(persisted.fileIntake.result.digitized.leadCount, paper.rois.length);

    const stored = readImageCase(persisted.caseReceipt.path);
    assert.strictEqual(stored.persistence.originalBytesPreserved, true);
    assert.strictEqual(stored.persistence.normalizedRasterPreserved, true);
    assert.deepStrictEqual(
      fs.readFileSync(path.join(path.dirname(persisted.caseReceipt.path), "original.bin")),
      fs.readFileSync(jpeg),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("generated JPEG lead labels unlock identity claims but not unverified voltage analysis", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-jpeg-lead-identity-"));
  try {
    const paper = paperFixture();
    const discovery = runImageIntakePipeline({
      sourceKind: "synthetic_raster",
      format: "raster_matrix",
      raster: paper.image,
      paperSpeedMmPerS: 25,
      gainMmPerMv: 10,
      provenance: { locator: "case://lead-label-discovery-helper", projectGold: false },
    });
    const labeled = paper.image.map(row => row.slice());
    for (const roi of discovery.discovery.rois) {
      renderLeadLabel(labeled, roi.lead, roi.x + 4, roi.y + 4, { scale: 2, value: 8 });
    }

    const png = path.join(temp, "labeled.png");
    const jpeg = path.join(temp, "labeled.jpg");
    fs.writeFileSync(png, encodeGrayscalePng(labeled));
    convertWithPillow(png, jpeg, "jpeg");

    const decoded = decodeImageSourceFile({ sourcePath: jpeg });
    const persisted = runAndPersistImageFileIntake(path.join(temp, "cases"), {
      sourcePath: jpeg,
      sourceKind: "phone_photo",
      paperSpeedMmPerS: 25,
      gainMmPerMv: 10,
      verifyLeadLabelsFromRaster: true,
      leadLabelScale: 2,
      leadLabelDarkThreshold: 80,
      leadLabelSearchRadius: 4,
      leadLabelMinScore: 0.88,
      leadLabelOffsetX: 4,
      leadLabelOffsetY: 4,
      preflight: externalPreflight(decoded.pages[0].raster, "phone_photo", "jpeg"),
      provenance: { locator: "case://jpeg-lead-identity", projectGold: false },
    });

    const report = persisted.fileIntake.result.report;
    assert.strictEqual(report.roiSource, "DISCOVERED_3X4_RHYTHM");
    assert.strictEqual(report.roi.leadIdentityVerified, true);
    assert.strictEqual(report.roi.leadIdentitySource, "STRICT_BITMAP_LABEL_TEMPLATE_V1");
    assert.ok(report.leadIdentity);
    assert.strictEqual(report.leadIdentity.verified, true);
    assert.strictEqual(report.analysisPermissions.specificLeadClaimsAllowed, true);
    assert.strictEqual(report.analysisPermissions.twelveLeadClaimsAllowed, true);
    assert.strictEqual(report.analysisPermissions.exactVoltageMeasurementAllowed, false);

    const extractionReceipt = persistImageExtraction(
      persisted.caseReceipt.path,
      persisted.fileIntake.result,
    );
    const extraction = readImageExtraction(
      persisted.caseReceipt.path,
      extractionReceipt.extractionId,
    );
    assert.strictEqual(extraction.analysisPermissions.specificLeadClaimsAllowed, true);
    assert.strictEqual(extraction.analysisPermissions.twelveLeadClaimsAllowed, true);
    assert.strictEqual(extraction.analysisPermissions.exactVoltageMeasurementAllowed, false);
    assert.throws(
      () => runImageSignalAnalysis(extraction, analysisConfig()),
      /IMAGE_ANALYSIS_MEASUREMENT_PERMISSION_REQUIRED/,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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

test("multi-page PDF pages have distinct case identity and persist the exact source plus selected page", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-image-multipage-case-"));
  try {
    const paper = paperFixture();
    const sourcePng = path.join(temp, "paper.png");
    const sourcePdf = path.join(temp, "paper.pdf");
    fs.writeFileSync(sourcePng, encodeGrayscalePng(paper.image));
    createTwoPagePdf(sourcePng, sourcePdf);
    const decoded = decodeImageSourceFile({ sourcePath: sourcePdf, pdfDpi: 72 });
    assert.strictEqual(decoded.pages.length, 2);

    const common = {
      sourcePath: sourcePdf,
      pdfDpi: 72,
      sourceKind: "original_digital_ecg_pdf",
      expectedRois: paper.rois,
      paperSpeedMmPerS: 25,
      gainMmPerMv: 10,
      roiLeadIdentityVerified: true,
      provenance: { locator: "case://multipage-pdf", projectGold: false },
    };
    const page0 = runImageFileIntake({
      ...common,
      pageIndex: 0,
      preflight: externalPreflight(decoded.pages[0].raster, "original_digital_ecg_pdf", "pdf"),
    });
    const page1 = runImageFileIntake({
      ...common,
      pageIndex: 1,
      preflight: externalPreflight(decoded.pages[1].raster, "original_digital_ecg_pdf", "pdf"),
    });
    assert.notStrictEqual(page0.result.report.caseId, page1.result.report.caseId);
    assert.strictEqual(page0.result.report.sourcePageIndex, 0);
    assert.strictEqual(page1.result.report.sourcePageIndex, 1);
    assert.strictEqual(page0.result.report.sourceSha256, page1.result.report.sourceSha256);

    const store = path.join(temp, "cases");
    const receipt0 = persistImageFileIntakeCase(store, page0);
    const receipt1 = persistImageFileIntakeCase(store, page1);
    const stored0 = readImageCase(receipt0.path);
    const stored1 = readImageCase(receipt1.path);
    assert.strictEqual(stored0.persistence.originalBytesPreserved, true);
    assert.strictEqual(stored1.persistence.originalBytesPreserved, true);
    assert.strictEqual(stored0.persistence.normalizedRasterPreserved, true);
    assert.strictEqual(stored1.persistence.normalizedRasterPreserved, true);
    assert.deepStrictEqual(
      fs.readFileSync(path.join(path.dirname(receipt0.path), "original.bin")),
      fs.readFileSync(sourcePdf),
    );
    assert.deepStrictEqual(
      fs.readFileSync(path.join(path.dirname(receipt1.path), "original.bin")),
      fs.readFileSync(sourcePdf),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("JPEG file intake persists exact source bytes and normalized raster through canonical case store", () => {
  withEncodedFixture("jpeg", ({ paper, encoded }) => {
    const decoded = decodeImageSourceFile({ sourcePath: encoded });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-jpeg-case-store-"));
    try {
      const persisted = runAndPersistImageFileIntake(root, {
        sourcePath: encoded,
        sourceKind: "phone_photo",
        expectedRois: paper.rois,
        paperSpeedMmPerS: 25,
        gainMmPerMv: 10,
        roiLeadIdentityVerified: true,
        preflight: externalPreflight(decoded.pages[0].raster, "phone_photo", "jpeg"),
        provenance: { locator: "case://jpeg-persisted-file-intake", projectGold: false },
      });
      const stored = readImageCase(persisted.caseReceipt.path);
      const caseDir = path.dirname(persisted.caseReceipt.path);
      assert.strictEqual(stored.report.sourceSha256, decoded.sourceSha256);
      assert.strictEqual(stored.report.sourcePageIndex, 0);
      assert.strictEqual(stored.persistence.originalBytesPreserved, true);
      assert.strictEqual(stored.persistence.normalizedRasterPreserved, true);
      assert.deepStrictEqual(fs.readFileSync(path.join(caseDir, "original.bin")), fs.readFileSync(encoded));
      assert.ok(fs.statSync(path.join(caseDir, "normalized.png")).size > 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("real JPEG reaches immutable extraction and immutable canonical analysis", () => {
  withEncodedFixture("jpeg", ({ paper, encoded }) => {
    const decoded = decodeImageSourceFile({ sourcePath: encoded });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-jpeg-full-chain-"));
    try {
      const persisted = runAndPersistImageFileIntake(root, {
        sourcePath: encoded,
        sourceKind: "phone_photo",
        expectedRois: paper.rois,
        paperSpeedMmPerS: 25,
        gainMmPerMv: 10,
        roiLeadIdentityVerified: true,
        preflight: externalPreflight(decoded.pages[0].raster, "phone_photo", "jpeg"),
        provenance: { locator: "case://jpeg-full-chain", projectGold: false },
      });
      const extractionReceipt = persistImageExtraction(
        persisted.caseReceipt.path,
        persisted.fileIntake.result,
      );
      const extraction = readImageExtraction(
        persisted.caseReceipt.path,
        extractionReceipt.extractionId,
      );
      const analysis = runImageSignalAnalysis(extraction, analysisConfig());
      const analysisReceipt = persistImageAnalysis(persisted.caseReceipt.path, analysis);
      const reopened = readImageAnalysis(
        persisted.caseReceipt.path,
        analysisReceipt.analysisId,
      );
      assert.strictEqual(reopened.caseId, persisted.caseReceipt.caseId);
      assert.strictEqual(reopened.extractionId, extractionReceipt.extractionId);
      assert.strictEqual(reopened.processedLeadCount, 12);
      assert.strictEqual(reopened.completeStandardTwelveLead, true);
      assert.strictEqual(reopened.diagnosticInterpretationIncluded, false);
      assert.strictEqual(reopened.runtimeAuthority, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test("original-digital-PDF source kind cannot be attached to a JPEG source", () => {
  withEncodedFixture("jpeg", ({ encoded }) => {
    assert.throws(() => runImageFileIntake({
      sourcePath: encoded,
      sourceKind: "original_digital_ecg_pdf",
      preflight: {},
      provenance: { locator: "case://source-kind-format-mismatch", projectGold: false },
    }), /IMAGE_FILE_INTAKE_SOURCE_KIND_FORMAT_MISMATCH/);
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
