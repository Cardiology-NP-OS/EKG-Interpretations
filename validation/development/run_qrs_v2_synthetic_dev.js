#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { detectCandidateRPeaksV2 } = require("../../lib/qrs_detector_v2");
const { matchEventsV2 } = require("../../lib/event_matcher_v2");
const configuration = require("../../evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json");
const cohort = require("./QRS_V2_SYNTHETIC_DEV_V1.json");
const { buildSyntheticQrsFixture, fixtureManifest } = require("./qrs_v2_synthetic_corpus");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, probability) {
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const left = Math.floor(position);
  const fraction = position - left;
  return sorted[left] + ((sorted[left + 1] === undefined ? sorted[left] : sorted[left + 1]) - sorted[left]) * fraction;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : numerator / denominator;
}

function f1(sensitivity, positivePredictiveValue) {
  return sensitivity === null || positivePredictiveValue === null || sensitivity + positivePredictiveValue === 0
    ? null
    : 2 * sensitivity * positivePredictiveValue / (sensitivity + positivePredictiveValue);
}

function parseOutputArgument(argv) {
  const index = argv.indexOf("--output");
  if (index < 0) return null;
  requireCondition(argv[index + 1] && !argv[index + 1].startsWith("--"), "QRS_V2_DEV_OUTPUT_PATH_REQUIRED");
  return path.resolve(argv[index + 1]);
}

function runDevelopmentCohort() {
  requireCondition(cohort.relationship_to_locked_evaluation.contains_locked_record_ids === false, "QRS_V2_LOCKED_RECORD_LEAKAGE");
  requireCondition(cohort.relationship_to_locked_evaluation.contains_locked_signal_bytes === false, "QRS_V2_LOCKED_SIGNAL_LEAKAGE");
  requireCondition(cohort.relationship_to_locked_evaluation.contains_locked_annotations === false, "QRS_V2_LOCKED_LABEL_LEAKAGE");
  const records = [];
  const timingErrorsMs = [];
  for (const spec of fixtureManifest.fixtures) {
    const fixture = buildSyntheticQrsFixture(spec);
    const detection = detectCandidateRPeaksV2(fixture.samples, fixture.sampleRateHz, {
      configuration: configuration.detector,
      provenance: fixture.provenance,
    });
    const toleranceSamples = Math.round(spec.expected.max_timing_error_ms * fixture.sampleRateHz / 1000);
    const matching = matchEventsV2(fixture.referenceSampleIndices, detection.events, { toleranceSamples });
    const sensitivity = ratio(matching.matchedCount, matching.referenceCount);
    const positivePredictiveValue = ratio(matching.matchedCount, matching.predictedCount);
    const recordF1 = f1(sensitivity, positivePredictiveValue);
    const recordTiming = matching.matches.map(row => row.absoluteErrorSamples * 1000 / fixture.sampleRateHz);
    timingErrorsMs.push(...recordTiming);
    records.push({
      fixtureId: spec.id,
      mechanism: spec.mechanism,
      referenceEventCount: matching.referenceCount,
      predictedEventCount: matching.predictedCount,
      matchedEventCount: matching.matchedCount,
      falsePositiveCount: matching.falsePositiveCount,
      falseNegativeCount: matching.falseNegativeCount,
      sensitivity,
      positivePredictiveValue,
      f1: recordF1,
      timingMeanAbsoluteErrorMs: recordTiming.reduce((sum, value) => sum + value, 0) / recordTiming.length,
      timingMedianAbsoluteErrorMs: median(recordTiming),
      searchbackEventCount: detection.events.filter(row => row.detectionConfidenceClass === "SEARCHBACK").length,
      pacedComplexCandidateCount: detection.events.filter(row => row.pacedComplexCandidate).length,
      expectedAssertions: spec.expected,
    });
  }
  const totals = records.reduce((acc, row) => ({
    reference: acc.reference + row.referenceEventCount,
    predicted: acc.predicted + row.predictedEventCount,
    matched: acc.matched + row.matchedEventCount,
    falsePositive: acc.falsePositive + row.falsePositiveCount,
    falseNegative: acc.falseNegative + row.falseNegativeCount,
  }), { reference: 0, predicted: 0, matched: 0, falsePositive: 0, falseNegative: 0 });
  const sensitivity = ratio(totals.matched, totals.reference);
  const positivePredictiveValue = ratio(totals.matched, totals.predicted);
  return {
    schema: "ekg-qrs-v2-synthetic-development-result-v1",
    cohortId: cohort.cohort_id,
    cohortVersion: cohort.version,
    fixtureSetId: fixtureManifest.fixture_set_id,
    configurationId: configuration.configuration_id,
    detectorAlgorithm: configuration.algorithm,
    matcherProtocol: "RPEAK-EVENT-MATCHER-V2",
    aggregate: {
      referenceEventCount: totals.reference,
      predictedEventCount: totals.predicted,
      matchedEventCount: totals.matched,
      falsePositiveCount: totals.falsePositive,
      falseNegativeCount: totals.falseNegative,
      microSensitivity: sensitivity,
      microPositivePredictiveValue: positivePredictiveValue,
      microF1: f1(sensitivity, positivePredictiveValue),
      timingMeanAbsoluteErrorMs: timingErrorsMs.reduce((sum, value) => sum + value, 0) / timingErrorsMs.length,
      timingMedianAbsoluteErrorMs: median(timingErrorsMs),
    },
    recordDistribution: {
      recordSensitivityMedian: median(records.map(row => row.sensitivity)),
      recordSensitivityMin: Math.min(...records.map(row => row.sensitivity)),
      recordSensitivityP05: percentile(records.map(row => row.sensitivity), 0.05),
      recordPositivePredictiveValueMedian: median(records.map(row => row.positivePredictiveValue)),
      recordPositivePredictiveValueMin: Math.min(...records.map(row => row.positivePredictiveValue)),
      recordPositivePredictiveValueP05: percentile(records.map(row => row.positivePredictiveValue), 0.05),
      recordF1Median: median(records.map(row => row.f1)),
      recordF1Min: Math.min(...records.map(row => row.f1)),
      recordF1P05: percentile(records.map(row => row.f1), 0.05),
    },
    records,
    developmentDataBoundary: {
      syntheticOnly: true,
      realClinicalSignals: false,
      lockedMitbihV1SignalsOrLabelsUsed: false,
      sourceLabelsAreProjectGold: false,
      projectGold: false,
    },
    limitations: [
      "Deterministic synthetic engineering fixtures do not establish real-world generalization.",
      "No external development corpus was executed because registered candidates remain license-review-blocked.",
      "These metrics are not clinical validation and are not reportable clinical evidence."
    ],
    authority: cohort.authority,
  };
}

if (require.main === module) {
  const output = runDevelopmentCohort();
  const outputPath = parseOutputArgument(process.argv.slice(2));
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

module.exports = { runDevelopmentCohort };
