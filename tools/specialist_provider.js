"use strict";

const fs = require("fs");
const path = require("path");
const { runAndPersistImageFileIntake, runImageFileIntake } = require("../lib/image_file_intake");
const { persistImageExtraction, readImageExtraction } = require("../lib/image_extraction_store");
const { runImageSignalAnalysis } = require("../lib/image_signal_analysis");
const { persistImageAnalysis } = require("../lib/image_analysis_store");
const { writeExecution } = require("./run_ecg_pipeline");

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
      image_review: { available: true, input: "CONTENT_ADDRESSED_EXTRACTION" },
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
    },
    ...AUTHORITY,
  };
}

function summarizeReview(review) {
  return {
    schema: review.schema,
    caseId: review.caseId,
    extractionId: review.extractionId,
    status: review.status,
    attemptedLeadCount: review.attemptedLeadCount,
    processedLeadCount: review.processedLeadCount,
    completeStandardTwelveLead: review.completeStandardTwelveLead,
    crossLeadAggregationPerformed: review.crossLeadAggregationPerformed,
    simultaneousLeadComparisonPerformed: review.simultaneousLeadComparisonPerformed,
    crossLeadCandidateEvidence: review.crossLeadCandidateEvidence,
    failures: review.failures,
    thresholdAuthority: review.thresholdAuthority,
    diagnosticInterpretationIncluded: review.diagnosticInterpretationIncluded,
    runtimeAuthority: review.runtimeAuthority,
    projectGold: review.projectGold,
    metrics: review.metrics,
    activation: review.activation,
    clinicalValidityInferred: review.clinicalValidityInferred,
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
  return assertInactive(runImageSignalAnalysis(request.extraction, request.analysisConfig));
}

function runImageFile(request) {
  requireCondition(request.input && typeof request.input === "object", "PROVIDER_IMAGE_INPUT_REQUIRED");
  const out = assertInactive(runImageFileIntake(request.input));
  return {
    schema: "ekg-specialist-image-file-intake-result-v1",
    decoder: out.decoder,
    report: out.result.report,
    ...AUTHORITY,
  };
}
function runImageCasePipeline(request) {
  requireCondition(typeof request.caseRoot === "string" && request.caseRoot.length > 0, "PROVIDER_CASE_ROOT_REQUIRED");
  requireCondition(request.input && typeof request.input === "object", "PROVIDER_IMAGE_INPUT_REQUIRED");
  requireCondition(request.analysisConfig && typeof request.analysisConfig === "object", "PROVIDER_ANALYSIS_CONFIG_REQUIRED");

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
    case "image_review": return {
      schema: "ekg-specialist-image-review-result-v1",
      review: summarizeReview(runImageReview(request)),
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
      ...AUTHORITY,
    }) + "\n");
    process.exit(1);
  }
}

module.exports = { AUTHORITY, dispatch, status, summarizeReview };
