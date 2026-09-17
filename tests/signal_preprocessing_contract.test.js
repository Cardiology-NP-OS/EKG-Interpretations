"use strict";

const assert = require("assert");
const {
  CANONICAL_12_LEAD_ORDER,
  buildSignalPreprocessingContract,
} = require("../lib/signal_preprocessing_contract");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const canonical = [...CANONICAL_12_LEAD_ORDER];

test("canonical order is identity mapping", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: canonical,
    sourceSamplingRateHz: 500,
    targetSamplingRateHz: 500,
    segmentSamples: 5000,
    sourceDatasetId: "synthetic",
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.reorderIndices, canonical.map((_, index) => index));
  assert.equal(result.requiresResampling, false);
  assert.equal(result.resamplingMethod, null);
  assert.equal(result.segmentDurationSeconds, 10);
});

test("MIMIC-style limb lead ordering produces deterministic reorder indices", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: ["I", "II", "III", "aVR", "aVF", "aVL", "V1", "V2", "V3", "V4", "V5", "V6"],
    sourceSamplingRateHz: 500,
    targetSamplingRateHz: 250,
    segmentSamples: 2500,
    resamplingMethod: "declared_external_method",
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.reorderIndices, [0, 1, 2, 3, 5, 4, 6, 7, 8, 9, 10, 11]);
  assert.equal(result.requiresResampling, true);
  assert.equal(result.segmentDurationSeconds, 10);
});

test("lead labels are normalized case-insensitively", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: [" i ", "ii", "III", "AVR", "avl", "aVf", "v1", "V2", "v3", "V4", "V5", "v6"],
    sourceSamplingRateHz: 250,
    targetSamplingRateHz: 250,
    segmentSamples: 2500,
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.canonicalLeadOrder, canonical);
});

test("unknown lead fails closed", () => {
  const leads = [...canonical];
  leads[11] = "VX";
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: leads,
    sourceSamplingRateHz: 250,
    targetSamplingRateHz: 250,
    segmentSamples: 2500,
  });
  assert.equal(result.pass, false);
  assert(result.errors.includes("UNKNOWN_SOURCE_LEAD_LABEL"));
  assert(result.errors.includes("MISSING_REQUIRED_12_LEAD"));
});

test("duplicate lead fails closed", () => {
  const leads = [...canonical];
  leads[11] = "V5";
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: leads,
    sourceSamplingRateHz: 250,
    targetSamplingRateHz: 250,
    segmentSamples: 2500,
  });
  assert.equal(result.pass, false);
  assert(result.errors.includes("DUPLICATE_SOURCE_LEAD"));
  assert(result.errors.includes("MISSING_REQUIRED_12_LEAD"));
});

test("resampling requires an explicit method declaration", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: canonical,
    sourceSamplingRateHz: 500,
    targetSamplingRateHz: 250,
    segmentSamples: 2500,
  });
  assert.equal(result.pass, false);
  assert(result.errors.includes("RESAMPLING_METHOD_REQUIRED"));
});

test("impossible sampling rates and segment sizes fail closed", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: canonical,
    sourceSamplingRateHz: Infinity,
    targetSamplingRateHz: 0,
    segmentSamples: -1,
  });
  assert.equal(result.pass, false);
  assert(result.errors.includes("INVALID_SOURCE_SAMPLING_RATE_HZ"));
  assert(result.errors.includes("INVALID_TARGET_SAMPLING_RATE_HZ"));
  assert(result.errors.includes("INVALID_SEGMENT_SAMPLES"));
});

test("partial-lead research contracts may be explicit without implying twelve-lead completeness", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: ["II", "V1"],
    requireCompleteTwelveLead: false,
    sourceSamplingRateHz: 250,
    targetSamplingRateHz: 250,
    segmentSamples: 1000,
  });
  assert.equal(result.pass, true);
  assert.deepEqual(result.canonicalLeadOrder, ["II", "V1"]);
  assert.deepEqual(result.reorderIndices, [0, 1]);
});

test("contract never creates project gold or clinical authority", () => {
  const result = buildSignalPreprocessingContract({
    sourceLeadLabels: canonical,
    sourceSamplingRateHz: 250,
    targetSamplingRateHz: 250,
    segmentSamples: 2500,
  });
  assert.equal(result.sourceLabelsPromotedToProjectGold, false);
  assert.equal(result.projectGoldCreated, false);
  assert.equal(result.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.equal(result.metrics, "NOT_REPORTABLE");
  assert.equal(result.activation, "NOT_ELIGIBLE");
  assert.equal(result.clinicalValidityInferred, false);
});

console.log(`signal preprocessing contract: ${passed}/9 tests passed`);
