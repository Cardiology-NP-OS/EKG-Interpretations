"use strict";

const fs = require("fs");
const path = require("path");
const { runAndPersistImageFileIntake, runImageFileIntake } = require("../lib/image_file_intake");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis, validateConfig } = require("../lib/image_signal_analysis");
const { validateMeasurementConfig } = require("../lib/signal_measurement_pipeline");
const { persistImageAnalysis } = require("../lib/image_analysis_store");
const CASE_ID_RE = /^[a-f0-9]{64}$/;
const { buildClinicianReaderModel } = require("../lib/clinician_reader_model");
const { persistClinicianCorrection } = require("../lib/clinician_correction_store");
const { writeExecution } = require("./run_ecg_pipeline");

const ENGINEERING_DISCLAIMER = "Engineering output - not clinically validated. Clinician review required.";

const AUTHORITY = Object.freeze({
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  runtimeAuthority: false,
  projectGold: false,
  clinicalAuthorityAdded: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function stripPath(receipt) {
  if (!receipt || typeof receipt !== "object") return receipt;
  const out = { ...receipt };
  if (typeof out.path === "string") out.file = path.basename(out.path);
  delete out.path;
  return out;
}
function status() {
  return {
    schema: "ekg-specialist-provider-status-v1",
    provider: "Cardiology-NP-OS/EKG-Interpretations",
    interfaceVersion: 1,
    operations: {
      status: { available: true },
      waveform_execute: { available: true, input: "LOCAL_WFDB_FILES" },
      image_file_intake: { available: true, input: "PNG_JPEG_PDF_FILE", persistence: false },
      image_case_pipeline: { available: true, input: "PNG_JPEG_PDF_FILE", persistence: true },
      image_case_reader_pipeline: { available: true, input: "PNG_JPEG_PDF_FILE", persistence: true, returnsStructuredReader: true },
      image_review: { available: true, input: "CONTENT_ADDRESSED_EXTRACTION" },
      clinician_reader: { available: true, input: "PERSISTED_CASE_PATH_AND_ANALYSIS_ID", persistence: false },
      clinician_correction_append: { available: true, input: "PERSISTED_CASE_PATH_ANALYSIS_ID_REVIEWER_STATEMENT", persistence: true, appendOnly: true },
    },
    imageCapabilities: {
      png: true,
      jpeg: true,
      pdf: true,
      orientationNormalization: true,
      deskew: true,
      perspectiveCorrection: true,
      leadLocalization: true,
      leadIdentityVerification: true,
      gridCalibration: true,
      digitization: true,
      immutableCases: true,
      immutableExtractions: true,
      immutableAnalyses: true,
      multileadReview: true,
      structuredClinicianReader: true,
      appendOnlyClinicianCorrectionProvider: true,
      endToEndPersistedReaderWorkflow: true,
    },
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}

function summarizeReview(review) {
  return {
    ...review,
    disclaimer: ENGINEERING_DISCLAIMER,
    origin: "SYSTEM_DERIVED",
    reviewState: "UNREVIEWED",
  };
}

function assertInactive(result) {
  requireCondition(result && typeof result === "object", "PROVIDER_RESULT_REQUIRED");
  for (const [key, value] of Object.entries(AUTHORITY)) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      requireCondition(result[key] === value, "PROVIDER_AUTHORITY_BOUNDARY");
    }
  }
  requireCondition(result.diagnosticInterpretationIncluded !== true, "PROVIDER_DIAGNOSTIC_OUTPUT_FORBIDDEN");
  return result;
}

function runImageReview(request) {
  requireCondition(request.extraction && typeof request.extraction === "object", "PROVIDER_EXTRACTION_REQUIRED");
  requireCondition(request.analysisConfig && typeof request.analysisConfig === "object", "PROVIDER_ANALYSIS_CONFIG_REQUIRED");
  validateConfig(request.analysisConfig);
  validateMeasurementConfig(request.analysisConfig.measurement);
  return assertInactive(runImageSignalAnalysis(request.extraction, request.analysisConfig));
}

function runImageFile(request) {
  requireCondition(request.input && typeof request.input === "object", "PROVIDER_IMAGE_INPUT_REQUIRED");
  const out = assertInactive(runImageFileIntake(request.input));
  return {
    schema: "ekg-specialist-image-file-intake-result-v1",
    decoder: out.decoder,
    report: out.result.report,
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}
function runImageCasePipeline(request) {
  requireCondition(typeof request.caseRoot === "string" && request.caseRoot.length > 0, "PROVIDER_CASE_ROOT_REQUIRED");
  requireCondition(request.input && typeof request.input === "object", "PROVIDER_IMAGE_INPUT_REQUIRED");
  requireCondition(request.analysisConfig && typeof request.analysisConfig === "object", "PROVIDER_ANALYSIS_CONFIG_REQUIRED");

  validateConfig(request.analysisConfig);
  validateMeasurementConfig(request.analysisConfig.measurement);
  const persisted = runAndPersistImageFileIntake(request.caseRoot, request.input);
  const extractionReceipt = persistImageExtraction(persisted.caseReceipt.path, persisted.fileIntake.result);
  const extraction = readImageExtraction(persisted.caseReceipt.path, extractionReceipt.extractionId);
  const review = assertInactive(runImageSignalAnalysis(extraction, request.analysisConfig));
  const analysisReceipt = persistImageAnalysis(persisted.caseReceipt.path, review);

  return {
    schema: "ekg-specialist-image-case-pipeline-result-v1",
    case: stripPath(persisted.caseReceipt),
    extraction: stripPath(extractionReceipt),
    analysis: stripPath(analysisReceipt),
    review: summarizeReview(review),
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}

function resolveCasePath(request, code) {
  // Locator presence, not its truthy value, determines mutually exclusive routes.
  // Reject mixed/partial handles before any persisted-case filesystem access.
  const hasPath = Object.hasOwn(request, "casePath");
  const hasRoot = Object.hasOwn(request, "caseRoot");
  const hasId = Object.hasOwn(request, "caseId");
  requireCondition(!(hasPath && (hasRoot || hasId)), code + "_CASE_LOCATOR");
  if (hasPath) {
    requireCondition(typeof request.casePath === "string" && request.casePath.length > 0, code + "_CASE_PATH_REQUIRED");
    return request.casePath;
  }
  requireCondition(hasRoot && hasId, code + "_CASE_LOCATOR");
  requireCondition(typeof request.caseRoot === "string" && request.caseRoot.length > 0, code + "_CASE_ROOT_REQUIRED");
  requireCondition(typeof request.caseId === "string" && CASE_ID_RE.test(request.caseId), code + "_CASE_ID");
  return path.join(path.resolve(request.caseRoot), `case-${request.caseId}`, "manifest.json");
}

function runImageCaseReaderPipeline(request) {
  requireCondition(typeof request.caseRoot === "string" && request.caseRoot.length > 0, "PROVIDER_CASE_ROOT_REQUIRED");
  requireCondition(request.input && typeof request.input === "object", "PROVIDER_IMAGE_INPUT_REQUIRED");
  requireCondition(request.analysisConfig && typeof request.analysisConfig === "object", "PROVIDER_ANALYSIS_CONFIG_REQUIRED");
  validateConfig(request.analysisConfig);
  validateMeasurementConfig(request.analysisConfig.measurement);

  const persisted = runAndPersistImageFileIntake(request.caseRoot, request.input);
  const extractionReceipt = persistImageExtraction(persisted.caseReceipt.path, persisted.fileIntake.result);
  const extraction = readImageExtraction(persisted.caseReceipt.path, extractionReceipt.extractionId);
  const review = assertInactive(runImageSignalAnalysis(extraction, request.analysisConfig));
  const analysisReceipt = persistImageAnalysis(persisted.caseReceipt.path, review);
  const reader = assertInactive(buildClinicianReaderModel(persisted.caseReceipt.path, analysisReceipt.analysisId));

  return {
    schema: "ekg-specialist-image-case-reader-pipeline-result-v1",
    caseHandle: {
      caseId: persisted.caseReceipt.caseId,
      analysisId: analysisReceipt.analysisId,
    },
    case: stripPath(persisted.caseReceipt),
    extraction: stripPath(extractionReceipt),
    analysis: stripPath(analysisReceipt),
    reader,
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}

function runClinicianReader(request) {
  const allowed = new Set(["operation", "casePath", "caseRoot", "caseId", "analysisId"]);
  requireCondition(Object.keys(request).every(key => allowed.has(key)), "PROVIDER_READER_FIELDS");
  const casePath = resolveCasePath(request, "PROVIDER_READER");
  requireCondition(typeof request.analysisId === "string" && request.analysisId.length > 0, "PROVIDER_READER_ANALYSIS_ID_REQUIRED");
  const reader = assertInactive(buildClinicianReaderModel(casePath, request.analysisId));
  return {
    schema: "ekg-specialist-clinician-reader-result-v1",
    reader,
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}

function runClinicianCorrection(request) {
  const allowed = new Set(["operation", "casePath", "caseRoot", "caseId", "analysisId", "reviewerId", "statement", "supersedes"]);
  requireCondition(Object.keys(request).every(key => allowed.has(key)), "PROVIDER_CORRECTION_FIELDS");
  const casePath = resolveCasePath(request, "PROVIDER_CORRECTION");
  requireCondition(typeof request.analysisId === "string" && request.analysisId.length > 0, "PROVIDER_CORRECTION_ANALYSIS_ID_REQUIRED");
  requireCondition(typeof request.reviewerId === "string" && request.reviewerId.length > 0, "PROVIDER_CORRECTION_REVIEWER_REQUIRED");
  requireCondition(typeof request.statement === "string" && request.statement.length > 0, "PROVIDER_CORRECTION_STATEMENT_REQUIRED");
  const input = {
    analysisId: request.analysisId,
    reviewerId: request.reviewerId,
    statement: request.statement,
    ...(Object.hasOwn(request, "supersedes") ? { supersedes: request.supersedes } : {}),
  };
  const correction = persistClinicianCorrection(casePath, input);
  const reader = assertInactive(buildClinicianReaderModel(casePath, request.analysisId));
  return {
    schema: "ekg-specialist-clinician-correction-result-v1",
    correction: stripPath(correction),
    reader,
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}

function runWaveform(request) {
  requireCondition(request.args && typeof request.args === "object", "PROVIDER_WAVEFORM_ARGS_REQUIRED");
  const out = writeExecution(request.args);
  return {
    schema: "ekg-specialist-waveform-execution-result-v1",
    pass: out.pass === true,
    analysisFile: path.basename(out.analysisPath),
    waveformFile: path.basename(out.svgPath),
    renderingSha256: out.renderingSha256,
    diagnosticRuntime: out.diagnosticRuntime,
    clinicalAuthorityAdded: out.clinicalAuthorityAdded,
    disclaimer: ENGINEERING_DISCLAIMER,
    ...AUTHORITY,
  };
}
function dispatch(request) {
  requireCondition(request && typeof request === "object" && !Array.isArray(request), "PROVIDER_REQUEST_REQUIRED");
  switch (request.operation) {
    case "status": return status();
    case "waveform_execute": return runWaveform(request);
    case "image_file_intake": return runImageFile(request);
    case "image_case_pipeline": return runImageCasePipeline(request);
    case "image_case_reader_pipeline": return runImageCaseReaderPipeline(request);
    case "clinician_reader": return runClinicianReader(request);
    case "clinician_correction_append": return runClinicianCorrection(request);
    case "image_review": return {
      schema: "ekg-specialist-image-review-result-v1",
      review: summarizeReview(runImageReview(request)),
      disclaimer: ENGINEERING_DISCLAIMER,
      ...AUTHORITY,
    };
    default: throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
  }
}

function readRequest() {
  const raw = fs.readFileSync(0, "utf8");
  requireCondition(raw.trim().length > 0, "PROVIDER_STDIN_REQUIRED");
  return JSON.parse(raw);
}

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(dispatch(readRequest())) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({
      schema: "ekg-specialist-provider-error-v1",
      error: String(error && error.message ? error.message : error),
      disclaimer: ENGINEERING_DISCLAIMER,
      ...AUTHORITY,
    }) + "\n");
    process.exit(1);
  }
}

module.exports = { AUTHORITY, dispatch, status, summarizeReview };
