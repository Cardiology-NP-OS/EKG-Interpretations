"use strict";
const crypto = require("crypto");
const { types: { isProxy } } = require("util");
const { EVALUATION_GOVERNANCE } = require("./evaluation_runtime");

const COMPARISON_LIMITS = Object.freeze({ maxLabels: 256, maxRecords: 10000, maxProbabilityCells: 1000000 });
function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function exactObject(value, fields, prefix) {
  requireCondition(value !== null && typeof value === "object" && !isProxy(value) && !Array.isArray(value), prefix + "_OBJECT");
  const proto = Object.getPrototypeOf(value);
  requireCondition(proto === Object.prototype || proto === null, prefix + "_OBJECT");
  const keys = Reflect.ownKeys(value);
  requireCondition(keys.length === fields.length && keys.every(key => fields.includes(key)), prefix + "_FIELDS");
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireCondition(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable, prefix + "_FIELDS");
  }
}
function denseArray(value, min, max, prefix) {
  requireCondition(value !== null && typeof value === "object" && !isProxy(value) && Array.isArray(value), prefix);
  requireCondition(Object.getPrototypeOf(value) === Array.prototype, prefix);
  requireCondition(value.length >= min && value.length <= max, prefix);
  const keys = Reflect.ownKeys(value);
  requireCondition(keys.length === value.length + 1 && keys.includes("length"), "COMPARISON_ARRAY");
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    requireCondition(descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable, "COMPARISON_ARRAY");
  }
  return value;
}
function id(value) {
  requireCondition(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value), "COMPARISON_ID");
  return value;
}
function hash(value) {
  requireCondition(typeof value === "string" && /^[0-9a-f]{64}$/.test(value), "COMPARISON_HASH");
  return value;
}
function probability(value, code) {
  requireCondition(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, code);
  return Object.is(value, -0) ? 0 : value;
}
function normalizeTable(value) {
  exactObject(value, ["kind", "labels", "provenance", "rows"], "COMPARISON_TABLE");
  requireCondition(value.kind === "MODEL_PREDICTIONS", "COMPARISON_KIND");
  const labels = denseArray(value.labels, 1, COMPARISON_LIMITS.maxLabels, "COMPARISON_LABELS").map(id);
  requireCondition(new Set(labels).size === labels.length, "COMPARISON_DUPLICATE_LABEL");
  const canonicalLabels = [...labels].sort();
  const positions = canonicalLabels.map(label => labels.indexOf(label));
  const p = value.provenance;
  exactObject(p, ["modelId", "checkpointSha256", "preprocessingSha256", "datasetManifestSha256"], "COMPARISON_PROVENANCE");
  const provenance = { modelId: id(p.modelId), checkpointSha256: hash(p.checkpointSha256), preprocessingSha256: hash(p.preprocessingSha256), datasetManifestSha256: hash(p.datasetManifestSha256) };
  const rawRows = denseArray(value.rows, 1, COMPARISON_LIMITS.maxRecords, "COMPARISON_ROWS");
  requireCondition(rawRows.length * labels.length <= COMPARISON_LIMITS.maxProbabilityCells, "COMPARISON_CELL_BUDGET");
  const recordIds = new Set();
  const rows = rawRows.map(row => {
    exactObject(row, ["recordId", "sourceSha256", "probabilities"], "COMPARISON_ROW");
    const recordId = id(row.recordId), sourceSha256 = hash(row.sourceSha256);
    requireCondition(!recordIds.has(recordId), "COMPARISON_DUPLICATE_RECORD");
    recordIds.add(recordId);
    const values = denseArray(row.probabilities, labels.length, labels.length, "COMPARISON_PROBABILITY_SHAPE")
      .map(value => probability(value, "COMPARISON_PROBABILITY"));
    return { recordId, sourceSha256, probabilities: positions.map(index => values[index]) };
  }).sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0);
  return { kind: "MODEL_PREDICTIONS", labels: canonicalLabels, provenance, rows };
}
function normalizePolicy(value, labels) {
  exactObject(value, ["thresholds", "provenance"], "COMPARISON_POLICY");
  const p = value.provenance;
  exactObject(p, ["sourceCommit", "sourceTree", "artifactSha256"], "COMPARISON_POLICY_PROVENANCE");
  for (const field of ["sourceCommit", "sourceTree"])
    requireCondition(typeof p[field] === "string" && /^[0-9a-f]{40}$/.test(p[field]), "COMPARISON_GIT_ID");
  const provenance = { sourceCommit: p.sourceCommit, sourceTree: p.sourceTree, artifactSha256: hash(p.artifactSha256) };
  const rows = denseArray(value.thresholds, labels.length, labels.length, "COMPARISON_THRESHOLD_SET");
  const byLabel = new Map();
  for (const row of rows) {
    exactObject(row, ["labelId", "referenceThreshold", "candidateThreshold"], "COMPARISON_THRESHOLD_ROW");
    const labelId = id(row.labelId);
    requireCondition(labels.includes(labelId) && !byLabel.has(labelId), "COMPARISON_THRESHOLD_SET");
    byLabel.set(labelId, {
      labelId,
      referenceThreshold: probability(row.referenceThreshold, "COMPARISON_THRESHOLD"),
      candidateThreshold: probability(row.candidateThreshold, "COMPARISON_THRESHOLD"),
    });
  }
  return { thresholds: labels.map(label => byLabel.get(label)), provenance };
}
function compareModelProbabilities(input) {
  exactObject(input, ["reference", "candidate", "thresholdPolicy"], "COMPARISON_INPUT");
  const reference = normalizeTable(input.reference), candidate = normalizeTable(input.candidate);
  requireCondition(reference.labels.length === candidate.labels.length && reference.labels.every((label, index) => label === candidate.labels[index]), "COMPARISON_LABEL_SET_MISMATCH");
  requireCondition(reference.provenance.datasetManifestSha256 === candidate.provenance.datasetManifestSha256, "COMPARISON_DATASET_MISMATCH");
  requireCondition(reference.rows.length === candidate.rows.length && reference.rows.every((row, index) => row.recordId === candidate.rows[index].recordId), "COMPARISON_RECORD_SET_MISMATCH");
  requireCondition(reference.rows.every((row, index) => row.sourceSha256 === candidate.rows[index].sourceSha256), "COMPARISON_RECORD_SOURCE_MISMATCH");
  const thresholdPolicy = normalizePolicy(input.thresholdPolicy, reference.labels);
  const recordCount = reference.rows.length;
  const perLabel = reference.labels.map((labelId, labelIndex) => {
    const thresholds = thresholdPolicy.thresholds[labelIndex];
    let difference = 0, thresholdDisagreementCount = 0, referenceAboveThreshold = 0, candidateAboveThreshold = 0;
    for (let rowIndex = 0; rowIndex < recordCount; rowIndex++) {
      const r = reference.rows[rowIndex].probabilities[labelIndex], c = candidate.rows[rowIndex].probabilities[labelIndex];
      difference += Math.abs(r - c);
      const rAbove = r >= thresholds.referenceThreshold, cAbove = c >= thresholds.candidateThreshold;
      referenceAboveThreshold += Number(rAbove);
      candidateAboveThreshold += Number(cAbove);
      thresholdDisagreementCount += Number(rAbove !== cAbove);
    }
    return { labelId, meanAbsoluteProbabilityDifference: difference / recordCount, thresholdDisagreementCount, referenceAboveThreshold, candidateAboveThreshold };
  });
  const normalized = { reference, candidate, thresholdPolicy };
  return {
    schema: "ekg-model-probability-comparison-v1",
    comparisonType: "MODEL_TO_MODEL_AGREEMENT",
    recordCount,
    labelCount: reference.labels.length,
    meanAbsoluteProbabilityDifference: perLabel.reduce((sum, row) => sum + row.meanAbsoluteProbabilityDifference, 0) / perLabel.length,
    perLabel,
    referenceProvenance: reference.provenance,
    candidateProvenance: candidate.provenance,
    thresholdPolicy,
    fingerprintSha256: crypto.createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex"),
    reportable: false,
    thresholdsOptimized: false,
    clinicalAccuracyClaimed: false,
    decisionAuthority: "NONE",
    ...EVALUATION_GOVERNANCE,
  };
}
module.exports = { COMPARISON_LIMITS, compareModelProbabilities };
