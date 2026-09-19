"use strict";

const crypto = require("crypto");
const { preflightInput } = require("./input_quality_guard");
const { localizeLeadRois } = require("./image_roi_localization");
const { discoverStandardLayoutRois } = require("./image_roi_discovery");
const { estimateGridCalibration } = require("./image_grid_calibration");
const { digitizeLeadRois } = require("./image_digitization");
const { rotate90 } = require("./image_robustness");
const { decodePngToGrayscale } = require("./image_png_codec");
const { runPhysicalLeadMeasurementPipeline } = require("./signal_measurement_pipeline");

const INTAKE_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
});

const SOURCE_KINDS = new Set([
  "original_digital_ecg_pdf",
  "scanned_paper_ecg",
  "phone_photo",
  "screenshot",
  "cropped_lead_strip",
  "synthetic_raster",
]);
const FORMATS = new Set(["pdf", "png", "jpeg", "jpg", "raster_matrix"]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function defaultMeasurementConfig() {
  return {
    detector: { minAbsoluteDeviation: 0.25, refractoryMs: 240 },
    delineation: {
      baseline: 0,
      qrs: { threshold: 0.35, beforeMs: 80, afterMs: 80 },
      p: { threshold: 0.15, searchStartMsBeforeR: 240, searchEndMsBeforeR: 80 },
      t: { threshold: 0.2, searchStartMsAfterR: 100, searchEndMsAfterR: 400 },
    },
  };
}

function normalizeTransportFormat(value) {
  const format = String(value || "").toLowerCase();
  return format === "jpg" ? "jpeg" : format;
}

function validateExternalPreflightBinding(input, sourceRaster) {
  if (input.sourceKind === "synthetic_raster") return null;
  requireCondition(
    input.preflight && typeof input.preflight === "object" && !Array.isArray(input.preflight),
    "INTAKE_PREFLIGHT_REQUIRED",
  );
  const result = preflightInput(input.preflight);
  requireCondition(
    result && result.safePartialAnalysisAllowed === true,
    "INTAKE_PREFLIGHT_BLOCKED",
  );
  requireCondition(result.sourceBinding && typeof result.sourceBinding === "object", "INTAKE_PREFLIGHT_BINDING_REQUIRED");
  const binding = result.sourceBinding;
  requireCondition(binding.sourceKind === input.sourceKind, "INTAKE_PREFLIGHT_SOURCE_KIND_MISMATCH");
  requireCondition(
    normalizeTransportFormat(binding.format) === normalizeTransportFormat(input.format),
    "INTAKE_PREFLIGHT_FORMAT_MISMATCH",
  );
  requireCondition(
    binding.imageWidthPx === sourceRaster[0].length &&
    binding.imageHeightPx === sourceRaster.length,
    "INTAKE_PREFLIGHT_DIMENSIONS_MISMATCH",
  );
  if (input.paperSpeedMmPerS !== undefined) {
    requireCondition(
      binding.paperSpeedMmPerS === input.paperSpeedMmPerS,
      "INTAKE_PREFLIGHT_PAPER_SPEED_MISMATCH",
    );
  }
  if (input.gainMmPerMv !== undefined) {
    requireCondition(
      binding.gainMmPerMv === input.gainMmPerMv,
      "INTAKE_PREFLIGHT_GAIN_MISMATCH",
    );
  }
  return result;
}

function requireMeasurementEligibility(input, suppliedRois, expectedRois, grid, preflight) {
  if (input.connectMeasurements !== true) return;
  requireCondition(suppliedRois, "INTAKE_MEASUREMENT_EXPLICIT_ROIS_REQUIRED");
  requireCondition(
    input.paperSpeedMmPerS !== undefined && input.gainMmPerMv !== undefined,
    "INTAKE_MEASUREMENT_EXPLICIT_CALIBRATION_REQUIRED",
  );
  requireCondition(
    grid.speedSource === "EXPLICIT" && grid.gainSource === "EXPLICIT",
    "INTAKE_MEASUREMENT_EXPLICIT_CALIBRATION_REQUIRED",
  );
  requireCondition(grid.localScaleTrustworthy === true, "INTAKE_MEASUREMENT_SCALE_UNTRUSTWORTHY");
  requireCondition(
    expectedRois.every((box) =>
      Number.isInteger(box.baselineY) &&
      box.baselineY >= box.y &&
      box.baselineY < box.y + box.height
    ),
    "INTAKE_MEASUREMENT_BASELINE_REQUIRED",
  );
  if (preflight) {
    requireCondition(
      preflight.exactTimeMeasurementAllowed === true &&
      preflight.exactVoltageMeasurementAllowed === true &&
      preflight.specificLeadClaimsAllowed === true &&
      preflight.measurementsReliable === true,
      "INTAKE_MEASUREMENT_PREFLIGHT_DISALLOWED",
    );
  }
}

function runImageIntakePipeline(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "INTAKE_INPUT_REQUIRED");
  requireCondition(typeof input.sourceKind === "string" && SOURCE_KINDS.has(input.sourceKind), "INTAKE_SOURCE_KIND");
  requireCondition(typeof input.format === "string" && FORMATS.has(input.format), "INTAKE_FORMAT");
  requireCondition(input.provenance && typeof input.provenance === "object", "INTAKE_PROVENANCE_REQUIRED");
  requireCondition(input.provenance.projectGold !== true, "INTAKE_PROJECT_GOLD_FORBIDDEN");
  requireCondition(input.provenance.runtimeAuthority !== true, "INTAKE_RUNTIME_AUTHORITY_FORBIDDEN");
  requireCondition(typeof input.provenance.locator === "string" && input.provenance.locator.length > 0, "INTAKE_LOCATOR");

  if (input.format === "pdf" && !input.raster) {
    throw new Error("INTAKE_PDF_RASTERIZATION_REQUIRED");
  }
  if ((input.format === "jpeg" || input.format === "jpg") && !input.raster) {
    throw new Error("INTAKE_ENCODED_IMAGE_RASTERIZATION_REQUIRED");
  }
  let decodedPng = null;
  if (!input.raster && input.format === "png") {
    requireCondition(input.bytes, "INTAKE_PNG_BYTES_REQUIRED");
    decodedPng = decodePngToGrayscale(input.bytes);
  }
  const sourceRaster = input.raster || (decodedPng ? decodedPng.image : null);
  requireCondition(Array.isArray(sourceRaster) && sourceRaster.length > 0, "INTAKE_RASTER_REQUIRED");

  const preflight = validateExternalPreflightBinding(input, sourceRaster);

  let raster = sourceRaster;
  let orientationTurns = 0;
  let grid = null;
  let expectedRois = input.expectedRois;
  let discovery = null;
  let rois = null;
  let digitized = null;
  const suppliedRois = Array.isArray(expectedRois) && expectedRois.length > 0;
  requireCondition(
    !(suppliedRois && input.allowOrientationSearch === true),
    "INTAKE_ORIENTATION_WITH_EXPLICIT_ROIS_UNSUPPORTED",
  );
  const maxTurns = input.allowOrientationSearch === true ? 4 : 1;
  let lastError = null;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    try {
      const candidateGrid = estimateGridCalibration({
        image: raster,
        paperSpeedMmPerS: input.paperSpeedMmPerS,
        gainMmPerMv: input.gainMmPerMv,
      });
      let candidateDiscovery = null;
      let candidateExpectedRois = input.expectedRois;
      if (!suppliedRois) {
        candidateDiscovery = discoverStandardLayoutRois({
          image: raster,
          pxPerMm: candidateGrid.pxPerMm,
          paperSpeedMmPerS: candidateGrid.paperSpeedMmPerS,
          inkCeiling: input.inkCeiling,
        });
        candidateExpectedRois = candidateDiscovery.rois;
      }
      const candidateRois = localizeLeadRois({
        image: raster,
        expectedRois: candidateExpectedRois,
        inkCeiling: input.inkCeiling,
        minInkFraction: input.minInkFraction,
      });
      const candidateDigitized = digitizeLeadRois({
        image: raster,
        rois: candidateExpectedRois.map(box => ({
          ...box,
          baselineY: box.baselineY,
        })),
        calibration: candidateGrid,
        inkCeiling: input.inkCeiling === undefined ? 80 : input.inkCeiling,
        maxHeldColumns: input.maxHeldColumns,
      });
      grid = candidateGrid;
      expectedRois = candidateExpectedRois;
      discovery = candidateDiscovery;
      rois = candidateRois;
      digitized = candidateDigitized;
      lastError = null;
      orientationTurns = turn;
      break;
    } catch (error) {
      lastError = error;
      if (turn === maxTurns - 1) throw error;
      raster = rotate90(raster);
    }
  }
  requireCondition(
    grid && rois && digitized && Array.isArray(expectedRois) && expectedRois.length > 0,
    lastError ? lastError.message : "INTAKE_LAYOUT_REQUIRED",
  );

  let measurements = null;
  const measureLead = (input.measureLead || "II");
  const chosen = digitized.leads.find(lead => lead.lead === measureLead && lead.rhythmStrip) ||
    digitized.leads.find(lead => lead.lead === measureLead);
  requireMeasurementEligibility(input, suppliedRois, expectedRois, grid, preflight);
  if (input.connectMeasurements === true) {
    requireCondition(chosen, "INTAKE_MEASUREMENT_LEAD_NOT_FOUND");
    measurements = runPhysicalLeadMeasurementPipeline({
      physicalLead: {
        record: String(input.provenance.locator),
        leadName: chosen.lead,
        sampleRateHz: chosen.sampleRateHz,
        samples: chosen.samples,
        unit: "mV",
        calibration: {
          paperSpeedMmPerS: grid.paperSpeedMmPerS,
          gainMmPerMv: grid.gainMmPerMv,
          source: "image-grid-v1",
        },
      },
      provenance: {
        sourceKind: input.sourceKind,
        locator: input.provenance.locator,
        projectGold: false,
        runtimeAuthority: false,
      },
      config: input.measurementConfig || defaultMeasurementConfig(),
    });
  }

  const report = {
    schema: "ekg-image-intake-report-v1",
    caseId: sha256Json({
      locator: input.provenance.locator,
      sourceKind: input.sourceKind,
      rasterSha: decodedPng ? crypto.createHash("sha256").update(Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes)).digest("hex") : sha256Json(input.raster),
    }),
    sourceKind: input.sourceKind,
    format: input.format,
    encodedSource: decodedPng ? "png-v1" : null,
    locator: input.provenance.locator,
    rasterWidth: raster[0].length,
    rasterHeight: raster.length,
    orientationTurns,
    roiSource: discovery ? "DISCOVERED_3X4_RHYTHM" : "EXPLICIT",
    roi: {
      roiCount: rois.roiCount,
      completeTwelveLeadPanels: rois.completeTwelveLeadPanels,
      missingStandardLeads: rois.missingStandardLeads,
    },
    calibration: {
      pxPerMm: grid.pxPerMm,
      paperSpeedMmPerS: grid.paperSpeedMmPerS,
      gainMmPerMv: grid.gainMmPerMv,
      localScaleTrustworthy: grid.localScaleTrustworthy,
      speedSource: grid.speedSource,
      gainSource: grid.gainSource,
    },
    digitizedLeadCount: digitized.leadCount,
    sampleRateHz: digitized.sampleRateHz,
    unit: digitized.unit,
    leadNames: digitized.leads.map(lead => lead.lead),
    measurementsConnected: measurements !== null,
    measurementLead: measurements ? measureLead : null,
    preflightPass: preflight ? preflight.pass : null,
    preflight: preflight ? {
      technicalQualityGrade: preflight.technicalQualityGrade,
      warningStates: preflight.warningStates,
      fatalCodes: preflight.fatalCodes,
      blockedConclusions: preflight.blockedConclusions,
      sourceBinding: preflight.sourceBinding,
    } : null,
    analysisPermissions: preflight ? {
      safePartialAnalysisAllowed: preflight.safePartialAnalysisAllowed === true,
      exactTimeMeasurementAllowed: preflight.exactTimeMeasurementAllowed === true,
      exactVoltageMeasurementAllowed: preflight.exactVoltageMeasurementAllowed === true,
      specificLeadClaimsAllowed: preflight.specificLeadClaimsAllowed === true && suppliedRois,
      twelveLeadClaimsAllowed: preflight.twelveLeadClaimsAllowed === true && suppliedRois && rois.completeTwelveLeadPanels === true,
      measurementsReliable: preflight.measurementsReliable === true,
    } : {
      safePartialAnalysisAllowed: true,
      exactTimeMeasurementAllowed: grid.localScaleTrustworthy === true,
      exactVoltageMeasurementAllowed: grid.localScaleTrustworthy === true,
      specificLeadClaimsAllowed: true,
      twelveLeadClaimsAllowed: rois.completeTwelveLeadPanels === true,
      measurementsReliable: true,
    },
    exactTimeMeasurementAllowed: preflight ? preflight.exactTimeMeasurementAllowed : grid.localScaleTrustworthy,
    exactVoltageMeasurementAllowed: preflight ? preflight.exactVoltageMeasurementAllowed : grid.localScaleTrustworthy,
    ...INTAKE_GOVERNANCE,
  };

  return {
    schema: "ekg-image-intake-pipeline-v1",
    report,
    rois,
    discovery,
    grid,
    digitized,
    measurements,
    ...INTAKE_GOVERNANCE,
  };
}

module.exports = {
  INTAKE_GOVERNANCE,
  runImageIntakePipeline,
};
