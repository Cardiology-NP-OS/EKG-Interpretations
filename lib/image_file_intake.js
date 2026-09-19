"use strict";

const { decodeImageSourceFile } = require("./image_decoder_bridge");
const { runImageIntakePipeline } = require("./image_intake_pipeline");
const { persistImageIntakeCase } = require("./image_case_store");

const FILE_INTAKE_GOVERNANCE = Object.freeze({
  runtimeAuthority: false,
  projectGold: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function runImageFileIntake(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "IMAGE_FILE_INTAKE_INPUT_REQUIRED");
  requireCondition(typeof input.sourcePath === "string" && input.sourcePath.length > 0, "IMAGE_FILE_INTAKE_SOURCE_PATH");
  requireCondition(typeof input.sourceKind === "string" && input.sourceKind !== "synthetic_raster", "IMAGE_FILE_INTAKE_SOURCE_KIND");
  requireCondition(input.provenance && typeof input.provenance === "object", "IMAGE_FILE_INTAKE_PROVENANCE");
  requireCondition(input.preflight && typeof input.preflight === "object", "IMAGE_FILE_INTAKE_PREFLIGHT_REQUIRED");

  const decoded = decodeImageSourceFile({
    sourcePath: input.sourcePath,
    pdfDpi: input.pdfDpi,
  });
  if (input.sourceKind === "original_digital_ecg_pdf") {
    requireCondition(decoded.sourceFormat === "pdf", "IMAGE_FILE_INTAKE_SOURCE_KIND_FORMAT_MISMATCH");
  }
  const pageIndex = input.pageIndex === undefined ? 0 : input.pageIndex;
  requireCondition(
    Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < decoded.pages.length,
    "IMAGE_FILE_INTAKE_PAGE_INDEX",
  );
  const page = decoded.pages[pageIndex];

  const intakeInput = {
    sourceKind: input.sourceKind,
    format: decoded.sourceFormat,
    raster: page.raster,
    bytes: decoded.originalBytes,
    sourcePageIndex: pageIndex,
    expectedRois: input.expectedRois,
    paperSpeedMmPerS: input.paperSpeedMmPerS,
    gainMmPerMv: input.gainMmPerMv,
    provenance: input.provenance,
    preflight: input.preflight,
    roiLeadIdentityVerified: input.roiLeadIdentityVerified === true,
    allowOrientationSearch: input.allowOrientationSearch === true,
    connectMeasurements: input.connectMeasurements === true,
    measureLead: input.measureLead,
    measurementConfig: input.measurementConfig,
    inkCeiling: input.inkCeiling,
    minInkFraction: input.minInkFraction,
    maxHeldColumns: input.maxHeldColumns,
  };
  for (const key of Object.keys(intakeInput)) {
    if (intakeInput[key] === undefined) delete intakeInput[key];
  }

  const result = runImageIntakePipeline(intakeInput);
  return {
    schema: "ekg-image-file-intake-v1",
    intakeInput,
    result,
    decoder: {
      schema: decoded.schema,
      sourceFormat: decoded.sourceFormat,
      sourceSha256: decoded.sourceSha256,
      sourceBytes: decoded.sourceBytes,
      pageIndex,
      pageCount: decoded.pages.length,
      page: {
        width: page.width,
        height: page.height,
        originalOrientation: page.originalOrientation,
        rasterSha256: page.rasterSha256,
      },
      normalization: decoded.normalization,
      decoder: decoded.decoder,
    },
    ...FILE_INTAKE_GOVERNANCE,
  };
}

function persistImageFileIntakeCase(root, fileIntake) {
  requireCondition(
    fileIntake &&
    fileIntake.schema === "ekg-image-file-intake-v1" &&
    fileIntake.intakeInput &&
    fileIntake.result,
    "IMAGE_FILE_INTAKE_RESULT_REQUIRED",
  );
  return persistImageIntakeCase(root, fileIntake.intakeInput, fileIntake.result);
}

function runAndPersistImageFileIntake(root, input) {
  const fileIntake = runImageFileIntake(input);
  return {
    fileIntake,
    caseReceipt: persistImageFileIntakeCase(root, fileIntake),
  };
}

module.exports = {
  FILE_INTAKE_GOVERNANCE,
  runImageFileIntake,
  persistImageFileIntakeCase,
  runAndPersistImageFileIntake,
};
