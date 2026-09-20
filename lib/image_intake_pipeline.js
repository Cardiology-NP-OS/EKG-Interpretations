"use strict";

const crypto = require("crypto");
const { preflightInput } = require("./input_quality_guard");
const { localizeLeadRois } = require("./image_roi_localization");
const { discoverStandardLayoutRois } = require("./image_roi_discovery");
const { verifyLeadLabelsFromRaster } = require("./image_lead_identity");
const { estimateGridCalibration } = require("./image_grid_calibration");
const { digitizeLeadRois } = require("./image_digitization");
const { rotate90 } = require("./image_robustness");
const { deskewImage, detectPerspectiveCorners, rectifyPerspective } = require("./image_geometry_normalization");
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

function sha256Bytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return crypto.createHash("sha256").update(bytes).digest("hex");
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
    requireCondition(
      input.roiLeadIdentityVerified === true,
      "INTAKE_MEASUREMENT_ROI_LEAD_IDENTITY_UNVERIFIED",
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
  if (input.bytes !== undefined && input.bytes !== null) {
    requireCondition(
      (Buffer.isBuffer(input.bytes) || input.bytes instanceof Uint8Array) && input.bytes.length > 0,
      "INTAKE_SOURCE_BYTES",
    );
  }
  if (input.sourcePageIndex !== undefined) {
    requireCondition(
      Number.isInteger(input.sourcePageIndex) && input.sourcePageIndex >= 0 && input.sourcePageIndex < 8,
      "INTAKE_SOURCE_PAGE_INDEX",
    );
  }

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
  const suppliedRoisAtInput =
    Array.isArray(input.expectedRois) && input.expectedRois.length > 0;
  const explicitPerspectiveRequested =
    input.perspectiveCorners !== undefined && input.perspectiveCorners !== null;
  const automaticPerspectiveRequested = input.allowPerspectiveDetection === true;
  requireCondition(
    !(explicitPerspectiveRequested && automaticPerspectiveRequested),
    "INTAKE_PERSPECTIVE_MODE_CONFLICT",
  );
  const perspectiveRequested = explicitPerspectiveRequested || automaticPerspectiveRequested;
  requireCondition(
    !(suppliedRoisAtInput && perspectiveRequested),
    "INTAKE_PERSPECTIVE_WITH_EXPLICIT_ROIS_UNSUPPORTED",
  );
  requireCondition(
    !explicitPerspectiveRequested || input.perspectiveCornersVerified === true,
    "INTAKE_PERSPECTIVE_CORNERS_UNVERIFIED",
  );
  requireCondition(
    !(suppliedRoisAtInput && input.allowDeskewSearch === true),
    "INTAKE_DESKEW_WITH_EXPLICIT_ROIS_UNSUPPORTED",
  );
  requireCondition(
    !(suppliedRoisAtInput && input.verifyLeadLabelsFromRaster === true),
    "INTAKE_LEAD_LABEL_VERIFICATION_WITH_EXPLICIT_ROIS_UNSUPPORTED",
  );

  let perspective = null;
  let perspectiveDetection = null;
  let raster = sourceRaster;
  if (automaticPerspectiveRequested) {
    perspectiveDetection = detectPerspectiveCorners(sourceRaster, {
      darkThreshold: input.perspectiveDetectionDarkThreshold,
      maxSamples: input.perspectiveDetectionMaxSamples,
      minAreaFraction: input.perspectiveDetectionMinAreaFraction,
      minEdgeSupportFraction: input.perspectiveDetectionMinEdgeSupportFraction,
      edgeTolerancePx: input.perspectiveDetectionEdgeTolerancePx,
      edgeSamples: input.perspectiveDetectionEdgeSamples,
    });
  }
  if (perspectiveRequested) {
    const corners = explicitPerspectiveRequested
      ? input.perspectiveCorners
      : perspectiveDetection.corners;
    perspective = rectifyPerspective(sourceRaster, {
      corners,
      outputWidth: input.perspectiveOutputWidth,
      outputHeight: input.perspectiveOutputHeight,
    });
    raster = perspective.image;
  }

  let deskew = null;
  if (input.allowDeskewSearch === true) {
    deskew = deskewImage(raster, {
      maxAbsDegrees: input.maxDeskewDegrees,
      stepDegrees: input.deskewStepDegrees,
      darkThreshold: input.deskewDarkThreshold,
      maxSamples: input.deskewMaxSamples,
      minimumCorrectionDegrees: input.minimumDeskewCorrectionDegrees,
      trimWhiteBorder: true,
      cropThreshold: input.deskewCropThreshold,
    });
    raster = deskew.image;
  }
  let orientationTurns = 0;
  let grid = null;
  let expectedRois = input.expectedRois;
  let discovery = null;
  let leadIdentity = null;
  let rois = null;
  let digitized = null;
  const suppliedRois = suppliedRoisAtInput;
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
      let candidateLeadIdentity = null;
      if (!suppliedRois) {
        candidateDiscovery = discoverStandardLayoutRois({
          image: raster,
          pxPerMm: candidateGrid.pxPerMm,
          paperSpeedMmPerS: candidateGrid.paperSpeedMmPerS,
          inkCeiling: input.inkCeiling,
        });
        candidateExpectedRois = candidateDiscovery.rois;
        if (input.verifyLeadLabelsFromRaster === true) {
          candidateLeadIdentity = verifyLeadLabelsFromRaster({
            image: raster,
            rois: candidateExpectedRois,
            scale: input.leadLabelScale,
            darkThreshold: input.leadLabelDarkThreshold,
            searchRadius: input.leadLabelSearchRadius,
            minScore: input.leadLabelMinScore,
            offsetX: input.leadLabelOffsetX,
            offsetY: input.leadLabelOffsetY,
          });
          requireCondition(
            candidateLeadIdentity.verified === true,
            "INTAKE_LEAD_IDENTITY_VERIFICATION_FAILED",
          );
          candidateExpectedRois = candidateExpectedRois.map(roi => ({
            ...roi,
            leadIdentitySource: candidateLeadIdentity.method,
            leadIdentityVerified: true,
          }));
          candidateDiscovery = {
            ...candidateDiscovery,
            rois: candidateExpectedRois,
            leadIdentitySource: candidateLeadIdentity.method,
            leadIdentityVerified: true,
          };
        }
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
        allowTraceBaselineEstimation: input.allowTraceBaselineEstimation === true,
        baselineMinObservedColumns: input.baselineMinObservedColumns,
        baselineTolerancePx: input.baselineTolerancePx,
        baselineMinInlierFraction: input.baselineMinInlierFraction,
        baselineMinDominantFraction: input.baselineMinDominantFraction,
      });
      grid = candidateGrid;
      expectedRois = candidateExpectedRois;
      discovery = candidateDiscovery;
      leadIdentity = candidateLeadIdentity;
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
  const explicitTimeCalibration =
    grid.speedSource === "EXPLICIT" &&
    grid.localScaleTrustworthy === true;
  const verifiedVoltageBaseline =
    digitized.leads.every(lead =>
      lead.quality &&
      (lead.quality.baselineSource === "EXPLICIT_ROI" ||
       lead.quality.baselineSource === "TRACE_BASELINE_VERIFIED")
    );
  const explicitVoltageCalibration =
    grid.gainSource === "EXPLICIT" &&
    grid.localScaleTrustworthy === true &&
    verifiedVoltageBaseline;
  const sourceTimePermission =
    (preflight ? preflight.exactTimeMeasurementAllowed === true : true) &&
    explicitTimeCalibration;
  const sourceVoltagePermission =
    (preflight ? preflight.exactVoltageMeasurementAllowed === true : true) &&
    explicitVoltageCalibration;
  const leadIdentityVerified = suppliedRois
    ? input.roiLeadIdentityVerified === true
    : leadIdentity && leadIdentity.verified === true;
  const leadIdentitySource = suppliedRois
    ? (leadIdentityVerified ? "EXPLICIT_ROI_ATTESTATION" : "UNVERIFIED_EXPLICIT_ROI")
    : (leadIdentity ? leadIdentity.method : "POSITIONAL_LAYOUT_HYPOTHESIS");

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
      format: normalizeTransportFormat(input.format),
      sourcePageIndex: input.sourcePageIndex === undefined ? 0 : input.sourcePageIndex,
      sourceSha256: input.bytes ? sha256Bytes(input.bytes) : null,
      normalizedRasterSha256: sha256Json(raster),
    }),
    sourceKind: input.sourceKind,
    format: input.format,
    sourcePageIndex: input.sourcePageIndex === undefined ? 0 : input.sourcePageIndex,
    sourceSha256: input.bytes ? sha256Bytes(input.bytes) : null,
    encodedSource: decodedPng ? "png-v1" : null,
    locator: input.provenance.locator,
    rasterWidth: raster[0].length,
    rasterHeight: raster.length,
    geometryNormalization: {
      perspective: perspective ? {
        applied: true,
        corners: perspective.corners,
        outputWidth: perspective.outputWidth,
        outputHeight: perspective.outputHeight,
        method: perspective.method,
        source: automaticPerspectiveRequested ? "AUTOMATIC_DARK_SUPPORT" : "EXPLICIT_VERIFIED",
        cornersVerified: explicitPerspectiveRequested && input.perspectiveCornersVerified === true,
        detection: perspectiveDetection ? {
          method: perspectiveDetection.method,
          darkThreshold: perspectiveDetection.darkThreshold,
          darkPixelCount: perspectiveDetection.darkPixelCount,
          sampledSupportPoints: perspectiveDetection.sampledSupportPoints,
          areaFraction: perspectiveDetection.areaFraction,
          edgeSupport: perspectiveDetection.edgeSupport,
          minEdgeSupportFraction: perspectiveDetection.minEdgeSupportFraction,
          edgeTolerancePx: perspectiveDetection.edgeTolerancePx,
        } : null,
      } : {
        applied: false,
        corners: null,
        outputWidth: null,
        outputHeight: null,
        method: "NONE",
        source: "NONE",
        cornersVerified: false,
        detection: null,
      },
      deskewApplied: deskew ? deskew.appliedDegrees !== 0 : false,
      deskewCorrectionDegrees: deskew ? deskew.appliedDegrees : 0,
      deskewEstimatedCorrectionDegrees: deskew ? deskew.estimate.correctionDegrees : 0,
      deskewScoreGain: deskew ? deskew.estimate.scoreGain : 0,
      crop: deskew ? deskew.crop : null,
      deskewMethod: deskew ? deskew.method : "NONE",
    },
    orientationTurns,
    roiSource: discovery ? "DISCOVERED_3X4_RHYTHM" : "EXPLICIT",
    roi: {
      roiCount: rois.roiCount,
      completeTwelveLeadPanels: rois.completeTwelveLeadPanels,
      missingStandardLeads: rois.missingStandardLeads,
      leadIdentityVerified,
      leadIdentitySource,
    },
    leadIdentity: leadIdentity ? {
      method: leadIdentity.method,
      verified: leadIdentity.verified,
      verifiedLeadCount: leadIdentity.verifiedLeadCount,
      totalLeadCount: leadIdentity.totalLeadCount,
      failedLabels: leadIdentity.failedLabels,
      missingStandardLeads: leadIdentity.missingStandardLeads,
      minScore: leadIdentity.minScore,
    } : null,
    calibration: {
      pxPerMm: grid.pxPerMm,
      paperSpeedMmPerS: grid.paperSpeedMmPerS,
      gainMmPerMv: grid.gainMmPerMv,
      localScaleTrustworthy: grid.localScaleTrustworthy,
      speedSource: grid.speedSource,
      gainSource: grid.gainSource,
      verifiedVoltageBaseline,
      baselineSources: [...new Set(digitized.leads.map(lead => lead.quality.baselineSource))],
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
      roiLeadIdentityVerified: suppliedRois && input.roiLeadIdentityVerified === true,
      leadIdentityVerified,
      leadIdentitySource,
    } : null,
    analysisPermissions: preflight ? {
      safePartialAnalysisAllowed: preflight.safePartialAnalysisAllowed === true,
      exactTimeMeasurementAllowed: sourceTimePermission,
      exactVoltageMeasurementAllowed: sourceVoltagePermission,
      specificLeadClaimsAllowed:
        preflight.specificLeadClaimsAllowed === true &&
        leadIdentityVerified === true,
      twelveLeadClaimsAllowed:
        preflight.twelveLeadClaimsAllowed === true &&
        leadIdentityVerified === true &&
        rois.completeTwelveLeadPanels === true,
      measurementsReliable: preflight.measurementsReliable === true,
    } : {
      safePartialAnalysisAllowed: true,
      exactTimeMeasurementAllowed: sourceTimePermission,
      exactVoltageMeasurementAllowed: sourceVoltagePermission,
      specificLeadClaimsAllowed: leadIdentityVerified === true,
      twelveLeadClaimsAllowed: leadIdentityVerified === true && rois.completeTwelveLeadPanels === true,
      measurementsReliable: true,
    },
    exactTimeMeasurementAllowed: sourceTimePermission,
    exactVoltageMeasurementAllowed: sourceVoltagePermission,
    ...INTAKE_GOVERNANCE,
  };

  return {
    schema: "ekg-image-intake-pipeline-v1",
    report,
    rois,
    discovery,
    leadIdentity,
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
