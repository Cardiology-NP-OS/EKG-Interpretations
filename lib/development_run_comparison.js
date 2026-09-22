"use strict";

const { quantile } = require("./rpeak_development_metrics");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function metricValue(result, path) {
  let value = result;
  for (const segment of path.split(".")) value = value === null || value === undefined ? undefined : value[segment];
  return value;
}

function assertComparable(candidate, baseline) {
  const fields = ["benchmarkId", "benchmarkVersion", "manifestPayloadSha256", "metricVersion", "matcherVersion", "primaryToleranceMs"];
  const mismatches = fields.filter(field => candidate[field] !== baseline[field]);
  if (JSON.stringify(candidate.contractDigests) !== JSON.stringify(baseline.contractDigests)) mismatches.push("contractDigests");
  const candidateRecords = candidate.records.map(row => `${row.recordHmacSha256}:${row.patientHmacSha256}`).sort();
  const baselineRecords = baseline.records.map(row => `${row.recordHmacSha256}:${row.patientHmacSha256}`).sort();
  if (JSON.stringify(candidateRecords) !== JSON.stringify(baselineRecords)) mismatches.push("recordPatientSet");
  return { comparable: mismatches.length === 0, mismatches };
}

function pairedBootstrap(candidate, baseline, metric, options = {}) {
  const replicates = options.replicates === undefined ? 2000 : options.replicates;
  const seed = options.seed === undefined ? 20260922 : options.seed;
  const candidateByPatient = new Map(candidate.patients.map(row => [row.patientHmacSha256, row]));
  const baselineByPatient = new Map(baseline.patients.map(row => [row.patientHmacSha256, row]));
  const patientIds = [...candidateByPatient.keys()].sort();
  requireCondition(patientIds.length > 0 && patientIds.every(id => baselineByPatient.has(id)), "RUN_COMPARISON_PATIENT_SET");
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const deltas = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let candidateNumerator = 0;
    let baselineNumerator = 0;
    let candidateDenominator = 0;
    let baselineDenominator = 0;
    for (let index = 0; index < patientIds.length; index += 1) {
      const id = patientIds[Math.floor(random() * patientIds.length)];
      const left = candidateByPatient.get(id).counts;
      const right = baselineByPatient.get(id).counts;
      if (metric === "sensitivity") {
        candidateNumerator += left.tp;
        baselineNumerator += right.tp;
        candidateDenominator += left.tp + left.fn;
        baselineDenominator += right.tp + right.fn;
      } else if (metric === "ppv") {
        candidateNumerator += left.tp;
        baselineNumerator += right.tp;
        candidateDenominator += left.tp + left.fp;
        baselineDenominator += right.tp + right.fp;
      } else {
        candidateNumerator += 2 * left.tp;
        baselineNumerator += 2 * right.tp;
        candidateDenominator += 2 * left.tp + left.fp + left.fn;
        baselineDenominator += 2 * right.tp + right.fp + right.fn;
      }
    }
    if (candidateDenominator > 0 && baselineDenominator > 0) deltas.push(candidateNumerator / candidateDenominator - baselineNumerator / baselineDenominator);
  }
  return deltas.length ? { lower95: quantile(deltas, 0.025), upper95: quantile(deltas, 0.975), replicates, seed, method: "paired-patient-cluster-percentile" } : { lower95: null, upper95: null, replicates, seed, method: "NOT_EVALUABLE" };
}

function compareDevelopmentRuns(candidate, baseline, policy = {}) {
  const comparability = assertComparable(candidate, baseline);
  if (!comparability.comparable) return { schema: "ekg-development-run-comparison-v1", status: "NOT_COMPARABLE", mismatches: comparability.mismatches, ...CLAIM_BOUNDARY };
  const baselineByRecord = new Map(baseline.records.map(row => [row.recordHmacSha256, row]));
  const recordDiffs = candidate.records.map(row => {
    const prior = baselineByRecord.get(row.recordHmacSha256);
    return {
      patientHmacSha256: row.patientHmacSha256,
      recordHmacSha256: row.recordHmacSha256,
      sensitivityDelta: row.sensitivity === null || prior.sensitivity === null ? null : row.sensitivity - prior.sensitivity,
      ppvDelta: row.ppv === null || prior.ppv === null ? null : row.ppv - prior.ppv,
      f1Delta: row.f1 === null || prior.f1 === null ? null : row.f1 - prior.f1,
      newlyFailed: row.status !== "SUCCESS" && prior.status === "SUCCESS",
      recovered: row.status === "SUCCESS" && prior.status !== "SUCCESS",
    };
  });
  const pairedIntervals = {};
  for (const metric of ["sensitivity", "ppv", "f1"]) pairedIntervals[metric] = pairedBootstrap(candidate, baseline, metric, policy.bootstrap);
  const gates = (policy.gates || []).map(gate => {
    requireCondition(typeof gate.metricPath === "string", "RUN_COMPARISON_GATE_METRIC");
    requireCondition(["higher", "lower"].includes(gate.direction), "RUN_COMPARISON_GATE_DIRECTION");
    const candidateValue = metricValue(candidate, gate.metricPath);
    const baselineValue = metricValue(baseline, gate.metricPath);
    requireCondition(typeof candidateValue === "number" && Number.isFinite(candidateValue), `RUN_COMPARISON_CANDIDATE_METRIC:${gate.metricPath}`);
    requireCondition(typeof baselineValue === "number" && Number.isFinite(baselineValue), `RUN_COMPARISON_BASELINE_METRIC:${gate.metricPath}`);
    const delta = candidateValue - baselineValue;
    const floorFailed = gate.absoluteFloor === undefined ? false : gate.direction === "higher" ? candidateValue < gate.absoluteFloor : candidateValue > gate.absoluteFloor;
    const marginFailed = gate.noninferiorityMargin === undefined ? false : gate.direction === "higher" ? delta < -gate.noninferiorityMargin : delta > gate.noninferiorityMargin;
    const failed = floorFailed || marginFailed;
    return { ...gate, candidateValue, baselineValue, delta, failed, reasons: [floorFailed ? "ABSOLUTE_FLOOR" : null, marginFailed ? "NONINFERIORITY_MARGIN" : null].filter(Boolean) };
  });
  const regressions = recordDiffs.filter(row => row.newlyFailed || [row.sensitivityDelta, row.ppvDelta, row.f1Delta].some(value => value !== null && value < 0));
  return {
    schema: "ekg-development-run-comparison-v1",
    status: gates.some(gate => gate.blocking && gate.failed) ? "FAILED" : "PASSED",
    comparable: true,
    candidateId: candidate.candidateId,
    baselineCandidateId: baseline.candidateId,
    aggregateDeltas: {
      sensitivity: candidate.summary.micro.sensitivity - baseline.summary.micro.sensitivity,
      ppv: candidate.summary.micro.ppv - baseline.summary.micro.ppv,
      f1: candidate.summary.micro.f1 - baseline.summary.micro.f1,
      technicalFailureRate: candidate.denominators.technicalFailureCount / candidate.denominators.nRecords - baseline.denominators.technicalFailureCount / baseline.denominators.nRecords,
    },
    pairedIntervals,
    recordCounts: {
      improved: recordDiffs.filter(row => [row.sensitivityDelta, row.ppvDelta, row.f1Delta].some(value => value !== null && value > 0)).length,
      regressed: regressions.length,
      unchanged: recordDiffs.length - new Set([...recordDiffs.filter(row => [row.sensitivityDelta, row.ppvDelta, row.f1Delta].some(value => value !== null && value > 0)), ...regressions]).size,
      newlyFailed: recordDiffs.filter(row => row.newlyFailed).length,
      recovered: recordDiffs.filter(row => row.recovered).length,
    },
    recordDiffs,
    regressions,
    gates,
    ...CLAIM_BOUNDARY,
  };
}

module.exports = { assertComparable, compareDevelopmentRuns, metricValue, pairedBootstrap };
