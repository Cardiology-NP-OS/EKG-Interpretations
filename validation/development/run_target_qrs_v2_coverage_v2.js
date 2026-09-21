#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { detectCandidateRPeaksMultiLeadV2 } = require("../../lib/qrs_multilead_v2");
const { scoreAnnotationObservableInterval } = require("../../lib/annotation_coverage_evaluator_v2");
const configuration = require("../../evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json");
const protocol = require("../../evaluation/protocols/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2.json");

const root = path.join(__dirname, "../..");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sha256File(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

function verifyFrozenIdentity() {
  for (const [relativePath, expected] of Object.entries(protocol.frozen_file_identities)) {
    requireCondition(sha256File(relativePath) === expected, `QRS_V2_COVERAGE_FROZEN_IDENTITY:${relativePath}`);
  }
  requireCondition(protocol.executed_split === "train", "QRS_V2_COVERAGE_TRAIN_SPLIT_REQUIRED");
  requireCondition(protocol.internal_holdout_authorized === false, "QRS_V2_COVERAGE_HOLDOUT_MUST_REMAIN_CLOSED");
  requireCondition(protocol.detector_code_under_test.configuration_id === configuration.configuration_id, "QRS_V2_COVERAGE_PROTOCOL_CONFIGURATION");
}

function main(argv) {
  requireCondition(argv.length === 2, "QRS_V2_COVERAGE_TARGET_RUNNER_ARGS");
  verifyFrozenIdentity();
  const inputPath = path.resolve(argv[0]);
  const outputPath = path.resolve(argv[1]);
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "QRS_V2_COVERAGE_INPUT");
  requireCondition(typeof input.recordId === "string" && /^ludb\/1\.0\.1\/data\/\d+$/.test(input.recordId), "QRS_V2_COVERAGE_RECORD_ID");
  requireCondition(Number.isFinite(input.sampleRateHz) && input.sampleRateHz === 500, "QRS_V2_COVERAGE_SAMPLE_RATE");
  requireCondition(Number.isInteger(input.sampleCount) && input.sampleCount === 5000, "QRS_V2_COVERAGE_SAMPLE_COUNT");
  requireCondition(input.configurationId === protocol.detector_code_under_test.configuration_id, "QRS_V2_COVERAGE_CONFIGURATION");
  requireCondition(Array.isArray(input.leads) && input.leads.length === 12, "QRS_V2_COVERAGE_LEADS");
  requireCondition(input.referenceEventsByLead && typeof input.referenceEventsByLead === "object", "QRS_V2_COVERAGE_REFERENCES");
  requireCondition(typeof input.signalAssetSha256 === "string" && /^[a-f0-9]{64}$/.test(input.signalAssetSha256), "QRS_V2_COVERAGE_SIGNAL_HASH");

  const detection = detectCandidateRPeaksMultiLeadV2(input.leads, input.sampleRateHz, {
    configuration: configuration.detector,
    provenance: {
      sourceKind: "VERSION_PINNED_NONCLINICAL_DEVELOPMENT_SOURCE",
      locator: input.recordId,
      assetSha256: input.signalAssetSha256,
      projectGold: false,
      runtimeAuthority: false,
    },
  });
  requireCondition(detection.detection.algorithm === protocol.detector_code_under_test.algorithm, "QRS_V2_COVERAGE_DETECTOR_ALGORITHM");
  const selectedLeadKey = detection.selectedLeadName.toLowerCase();
  const references = input.referenceEventsByLead[selectedLeadKey];
  const toleranceSamples = Math.round(protocol.matching.tolerance_ms * input.sampleRateHz / 1000);
  const coverageScoring = scoreAnnotationObservableInterval(references, detection.detection.events, {
    toleranceSamples,
    sampleCount: input.sampleCount,
  });
  const annotationHash = input.annotationAssetSha256ByLead[selectedLeadKey];
  requireCondition(typeof annotationHash === "string" && /^[a-f0-9]{64}$/.test(annotationHash), "QRS_V2_COVERAGE_ANNOTATION_HASH");

  const output = {
    schema: "ekg-target-qrs-v2-annotation-coverage-output-v2",
    protocolId: protocol.protocol_id,
    recordId: input.recordId,
    selectedLeadName: detection.selectedLeadName,
    selectionMethod: detection.selectionMethod,
    leadQuality: detection.leadQuality,
    failedLeadAttempts: detection.failedLeadAttempts,
    sampleRateHz: input.sampleRateHz,
    sampleCount: input.sampleCount,
    detectorAlgorithm: detection.detection.algorithm,
    configurationId: configuration.configuration_id,
    matcherProtocol: protocol.matching.protocol,
    evaluatorAlgorithm: coverageScoring.algorithm,
    coverageScoring,
    pacedComplexCandidateCount: detection.detection.events.filter(row => row.pacedComplexCandidate).length,
    searchbackEventCount: detection.detection.events.filter(row => row.detectionConfidenceClass === "SEARCHBACK").length,
    sourceFilesSha256: {
      signal: input.signalAssetSha256,
      selectedLeadAnnotation: annotationHash,
    },
    runtimeAuthority: false,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    evidenceAdmission: "NOT_ADMITTED",
    projectGold: false,
    sourceLabelsAreProjectGold: false,
    metrics: "NOT_REPORTABLE",
    clinicalValidityInferred: false,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, { encoding: "utf8", flag: "wx" });
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schema: "ekg-target-qrs-v2-annotation-coverage-output-v2",
    pass: false,
    error: String(error.message || error),
    runtimeAuthority: false,
    metrics: "NOT_REPORTABLE",
  })}\n`);
  process.exit(1);
}
