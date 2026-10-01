"use strict";

const assert = require("assert");
const { compareDevelopmentRuns, validatePolicy } = require("../lib/development_run_comparison");
const { distribution, evaluateRPeakRecords, quantile } = require("../lib/rpeak_development_metrics");

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

function evaluate(candidateId, records, manifestExcludedRecordCount) {
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
    manifestExcludedRecordCount,
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
assert.equal(validatePolicy({ gates: [{ id: "advisory-denominator", metricPath: "summary.micro.sensitivity", direction: "higher", minimumDenominator: 3, denominatorPath: "denominators.nPatients", blocking: false }] }).length, 1);
assert.throws(() => validatePolicy({ gates: [{ id: "reversed", metricPath: "summary.micro.sensitivity", direction: "lower", absoluteFloor: 0.8, blocking: true }] }), /RUN_COMPARISON_GATE_DIRECTION/);
assert.throws(() => validatePolicy({ gates: [{ id: "out-of-domain", metricPath: "summary.micro.sensitivity", direction: "higher", absoluteFloor: 1.1, blocking: true }] }), /RUN_COMPARISON_GATE_ABSOLUTE_FLOOR_DOMAIN/);
assert.throws(() => validatePolicy({ gates: [{ id: "vacuous-higher", metricPath: "summary.micro.sensitivity", direction: "higher", absoluteFloor: 0, blocking: true }] }), /RUN_COMPARISON_GATE_ABSOLUTE_FLOOR_VACUOUS/);
assert.throws(() => validatePolicy({ gates: [{ id: "vacuous-lower", metricPath: "summary.technicalFailureRate", direction: "lower", absoluteFloor: 1, blocking: true }] }), /RUN_COMPARISON_GATE_ABSOLUTE_FLOOR_VACUOUS/);
assert.throws(() => validatePolicy({ gates: [{ id: "out-of-domain-margin", metricPath: "summary.micro.ppv", direction: "higher", noninferiorityMargin: 1.1, blocking: true }] }), /RUN_COMPARISON_GATE_MARGIN_DOMAIN/);
assert.throws(() => validatePolicy({ gates: [{ id: "vacuous-margin", metricPath: "summary.micro.ppv", direction: "higher", noninferiorityMargin: 1, blocking: true }] }), /RUN_COMPARISON_GATE_MARGIN_VACUOUS/);
assert.throws(() => validatePolicy({ gates: [{ id: "authority", metricPath: "summary.micro.f1", direction: "higher", absoluteFloor: 0.8, blocking: true, runtimeAuthority: true }] }), /RUN_COMPARISON_GATE_FIELDS/);

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
const accounting = evaluate("synthetic-failure-accounting", [
  record("1", "a", [100, 200], [100]),
  record("2", "a", [100], [100, 300, 500]),
  record("3", "b", [100], [100], { status: "TECHNICAL_FAILURE" }),
  record("4", "c", [100], [], { status: "ABSTAINED" }),
  record("5", "d", [], []),
]);
const failureAnalysis = accounting.failureAnalysis;
assert.equal(failureAnalysis.nRecords, 5);
assert.equal(failureAnalysis.nPatients, 4);
assert.deepEqual(failureAnalysis.statusCounts, { SUCCESS: 3, TECHNICAL_FAILURE: 1, ABSTAINED: 1 });
assert.equal(failureAnalysis.nonSuccessCount, 2);
assert.equal(failureAnalysis.nonSuccessCount, accounting.denominators.technicalFailureCount);
assert.equal(failureAnalysis.statusCounts.ABSTAINED, accounting.denominators.abstainedCount);
assert.equal(failureAnalysis.nonSuccessCount / failureAnalysis.nRecords, accounting.summary.technicalFailureRate);
assert.equal(failureAnalysis.legacyTechnicalFailureMetricScope, "ALL_NON_SUCCESS_RECORDS_INCLUDING_ABSTENTIONS");
assert.equal(failureAnalysis.recordsWithMissedReferences, 3);
assert.equal(failureAnalysis.recordsWithUnmatchedPredictions, 1);
assert.equal(failureAnalysis.undefinedSensitivityCount, 1);
assert.equal(failureAnalysis.undefinedPpvCount, 3);
assert.equal(failureAnalysis.populationScope, "SUPPLIED_SCORING_RECORDS_ONLY");
assert.equal(failureAnalysis.scoringStageExcludedCount, 0);
assert.equal(failureAnalysis.manifestExcludedRecordCount, null);
assert.equal(Object.values(failureAnalysis.statusCounts).reduce((sum, count) => sum + count, 0), failureAnalysis.nRecords);
const withExclusions = evaluate("synthetic-manifest-exclusions", [record("6", "e", [100], [100])], 2);
assert.equal(withExclusions.failureAnalysis.manifestExcludedRecordCount, 2);
assert.equal(withExclusions.failureAnalysis.nRecords, 1);
assert.equal(withExclusions.failureAnalysis.scoringStageExcludedCount, 0);
for (const count of [-1, 1.5, "2", NaN, Infinity]) {
  assert.throws(() => evaluate("invalid-exclusions", [record("6", "e", [100], [100])], count), /RPEAK_MANIFEST_EXCLUDED_COUNT/);
}
assert.deepEqual(failureAnalysis.catastrophicErrors, { status: "NOT_EVALUATED", reason: "POLICY_UNAVAILABLE", policySha256: null, recordCount: null });
assert.deepEqual(failureAnalysis.recordOutcomes.map(row => row.reasons), [
  ["MISSED_REFERENCE_EVENTS"],
  ["UNMATCHED_PREDICTED_EVENTS"],
  ["TECHNICAL_FAILURE", "MISSED_REFERENCE_EVENTS", "PPV_UNDEFINED"],
  ["ABSTAINED", "MISSED_REFERENCE_EVENTS", "PPV_UNDEFINED"],
  ["SENSITIVITY_UNDEFINED", "PPV_UNDEFINED"],
]);
const aggregateBetter = evaluate("aggregate-better", [
  record("1", "a", [100, 200, 300, 400], [100, 200, 300, 400]),
  record("2", "b", [100, 200, 300, 400], [100, 200, 300, 400]),
  record("3", "b", [100, 200], [100]),
]);
assert.ok(aggregateBetter.summary.micro.sensitivity > baseline.summary.micro.sensitivity);
const tailBlocked = compareDevelopmentRuns(aggregateBetter, baseline, {
  bootstrap: { replicates: 100, seed: 23 },
  gates: [{ id: "synthetic-record-floor", metricPath: "summary.recordMacro.sensitivity.minimum", direction: "higher", absoluteFloor: 0.6, blocking: true }],
});
assert.equal(tailBlocked.status, "FAILED");
assert.equal(aggregateBetter.failureAnalysis.recordsWithMissedReferences, 1);
const largeValues = Array.from({ length: 150000 }, (_, index) => 149999 - index);
const largeDistribution = distribution([...largeValues, null, NaN]);
assert.equal(largeDistribution.minimum, 0);
assert.equal(largeDistribution.maximum, 149999);
assert.equal(largeDistribution.count, 150000);
assert.equal(largeDistribution.undefinedCount, 2);
assert.equal(largeDistribution.mean, 74999.5);
for (const [key, probability] of Object.entries({ p01: 0.01, p05: 0.05, p25: 0.25, p50: 0.5, p75: 0.75, p95: 0.95, p99: 0.99 })) {
  assert.equal(largeDistribution[key], quantile(largeValues, probability));
}
assert.equal(largeValues[0], 149999);
assert.equal(distribution([null, NaN]).minimum, null);
console.log("R-peak development metrics tests passed");
