"use strict";

const crypto = require("crypto");
const { preflightInput } = require("./input_quality_guard");
const { localizeLeadRois } = require("./image_roi_localization");
const { discoverStandardLayoutRois } = require("./image_roi_discovery");
const { estimateGridCalibration } = require("./image_grid_calibration");
const { digitizeLeadRois } = require("./image_digitization");
const { rotate90 } = require("./image_robustness");
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
  if ((input.format === "png" || input.format === "jpeg" || input.format === "jpg") && !input.raster) {
    throw new Error("INTAKE_ENCODED_IMAGE_RASTERIZATION_REQUIRED");
  }
  requireCondition(Array.isArray(input.raster) && input.raster.length > 0, "INTAKE_RASTER_REQUIRED");

  const preflight = input.preflight ? preflightInput(input.preflight) : null;
  if (preflight && preflight.pass === false && preflight.safePartialAnalysisAllowed === false) {
    throw new Error("INTAKE_PREFLIGHT_BLOCKED");
  }

  let raster = input.raster;
  let orientationTurns = 0;
  let grid = null;
  let expectedRois = input.expectedRois;
  let discovery = null;
  const suppliedRois = Array.isArray(expectedRois) && expectedRois.length > 0;
  const maxTurns = input.allowOrientationSearch === true ? 4 : 1;
  let lastError = null;
  for (let turn = 0; turn < maxTurns; turn += 1) {
    try {
      grid = estimateGridCalibration({
        image: raster,
        paperSpeedMmPerS: input.paperSpeedMmPerS,
        gainMmPerMv: input.gainMmPerMv,
      });
      if (!suppliedRois) {
        discovery = discoverStandardLayoutRois({
          image: raster,
          pxPerMm: grid.pxPerMm,
          paperSpeedMmPerS: grid.paperSpeedMmPerS,
          inkCeiling: input.inkCeiling,
        });
        expectedRois = discovery.rois;
      }
      lastError = null;
      orientationTurns = turn;
      break;
    } catch (error) {
      lastError = error;
      if (turn === maxTurns - 1) throw error;
      raster = rotate90(raster);
    }
  }
  requireCondition(grid && Array.isArray(expectedRois) && expectedRois.length > 0, lastError ? lastError.message : "INTAKE_LAYOUT_REQUIRED");

  const rois = localizeLeadRois({
    image: raster,
    expectedRois,
    inkCeiling: input.inkCeiling,
    minInkFraction: input.minInkFraction,
  });
  const digitized = digitizeLeadRois({
    image: raster,
    rois: expectedRois.map(box => ({
      ...box,
      baselineY: box.baselineY,
    })),
    calibration: grid,
    inkCeiling: input.inkCeiling === undefined ? 80 : input.inkCeiling,
  });

  let measurements = null;
  const measureLead = (input.measureLead || "II");
  const chosen = digitized.leads.find(lead => lead.lead === measureLead && lead.rhythmStrip) ||
    digitized.leads.find(lead => lead.lead === measureLead);
  if (input.connectMeasurements === true && chosen) {
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
      rasterSha: sha256Json(input.raster),
    }),
    sourceKind: input.sourceKind,
    format: input.format,
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
