"use strict";

const { matchEventsV2, MATCHER_ALGORITHM } = require("./event_matcher_v2");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");

const RPEAK_METRIC_VERSION = "rpeak-development-metrics-v1";

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function f1(tp, fp, fn) {
  return ratio(2 * tp, 2 * tp + fp + fn);
}

function quantile(values, probability) {
  requireCondition(Array.isArray(values) && values.length > 0, "RPEAK_QUANTILE_VALUES");
  requireCondition(Number.isFinite(probability) && probability >= 0 && probability <= 1, "RPEAK_QUANTILE_PROBABILITY");
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const left = Math.floor(position);
  const fraction = position - left;
  return sorted[left] + ((sorted[left + 1] === undefined ? sorted[left] : sorted[left + 1]) - sorted[left]) * fraction;
}

function distribution(values) {
  const defined = values.filter(value => typeof value === "number" && Number.isFinite(value));
  if (!defined.length) return { count: 0, undefinedCount: values.length, minimum: null, p01: null, p05: null, p25: null, p50: null, p75: null, p95: null, p99: null, maximum: null, iqr: null, mean: null, values: [] };
  const p25 = quantile(defined, 0.25);
  const p75 = quantile(defined, 0.75);
  return {
    count: defined.length,
    undefinedCount: values.length - defined.length,
    minimum: Math.min(...defined),
    p01: quantile(defined, 0.01),
    p05: quantile(defined, 0.05),
    p25,
    p50: quantile(defined, 0.5),
    p75,
    p95: quantile(defined, 0.95),
    p99: quantile(defined, 0.99),
    maximum: Math.max(...defined),
    iqr: p75 - p25,
    mean: defined.reduce((sum, value) => sum + value, 0) / defined.length,
    values: defined.slice().sort((a, b) => a - b),
  };
}

function countsMetrics(rows) {
  const counts = rows.reduce((acc, row) => ({
    tp: acc.tp + row.counts.tp,
    fp: acc.fp + row.counts.fp,
    fn: acc.fn + row.counts.fn,
    referenceEvents: acc.referenceEvents + row.counts.referenceEvents,
    predictedEvents: acc.predictedEvents + row.counts.predictedEvents,
    durationSeconds: acc.durationSeconds + row.durationSeconds,
  }), { tp: 0, fp: 0, fn: 0, referenceEvents: 0, predictedEvents: 0, durationSeconds: 0 });
  return {
    counts,
    sensitivity: ratio(counts.tp, counts.tp + counts.fn),
    ppv: ratio(counts.tp, counts.tp + counts.fp),
    f1: f1(counts.tp, counts.fp, counts.fn),
    falseDetectionsPerHour: ratio(counts.fp, counts.durationSeconds / 3600),
    missedPeaksPerHour: ratio(counts.fn, counts.durationSeconds / 3600),
  };
}

function timingMetrics(errorsMs) {
  const signed = errorsMs.filter(Number.isFinite);
  const absolute = signed.map(Math.abs);
  return {
    matchedCount: signed.length,
    signedError: distribution(signed),
    absoluteError: distribution(absolute),
    medianBiasMs: signed.length ? quantile(signed, 0.5) : null,
  };
}

function scoreRecord(record, primaryToleranceMs, toleranceMs) {
  requireCondition(plain(record), "RPEAK_RECORD_OBJECT");
  requireCondition(typeof record.recordHmacSha256 === "string" && /^[0-9a-f]{64}$/.test(record.recordHmacSha256), "RPEAK_RECORD_HMAC");
  requireCondition(typeof record.patientHmacSha256 === "string" && /^[0-9a-f]{64}$/.test(record.patientHmacSha256), "RPEAK_PATIENT_HMAC");
  requireCondition(Number.isFinite(record.sampleRateHz) && record.sampleRateHz > 0, "RPEAK_SAMPLE_RATE");
  requireCondition(Number.isFinite(record.durationSeconds) && record.durationSeconds > 0, "RPEAK_DURATION");
  requireCondition(Array.isArray(record.referenceSampleIndices), "RPEAK_REFERENCE_EVENTS");
  requireCondition(Array.isArray(record.predictedSampleIndices), "RPEAK_PREDICTED_EVENTS");
  requireCondition(plain(record.subgroups), "RPEAK_SUBGROUPS");
  const status = record.status || "SUCCESS";
  requireCondition(["SUCCESS", "TECHNICAL_FAILURE", "ABSTAINED"].includes(status), "RPEAK_STATUS");
  const predictions = status === "SUCCESS" ? record.predictedSampleIndices : [];
  const toleranceResults = {};
  for (const tolerance of toleranceMs) {
    const toleranceSamples = Math.round(tolerance * record.sampleRateHz / 1000);
    const match = matchEventsV2(record.referenceSampleIndices, predictions, { toleranceSamples });
    const timingErrorsMs = match.matches.map(row => (row.predictedSampleIndex - row.referenceSampleIndex) * 1000 / record.sampleRateHz);
    toleranceResults[String(tolerance)] = {
      toleranceMs: tolerance,
      counts: {
        tp: match.matchedCount,
        fp: match.falsePositiveCount,
        fn: match.falseNegativeCount,
        referenceEvents: match.referenceCount,
        predictedEvents: match.predictedCount,
      },
      sensitivity: ratio(match.matchedCount, match.referenceCount),
      ppv: ratio(match.matchedCount, match.predictedCount),
      f1: f1(match.matchedCount, match.falsePositiveCount, match.falseNegativeCount),
      timing: timingMetrics(timingErrorsMs),
    };
  }
  const primary = toleranceResults[String(primaryToleranceMs)];
  return {
    recordHmacSha256: record.recordHmacSha256,
    patientHmacSha256: record.patientHmacSha256,
    status,
    failureCode: status === "SUCCESS" ? null : record.failureCode || status,
    durationSeconds: record.durationSeconds,
    sampleRateHz: record.sampleRateHz,
    lead: record.lead || null,
    subgroups: { ...record.subgroups },
    counts: primary.counts,
    sensitivity: primary.sensitivity,
    ppv: primary.ppv,
    f1: primary.f1,
    falseDetectionsPerHour: ratio(primary.counts.fp, record.durationSeconds / 3600),
    missedPeaksPerHour: ratio(primary.counts.fn, record.durationSeconds / 3600),
    timing: primary.timing,
    toleranceResults,
  };
}

function aggregateByPatient(records) {
  const groups = new Map();
  for (const record of records) {
    if (!groups.has(record.patientHmacSha256)) groups.set(record.patientHmacSha256, []);
    groups.get(record.patientHmacSha256).push(record);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([patientHmacSha256, rows]) => ({
    patientHmacSha256,
    recordCount: rows.length,
    technicalFailureCount: rows.filter(row => row.status !== "SUCCESS").length,
    ...countsMetrics(rows),
  }));
}

function summarizeRows(records, patients) {
  const micro = countsMetrics(records);
  const timingErrors = records.flatMap(record => record.toleranceResults[record.primaryToleranceKey || ""]?.timing?.signedError?.values || []);
  return {
    micro,
    technicalFailureRate: ratio(records.filter(row => row.status !== "SUCCESS").length, records.length),
    recordMacro: {
      sensitivity: distribution(records.map(row => row.sensitivity)),
      ppv: distribution(records.map(row => row.ppv)),
      f1: distribution(records.map(row => row.f1)),
      falseDetectionsPerHour: distribution(records.map(row => row.falseDetectionsPerHour)),
      missedPeaksPerHour: distribution(records.map(row => row.missedPeaksPerHour)),
    },
    patientMacro: {
      sensitivity: distribution(patients.map(row => row.sensitivity)),
      ppv: distribution(patients.map(row => row.ppv)),
      f1: distribution(patients.map(row => row.f1)),
    },
    timing: timingMetrics(timingErrors),
  };
}

function subgroupMetrics(records, bootstrapOptions) {
  const buckets = new Map();
  for (const record of records) {
    for (const [name, rawValue] of Object.entries(record.subgroups)) {
      const value = rawValue === null || rawValue === undefined || rawValue === "" ? "UNKNOWN" : String(rawValue);
      const key = `${name}\u0000${value}`;
      if (!buckets.has(key)) buckets.set(key, { name, value, rows: [] });
      buckets.get(key).rows.push(record);
    }
  }
  return [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name) || a.value.localeCompare(b.value)).map(group => {
    const patients = aggregateByPatient(group.rows);
    return {
      subgroup: group.name,
      value: group.value,
      nPatients: patients.length,
      nRecords: group.rows.length,
      referenceEvents: group.rows.reduce((sum, row) => sum + row.counts.referenceEvents, 0),
      predictedEvents: group.rows.reduce((sum, row) => sum + row.counts.predictedEvents, 0),
      technicalFailureCount: group.rows.filter(row => row.status !== "SUCCESS").length,
      metrics: summarizeRows(group.rows, patients),
      confidenceIntervals: patientClusterBootstrap(group.rows, bootstrapOptions),
    };
  });
}

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function patientClusterBootstrap(records, options = {}) {
  const replicates = options.replicates === undefined ? 2000 : options.replicates;
  const seed = options.seed === undefined ? 20260922 : options.seed;
  requireCondition(Number.isInteger(replicates) && replicates > 0, "RPEAK_BOOTSTRAP_REPLICATES");
  requireCondition(Number.isInteger(seed), "RPEAK_BOOTSTRAP_SEED");
  const byPatient = new Map();
  for (const row of records) {
    if (!byPatient.has(row.patientHmacSha256)) byPatient.set(row.patientHmacSha256, []);
    byPatient.get(row.patientHmacSha256).push(row);
  }
  const patientIds = [...byPatient.keys()].sort();
  requireCondition(patientIds.length > 0, "RPEAK_BOOTSTRAP_PATIENTS");
  const random = lcg(seed);
  const values = { sensitivity: [], ppv: [], f1: [], recordSensitivityP05: [], recordSensitivityMinimum: [], recordSensitivityP50: [], falseDetectionsPerHour: [], timingAbsoluteErrorP95: [], technicalFailureRate: [] };
  const sampledPatientIndices = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const indices = [];
    const sampled = [];
    for (let index = 0; index < patientIds.length; index += 1) {
      const selected = Math.floor(random() * patientIds.length);
      indices.push(selected);
      sampled.push(...byPatient.get(patientIds[selected]));
    }
    const metrics = countsMetrics(sampled);
    const sensitivityDistribution = distribution(sampled.map(row => row.sensitivity));
    const timingDistribution = distribution(sampled.flatMap(row => row.timing.absoluteError.values));
    const snapshot = {
      sensitivity: metrics.sensitivity,
      ppv: metrics.ppv,
      f1: metrics.f1,
      recordSensitivityP05: sensitivityDistribution.p05,
      recordSensitivityMinimum: sensitivityDistribution.minimum,
      recordSensitivityP50: sensitivityDistribution.p50,
      falseDetectionsPerHour: metrics.falseDetectionsPerHour,
      timingAbsoluteErrorP95: timingDistribution.p95,
      technicalFailureRate: ratio(sampled.filter(row => row.status !== "SUCCESS").length, sampled.length),
    };
    for (const name of Object.keys(values)) if (snapshot[name] !== null) values[name].push(snapshot[name]);
    sampledPatientIndices.push(indices);
  }
  const intervals = {};
  for (const [name, rows] of Object.entries(values)) intervals[name] = rows.length ? { lower95: quantile(rows, 0.025), upper95: quantile(rows, 0.975), method: "patient-cluster-percentile" } : { lower95: null, upper95: null, method: "NOT_EVALUABLE" };
  return { replicates, seed, patientCount: patientIds.length, intervals, sampledPatientIndices };
}

function evaluateRPeakRecords(input) {
  requireCondition(plain(input), "RPEAK_EVALUATION_INPUT");
  requireCondition(Array.isArray(input.records) && input.records.length > 0, "RPEAK_EVALUATION_RECORDS");
  const primaryToleranceMs = input.primaryToleranceMs;
  const toleranceMs = input.toleranceMs || [50, 75, 100, 150];
  requireCondition(Number.isFinite(primaryToleranceMs) && toleranceMs.includes(primaryToleranceMs), "RPEAK_PRIMARY_TOLERANCE");
  requireCondition(plain(input.contractDigests), "RPEAK_CONTRACT_DIGESTS");
  for (const name of ["protocolSha256", "preprocessingSha256", "leadPolicySha256", "labelSnapshotSha256", "thresholdCalibrationSha256"]) {
    requireCondition(typeof input.contractDigests[name] === "string" && /^[0-9a-f]{64}$/.test(input.contractDigests[name]), `RPEAK_CONTRACT_DIGEST:${name}`);
  }
  const seen = new Set();
  const records = input.records.map(record => {
    const row = scoreRecord(record, primaryToleranceMs, toleranceMs);
    requireCondition(!seen.has(row.recordHmacSha256), "RPEAK_DUPLICATE_RECORD");
    seen.add(row.recordHmacSha256);
    row.primaryToleranceKey = String(primaryToleranceMs);
    return row;
  }).sort((a, b) => a.recordHmacSha256.localeCompare(b.recordHmacSha256));
  const patients = aggregateByPatient(records);
  const summary = summarizeRows(records, patients);
  const technicalFailureCount = records.filter(row => row.status !== "SUCCESS").length;
  const worstRecords = records.slice().sort((a, b) => (a.sensitivity ?? Infinity) - (b.sensitivity ?? Infinity) || a.recordHmacSha256.localeCompare(b.recordHmacSha256));
  return {
    schema: "ekg-development-rpeak-result-v1",
    metricVersion: RPEAK_METRIC_VERSION,
    matcherVersion: MATCHER_ALGORITHM,
    benchmarkId: input.benchmarkId,
    benchmarkVersion: input.benchmarkVersion,
    candidateId: input.candidateId,
    manifestPayloadSha256: input.manifestPayloadSha256,
    contractDigests: { ...input.contractDigests },
    primaryToleranceMs,
    toleranceMs: toleranceMs.slice(),
    denominators: {
      nPatients: patients.length,
      nRecords: records.length,
      nWindows: 0,
      analyzableDurationSeconds: records.reduce((sum, row) => sum + row.durationSeconds, 0),
      referenceEvents: summary.micro.counts.referenceEvents,
      predictedEvents: summary.micro.counts.predictedEvents,
      technicalFailureCount,
      excludedCount: 0,
      abstainedCount: records.filter(row => row.status === "ABSTAINED").length,
    },
    summary,
    confidenceIntervals: patientClusterBootstrap(records, input.bootstrap),
    records,
    patients,
    subgroups: subgroupMetrics(records, input.bootstrap),
    worstRecords,
    capabilityStatement: "Repeated development evaluation improves engineering capability and is not untouched clinical validation.",
    ...CLAIM_BOUNDARY,
  };
}

module.exports = { RPEAK_METRIC_VERSION, aggregateByPatient, countsMetrics, distribution, evaluateRPeakRecords, patientClusterBootstrap, quantile, scoreRecord, summarizeRows };
