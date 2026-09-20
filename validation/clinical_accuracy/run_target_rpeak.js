"use strict";

const fs = require("fs");
const path = require("path");
const { detectCandidateRPeaks } = require("../../lib/signal_measurement_contract");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function main(argv) {
  requireCondition(argv.length === 2, "VALIDATION_RUNNER_ARGS");
  const inputPath = path.resolve(argv[0]);
  const outputPath = path.resolve(argv[1]);
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  requireCondition(input && typeof input === "object", "VALIDATION_INPUT");
  requireCondition(typeof input.recordId === "string" && input.recordId.length > 0, "VALIDATION_RECORD_ID");
  requireCondition(typeof input.leadName === "string" && input.leadName.length > 0, "VALIDATION_LEAD");
  requireCondition(Number.isFinite(input.sampleRateHz) && input.sampleRateHz > 0, "VALIDATION_SAMPLE_RATE");
  requireCondition(Array.isArray(input.samples) && input.samples.length >= 3, "VALIDATION_SAMPLES");
  requireCondition(
    input.config &&
    input.config.minAbsoluteDeviation === 0.9 &&
    input.config.refractoryMs === 200,
    "VALIDATION_CONFIG_NOT_PREDECLARED"
  );

  const out = detectCandidateRPeaks(input.samples, input.sampleRateHz, {
    minAbsoluteDeviation: input.config.minAbsoluteDeviation,
    refractoryMs: input.config.refractoryMs,
    provenance: {
      sourceKind: "QUARANTINED_CLINICAL_VALIDATION_SOURCE",
      locator: `MITBIH-1.0.0/${input.recordId}/${input.leadName}`,
      assetSha256: input.signalAssetSha256,
      projectGold: false,
      runtimeAuthority: false,
    },
  });

  const artifact = {
    schema: "ekg-target-rpeak-validation-output-v1",
    recordId: input.recordId,
    leadName: input.leadName,
    sampleRateHz: input.sampleRateHz,
    eventCount: out.events.length,
    events: out.events.map(row => ({
      sampleIndex: row.sampleIndex,
      timeMs: row.timeMs,
      strength: row.strength,
    })),
    configuration: out.configuration,
    algorithm: out.algorithm,
    runtimeAuthority: false,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    evidenceAdmission: "NOT_ADMITTED",
    projectGold: false,
    metrics: "NOT_REPORTABLE",
    clinicalValidityInferred: false,
  };

  fs.writeFileSync(outputPath, JSON.stringify(artifact) + "\n", "utf8");
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(JSON.stringify({
    schema: "ekg-target-rpeak-validation-output-v1",
    pass: false,
    error: String(error.message || error),
    runtimeAuthority: false,
    metrics: "NOT_REPORTABLE",
  }));
  process.exit(1);
}
