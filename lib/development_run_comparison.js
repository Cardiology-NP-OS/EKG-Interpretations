"use strict";

const { aggregateByPatient, quantile, summarizeRows } = require("./rpeak_development_metrics");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");

const SUPPORTED_METRIC_PATHS = new Set([
  "summary.micro.sensitivity",
  "summary.micro.ppv",
  "summary.micro.f1",
  "summary.micro.falseDetectionsPerHour",
  "summary.recordMacro.sensitivity.p05",
  "summary.recordMacro.sensitivity.minimum",
  "summary.recordMacro.sensitivity.p50",
  "summary.timing.absoluteError.p95",
  "summary.technicalFailureRate",
]);
const SUPPORTED_DENOMINATOR_PATHS = new Set([
  "denominators.nPatients",
  "denominators.nRecords",
  "denominators.referenceEvents",
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function metricValue(result, path) {
  let value = result;
  for (const segment of path.split(".")) value = value === null || value === undefined ? undefined : value[segment];
  return value;
}

function finiteDelta(candidateValue, baselineValue) {
  return Number.isFinite(candidateValue) && Number.isFinite(baselineValue) ? candidateValue - baselineValue : null;
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

function compactResult(records) {
  return {
    summary: summarizeRows(records, aggregateByPatient(records)),
    denominators: {
      nPatients: new Set(records.map(row => row.patientHmacSha256)).size,
      nRecords: records.length,
      referenceEvents: records.reduce((sum, row) => sum + row.counts.referenceEvents, 0),
    },
  };
}

function validatePolicy(policy) {
  requireCondition(plain(policy), "RUN_COMPARISON_POLICY");
  requireCondition(policy.gates === undefined || Array.isArray(policy.gates), "RUN_COMPARISON_GATES");
  const gates = policy.gates || [];
  const ids = new Set();
  for (const gate of gates) {
    requireCondition(plain(gate), "RUN_COMPARISON_GATE_OBJECT");
    requireCondition(typeof gate.id === "string" && gate.id.length > 0 && !ids.has(gate.id), "RUN_COMPARISON_GATE_ID");
    ids.add(gate.id);
    requireCondition(typeof gate.metricPath === "string" && SUPPORTED_METRIC_PATHS.has(gate.metricPath), `RUN_COMPARISON_GATE_METRIC:${gate.metricPath}`);
    requireCondition(["higher", "lower"].includes(gate.direction), "RUN_COMPARISON_GATE_DIRECTION");
    requireCondition(typeof gate.blocking === "boolean", "RUN_COMPARISON_GATE_BLOCKING");
    requireCondition(gate.ciRule === undefined || ["POINT_ESTIMATE", "PAIRED_95"].includes(gate.ciRule), "RUN_COMPARISON_GATE_CI_RULE");
    requireCondition(gate.absoluteFloor === undefined || Number.isFinite(gate.absoluteFloor), "RUN_COMPARISON_GATE_ABSOLUTE_FLOOR");
    requireCondition(gate.noninferiorityMargin === undefined || Number.isFinite(gate.noninferiorityMargin) && gate.noninferiorityMargin >= 0, "RUN_COMPARISON_GATE_MARGIN");
    requireCondition(gate.minimumDenominator === undefined || Number.isInteger(gate.minimumDenominator) && gate.minimumDenominator >= 0, "RUN_COMPARISON_GATE_MINIMUM_DENOMINATOR");
    requireCondition(gate.denominatorPath === undefined || SUPPORTED_DENOMINATOR_PATHS.has(gate.denominatorPath), `RUN_COMPARISON_GATE_DENOMINATOR:${gate.denominatorPath}`);
  }
  return gates;
}

function pairedBootstrap(candidate, baseline, metricPath, options = {}) {
  const replicates = options.replicates === undefined ? 2000 : options.replicates;
  const seed = options.seed === undefined ? 20260922 : options.seed;
  requireCondition(SUPPORTED_METRIC_PATHS.has(metricPath), `RUN_COMPARISON_BOOTSTRAP_METRIC:${metricPath}`);
  requireCondition(Number.isInteger(replicates) && replicates > 0, "RUN_COMPARISON_BOOTSTRAP_REPLICATES");
  requireCondition(Number.isInteger(seed), "RUN_COMPARISON_BOOTSTRAP_SEED");
  const candidateByPatient = new Map();
  const baselineByPatient = new Map();
  for (const row of candidate.records) {
    if (!candidateByPatient.has(row.patientHmacSha256)) candidateByPatient.set(row.patientHmacSha256, []);
    candidateByPatient.get(row.patientHmacSha256).push(row);
  }
  for (const row of baseline.records) {
    if (!baselineByPatient.has(row.patientHmacSha256)) baselineByPatient.set(row.patientHmacSha256, []);
    baselineByPatient.get(row.patientHmacSha256).push(row);
  }
  const patientIds = [...candidateByPatient.keys()].sort();
  requireCondition(patientIds.length > 0 && patientIds.length === baselineByPatient.size && patientIds.every(id => baselineByPatient.has(id)), "RUN_COMPARISON_PATIENT_SET");
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const deltas = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const candidateRows = [];
    const baselineRows = [];
    for (let index = 0; index < patientIds.length; index += 1) {
      const id = patientIds[Math.floor(random() * patientIds.length)];
      candidateRows.push(...candidateByPatient.get(id));
      baselineRows.push(...baselineByPatient.get(id));
    }
    const candidateValue = metricValue(compactResult(candidateRows), metricPath);
    const baselineValue = metricValue(compactResult(baselineRows), metricPath);
    if (Number.isFinite(candidateValue) && Number.isFinite(baselineValue)) deltas.push(candidateValue - baselineValue);
  }
  return deltas.length ? { lower95: quantile(deltas, 0.025), upper95: quantile(deltas, 0.975), replicates, seed, method: "paired-patient-cluster-percentile" } : { lower95: null, upper95: null, replicates, seed, method: "NOT_EVALUABLE" };
}

function compareDevelopmentRuns(candidate, baseline, policy = {}) {
  const gatesPolicy = validatePolicy(policy);
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
  for (const metricPath of SUPPORTED_METRIC_PATHS) pairedIntervals[metricPath] = pairedBootstrap(candidate, baseline, metricPath, policy.bootstrap);
  const gates = gatesPolicy.map(gate => {
    const candidateValue = metricValue(candidate, gate.metricPath);
    const baselineValue = metricValue(baseline, gate.metricPath);
    requireCondition(Number.isFinite(candidateValue), `RUN_COMPARISON_CANDIDATE_METRIC:${gate.metricPath}`);
    requireCondition(Number.isFinite(baselineValue), `RUN_COMPARISON_BASELINE_METRIC:${gate.metricPath}`);
    const denominatorPath = gate.denominatorPath || "denominators.nPatients";
    const denominator = metricValue(candidate, denominatorPath);
    requireCondition(Number.isFinite(denominator) && denominator >= 0, `RUN_COMPARISON_DENOMINATOR_VALUE:${denominatorPath}`);
    const denominatorFailed = gate.minimumDenominator !== undefined && denominator < gate.minimumDenominator;
    const delta = candidateValue - baselineValue;
    const interval = pairedIntervals[gate.metricPath];
    const floorFailed = gate.absoluteFloor === undefined ? false : gate.direction === "higher" ? candidateValue < gate.absoluteFloor : candidateValue > gate.absoluteFloor;
    const pointMarginFailed = gate.noninferiorityMargin === undefined ? false : gate.direction === "higher" ? delta < -gate.noninferiorityMargin : delta > gate.noninferiorityMargin;
    const ciMarginFailed = gate.noninferiorityMargin === undefined || gate.ciRule !== "PAIRED_95" ? false : gate.direction === "higher" ? interval.lower95 === null || interval.lower95 < -gate.noninferiorityMargin : interval.upper95 === null || interval.upper95 > gate.noninferiorityMargin;
    const marginFailed = gate.ciRule === "PAIRED_95" ? ciMarginFailed : pointMarginFailed;
    const failed = denominatorFailed || floorFailed || marginFailed;
    return { ...gate, ciRule: gate.ciRule || "POINT_ESTIMATE", candidateValue, baselineValue, denominator, delta, paired95: interval, failed, reasons: [denominatorFailed ? "MINIMUM_DENOMINATOR" : null, floorFailed ? "ABSOLUTE_FLOOR" : null, marginFailed ? "NONINFERIORITY_MARGIN" : null].filter(Boolean) };
  });
  const regressions = recordDiffs.filter(row => row.newlyFailed || [row.sensitivityDelta, row.ppvDelta, row.f1Delta].some(value => value !== null && value < 0));
  const changed = new Set([...recordDiffs.filter(row => [row.sensitivityDelta, row.ppvDelta, row.f1Delta].some(value => value !== null && value > 0)), ...regressions]);
  return {
    schema: "ekg-development-run-comparison-v1",
    status: gates.some(gate => gate.blocking && gate.failed) ? "FAILED" : "PASSED",
    comparable: true,
    candidateId: candidate.candidateId,
    baselineCandidateId: baseline.candidateId,
    aggregateDeltas: {
      sensitivity: finiteDelta(candidate.summary.micro.sensitivity, baseline.summary.micro.sensitivity),
      ppv: finiteDelta(candidate.summary.micro.ppv, baseline.summary.micro.ppv),
      f1: finiteDelta(candidate.summary.micro.f1, baseline.summary.micro.f1),
      falseDetectionsPerHour: finiteDelta(candidate.summary.micro.falseDetectionsPerHour, baseline.summary.micro.falseDetectionsPerHour),
      technicalFailureRate: finiteDelta(candidate.summary.technicalFailureRate, baseline.summary.technicalFailureRate),
    },
    pairedIntervals,
    recordCounts: {
      improved: recordDiffs.filter(row => [row.sensitivityDelta, row.ppvDelta, row.f1Delta].some(value => value !== null && value > 0)).length,
      regressed: regressions.length,
      unchanged: recordDiffs.length - changed.size,
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
