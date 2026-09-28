"use strict";

const assert = require("assert");
const { compareDevelopmentRuns } = require("../lib/development_run_comparison");
const { evaluateRPeakRecords } = require("../lib/rpeak_development_metrics");

function record(id, patient, reference, predicted, extras = {}) {
  return {
    recordHmacSha256: id.repeat(64),
    patientHmacSha256: patient.repeat(64),
    referenceSampleIndices: reference,
    predictedSampleIndices: predicted,
    sampleRateHz: 100,
    durationSeconds: 10,
    lead: "II",
    subgroups: { source: extras.source || "synthetic-a", rhythm: extras.rhythm || "sinus", signalQuality: extras.signalQuality || "clean" },
    status: extras.status || "SUCCESS",
    failureCode: extras.failureCode,
  };
}

function evaluate(candidateId, records) {
  return evaluateRPeakRecords({
    benchmarkId: "SYNTHETIC-RPEAK-DEV-V1",
    benchmarkVersion: "1",
    candidateId,
    manifestPayloadSha256: "f".repeat(64),
    contractDigests: {
      protocolSha256: "a".repeat(64),
      preprocessingSha256: "b".repeat(64),
      leadPolicySha256: "c".repeat(64),
      labelSnapshotSha256: "d".repeat(64),
      thresholdCalibrationSha256: "e".repeat(64),
    },
    primaryToleranceMs: 100,
    toleranceMs: [50, 75, 100, 150],
    bootstrap: { replicates: 100, seed: 17 },
    records,
  });
}

const baseline = evaluate("baseline", [
  record("1", "a", [100, 200, 300, 400], [100, 200, 300]),
  record("2", "b", [100, 200, 300, 400], [100, 200, 300]),
  record("3", "b", [100, 200], [100, 200]),
]);
assert.equal(baseline.denominators.nPatients, 2);
assert.equal(baseline.denominators.nRecords, 3);
assert.equal(baseline.denominators.referenceEvents, 10);
assert.equal(baseline.summary.micro.sensitivity, 0.8);
assert.equal(baseline.summary.recordMacro.sensitivity.p50, 0.75);
assert.equal(baseline.summary.recordMacro.sensitivity.minimum, 0.75);
assert.equal(baseline.subgroups.find(row => row.subgroup === "source" && row.value === "synthetic-a").nPatients, 2);
assert.deepEqual(baseline.confidenceIntervals, evaluate("baseline", [
  record("1", "a", [100, 200, 300, 400], [100, 200, 300]),
  record("2", "b", [100, 200, 300, 400], [100, 200, 300]),
  record("3", "b", [100, 200], [100, 200]),
]).confidenceIntervals);

const technicalFailure = evaluate("failure", [
  record("4", "c", [100, 200], [100, 200], { status: "TECHNICAL_FAILURE", failureCode: "TIMEOUT" }),
]);
assert.equal(technicalFailure.summary.micro.sensitivity, 0);
assert.equal(technicalFailure.denominators.technicalFailureCount, 1);
assert.equal(technicalFailure.records[0].counts.fn, 2);

const candidate = evaluate("candidate", [
  record("1", "a", [100, 200, 300, 400], [100]),
  record("2", "b", [100, 200, 300, 400], [100, 200, 300, 400]),
  record("3", "b", [100, 200], [100, 200]),
]);
assert.equal(candidate.summary.micro.sensitivity, 0.7);
assert.equal(candidate.summary.recordMacro.sensitivity.minimum, 0.25);
const comparison = compareDevelopmentRuns(candidate, baseline, {
  bootstrap: { replicates: 100, seed: 23 },
  gates: [
    { id: "tail-floor", metricPath: "summary.recordMacro.sensitivity.minimum", direction: "higher", absoluteFloor: 0.5, noninferiorityMargin: 0.1, ciRule: "PAIRED_95", minimumDenominator: 2, denominatorPath: "denominators.nPatients", blocking: true },
    { id: "median-floor", metricPath: "summary.recordMacro.sensitivity.p50", direction: "higher", absoluteFloor: 0.9, blocking: false },
  ],
});
assert.equal(comparison.status, "FAILED");
assert.equal(comparison.recordCounts.regressed, 1);
assert.equal(comparison.gates.find(row => row.id === "tail-floor").failed, true);
assert.equal(comparison.pairedIntervals["summary.micro.sensitivity"].method, "paired-patient-cluster-percentile");
assert.equal(comparison.gates.find(row => row.id === "tail-floor").paired95.method, "paired-patient-cluster-percentile");

const noisyCandidate = evaluate("noisy", [
  record("1", "a", [100, 200, 300, 400], [100, 200, 300, 500]),
  record("2", "b", [100, 200, 300, 400], [100, 200, 300, 400, 500]),
  record("3", "b", [100, 200], [100, 200, 500]),
]);
const lowerIsBetter = compareDevelopmentRuns(noisyCandidate, baseline, {
  bootstrap: { replicates: 100, seed: 29 },
  gates: [
    { id: "false-detection-margin", metricPath: "summary.micro.falseDetectionsPerHour", direction: "lower", noninferiorityMargin: 0, ciRule: "POINT_ESTIMATE", blocking: true },
  ],
});
assert.equal(lowerIsBetter.status, "FAILED");
assert.deepEqual(lowerIsBetter.gates[0].reasons, ["NONINFERIORITY_MARGIN"]);

const insufficientDenominator = compareDevelopmentRuns(candidate, baseline, {
  bootstrap: { replicates: 20, seed: 31 },
  gates: [
    { id: "patient-count", metricPath: "summary.micro.sensitivity", direction: "higher", minimumDenominator: 3, denominatorPath: "denominators.nPatients", blocking: true },
  ],
});
assert.deepEqual(insufficientDenominator.gates[0].reasons, ["MINIMUM_DENOMINATOR"]);

assert.throws(() => compareDevelopmentRuns(candidate, baseline, { gates: [
  { id: "unknown-metric", metricPath: "summary.patientMacro.sensitivity.mean", direction: "higher", blocking: true },
] }), /RUN_COMPARISON_GATE_METRIC/);
assert.throws(() => compareDevelopmentRuns(candidate, baseline, { gates: [
  { id: "unknown-denominator", metricPath: "summary.micro.sensitivity", direction: "higher", denominatorPath: "denominators.missing", blocking: true },
] }), /RUN_COMPARISON_GATE_DENOMINATOR/);
assert.throws(() => compareDevelopmentRuns(candidate, baseline, { gates: [
  { id: "unknown-ci", metricPath: "summary.micro.sensitivity", direction: "higher", ciRule: "UNPAIRED_95", blocking: true },
] }), /RUN_COMPARISON_GATE_CI_RULE/);
assert.throws(() => compareDevelopmentRuns(candidate, baseline, { bootstrap: { replicates: 20, seed: 1.5 } }), /RUN_COMPARISON_BOOTSTRAP_SEED/);

const undefinedPpvBaseline = evaluate("empty-baseline", [record("5", "d", [100, 200], [])]);
const undefinedPpvCandidate = evaluate("empty-candidate", [record("5", "d", [100, 200], [])]);
const undefinedPpvComparison = compareDevelopmentRuns(undefinedPpvCandidate, undefinedPpvBaseline, { bootstrap: { replicates: 20, seed: 37 } });
assert.equal(undefinedPpvComparison.aggregateDeltas.ppv, null);
assert.equal(undefinedPpvComparison.pairedIntervals["summary.micro.ppv"].method, "NOT_EVALUABLE");
assert.throws(() => compareDevelopmentRuns(undefinedPpvCandidate, undefinedPpvBaseline, {
  bootstrap: { replicates: 20, seed: 37 },
  gates: [
    { id: "undefined-ppv", metricPath: "summary.micro.ppv", direction: "higher", blocking: true },
  ],
}), /RUN_COMPARISON_CANDIDATE_METRIC/);

const incompatible = { ...candidate, metricVersion: "different" };
assert.deepEqual(compareDevelopmentRuns(incompatible, baseline).status, "NOT_COMPARABLE");
console.log("R-peak development metrics tests passed");
