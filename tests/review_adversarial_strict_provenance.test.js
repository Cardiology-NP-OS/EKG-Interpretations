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
const { persistImageAnalysis } = require("../lib/image_analysis_store");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-review-strict-provenance-"));
try {
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
    roiLeadIdentityVerified: true,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    strictTraceMaxThicknessPx: 100,
    provenance: { locator: "case://review-strict-provenance", projectGold: false },
  };
  const intake = runImageIntakePipeline(input);
  const caseReceipt = persistImageIntakeCase(root, input, intake);
  const extractionReceipt = persistImageExtraction(caseReceipt.path, intake);
  const extraction = readImageExtraction(caseReceipt.path, extractionReceipt.extractionId);
  const analysis = runImageSignalAnalysis(extraction, {
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
    thresholdAuthority: "SYNTHETIC_ADVERSARIAL_REVIEW_ONLY",
    quality: {
      maxHeldGapColumns: 2,
      maxHeldFraction: 0.2,
      maxAmplitudeUncertaintyMv: 1,
      maxTimePixelUncertaintyMs: 4,
    },
  });
  const forged = JSON.parse(JSON.stringify(analysis));
  forged.implementations[0].sha256 = "0".repeat(64);
  assert.throws(
    () => persistImageAnalysis(caseReceipt.path, forged),
    /IMAGE_ANALYSIS_IMPLEMENTATION_HASH_MISMATCH/,
    "strict analysis persistence must reject a syntactically valid but false implementation hash",
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
