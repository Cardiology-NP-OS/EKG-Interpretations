#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { detectCandidateRPeaksMultiLeadV2 } = require("../../lib/qrs_multilead_v2");
const { matchEventsV2 } = require("../../lib/event_matcher_v2");
const configuration = require("../../evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json");
const protocol = require("../../evaluation/protocols/LUDB_QRS_V2_DEVELOPMENT_V1.json");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function main(argv) {
  requireCondition(argv.length === 2, "QRS_V2_DEVELOPMENT_RUNNER_ARGS");
  const inputPath = path.resolve(argv[0]);
  const outputPath = path.resolve(argv[1]);
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "QRS_V2_DEVELOPMENT_INPUT");
  requireCondition(typeof input.recordId === "string" && /^ludb\/1\.0\.1\/data\/\d+$/.test(input.recordId), "QRS_V2_DEVELOPMENT_RECORD_ID");
  requireCondition(Number.isFinite(input.sampleRateHz) && input.sampleRateHz === 500, "QRS_V2_DEVELOPMENT_SAMPLE_RATE");
  requireCondition(input.configurationId === configuration.configuration_id, "QRS_V2_DEVELOPMENT_CONFIGURATION");
  requireCondition(Array.isArray(input.leads) && input.leads.length === 12, "QRS_V2_DEVELOPMENT_LEADS");
  requireCondition(input.referenceEventsByLead && typeof input.referenceEventsByLead === "object", "QRS_V2_DEVELOPMENT_REFERENCES");
  requireCondition(typeof input.signalAssetSha256 === "string" && /^[a-f0-9]{64}$/.test(input.signalAssetSha256), "QRS_V2_DEVELOPMENT_SIGNAL_HASH");

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
  const selectedLeadKey = detection.selectedLeadName.toLowerCase();
  const references = input.referenceEventsByLead[selectedLeadKey];
  requireCondition(Array.isArray(references) && references.length > 0, "QRS_V2_DEVELOPMENT_SELECTED_LEAD_REFERENCE");
  const toleranceSamples = Math.round(protocol.matching.tolerance_ms * input.sampleRateHz / 1000);
  const matching = matchEventsV2(references, detection.detection.events, { toleranceSamples });
  const annotationHash = input.annotationAssetSha256ByLead[selectedLeadKey];
  requireCondition(typeof annotationHash === "string" && /^[a-f0-9]{64}$/.test(annotationHash), "QRS_V2_DEVELOPMENT_ANNOTATION_HASH");

  const output = {
    schema: "ekg-target-qrs-v2-development-output-v1",
    recordId: input.recordId,
    selectedLeadName: detection.selectedLeadName,
    selectionMethod: detection.selectionMethod,
    leadQuality: detection.leadQuality,
    failedLeadAttempts: detection.failedLeadAttempts,
    sampleRateHz: input.sampleRateHz,
    detectorAlgorithm: detection.detection.algorithm,
    configurationId: configuration.configuration_id,
    matcherProtocol: protocol.matching.protocol,
    matching,
    timingErrorsSamples: matching.matches.map(row => row.absoluteErrorSamples),
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
    schema: "ekg-target-qrs-v2-development-output-v1",
    pass: false,
    error: String(error.message || error),
    runtimeAuthority: false,
    metrics: "NOT_REPORTABLE",
  })}\n`);
  process.exit(1);
}
