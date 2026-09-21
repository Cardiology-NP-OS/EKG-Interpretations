"use strict";

const { MATCHER_ALGORITHM, matchEventsV2 } = require("./event_matcher_v2");

const COVERAGE_EVALUATOR_ALGORITHM = "closed-first-to-last-reference-with-boundary-rescue-v2";

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function sampleIndexOf(value, code) {
  const sampleIndex = Number.isInteger(value) ? value : value && value.sampleIndex;
  requireCondition(Number.isInteger(sampleIndex) && sampleIndex >= 0, `${code}_SAMPLE_INDEX`);
  return sampleIndex;
}

function normalizeReferences(values, sampleCount) {
  requireCondition(Array.isArray(values), "COVERAGE_V2_REFERENCE_ARRAY_REQUIRED");
  requireCondition(values.length >= 2, values.length === 1
    ? "COVERAGE_V2_SINGLE_REFERENCE_UNOBSERVABLE"
    : "COVERAGE_V2_EMPTY_REFERENCE_UNOBSERVABLE");
  const samples = values.map(value => sampleIndexOf(value, "COVERAGE_V2_REFERENCE"));
  for (let index = 0; index < samples.length; index += 1) {
    requireCondition(samples[index] < sampleCount, "COVERAGE_V2_REFERENCE_OUT_OF_SIGNAL");
    if (index > 0) requireCondition(samples[index] > samples[index - 1], "COVERAGE_V2_REFERENCES_NOT_STRICTLY_INCREASING");
  }
  return samples;
}

function normalizePredictions(values, sampleCount) {
  requireCondition(Array.isArray(values), "COVERAGE_V2_PREDICTION_ARRAY_REQUIRED");
  return values.map((value, inputIndex) => {
    const sampleIndex = sampleIndexOf(value, "COVERAGE_V2_PREDICTION");
    requireCondition(sampleIndex < sampleCount, "COVERAGE_V2_PREDICTION_OUT_OF_SIGNAL");
    return { sampleIndex, inputIndex };
  });
}

function scoreAnnotationObservableInterval(referenceEvents, predictedEvents, options = {}) {
  const toleranceSamples = options.toleranceSamples;
  const sampleCount = options.sampleCount;
  requireCondition(Number.isInteger(toleranceSamples) && toleranceSamples >= 0, "COVERAGE_V2_TOLERANCE_REQUIRED");
  requireCondition(Number.isInteger(sampleCount) && sampleCount > 0, "COVERAGE_V2_SAMPLE_COUNT_REQUIRED");

  const references = normalizeReferences(referenceEvents, sampleCount);
  const predictions = normalizePredictions(predictedEvents, sampleCount);
  const firstReferenceSampleIndex = references[0];
  const lastReferenceSampleIndex = references[references.length - 1];
  const eligiblePredictions = predictions.filter(row => (
    row.sampleIndex >= Math.max(0, firstReferenceSampleIndex - toleranceSamples)
    && row.sampleIndex <= Math.min(sampleCount - 1, lastReferenceSampleIndex + toleranceSamples)
  ));
  const boundaryMatching = matchEventsV2(references, eligiblePredictions, {
    toleranceSamples,
    maxMatrixCells: options.maxMatrixCells,
  });
  const matchedPredictionInputIndices = new Set(
    boundaryMatching.matches.map(row => eligiblePredictions[row.predictedInputIndex].inputIndex)
  );
  const matches = boundaryMatching.matches.map(row => {
    const prediction = eligiblePredictions[row.predictedInputIndex];
    return {
      referenceSampleIndex: row.referenceSampleIndex,
      predictedSampleIndex: row.predictedSampleIndex,
      absoluteErrorSamples: row.absoluteErrorSamples,
      referenceInputIndex: row.referenceInputIndex,
      predictedInputIndex: prediction.inputIndex,
      predictionLocation: prediction.sampleIndex < firstReferenceSampleIndex
        ? "BEFORE_CORE_INTERVAL_BOUNDARY_RESCUE"
        : prediction.sampleIndex > lastReferenceSampleIndex
          ? "AFTER_CORE_INTERVAL_BOUNDARY_RESCUE"
          : "INSIDE_CORE_INTERVAL",
    };
  });
  const internalUnmatchedPredictions = predictions.filter(row => (
    row.sampleIndex >= firstReferenceSampleIndex
    && row.sampleIndex <= lastReferenceSampleIndex
    && !matchedPredictionInputIndices.has(row.inputIndex)
  ));
  const excludedBefore = predictions.filter(row => (
    row.sampleIndex < firstReferenceSampleIndex && !matchedPredictionInputIndices.has(row.inputIndex)
  ));
  const excludedAfter = predictions.filter(row => (
    row.sampleIndex > lastReferenceSampleIndex && !matchedPredictionInputIndices.has(row.inputIndex)
  ));
  const observablePredictedEventCount = matches.length + internalUnmatchedPredictions.length;
  const excludedEdgeDetectionCount = excludedBefore.length + excludedAfter.length;
  requireCondition(
    observablePredictedEventCount + excludedEdgeDetectionCount === predictions.length,
    "COVERAGE_V2_PREDICTION_ACCOUNTING"
  );

  const fullRecordMatching = matchEventsV2(references, predictions, {
    toleranceSamples,
    maxMatrixCells: options.maxMatrixCells,
  });
  requireCondition(fullRecordMatching.matchedCount === matches.length, "COVERAGE_V2_MATCH_CARDINALITY_DRIFT");

  return {
    schema: "ekg-annotation-coverage-scoring-result-v2",
    algorithm: COVERAGE_EVALUATOR_ALGORITHM,
    matcherAlgorithm: MATCHER_ALGORITHM,
    semantics: {
      coreInterval: "CLOSED_FIRST_REFERENCE_THROUGH_LAST_REFERENCE",
      predictionAtEitherCoreBoundary: "INCLUDED",
      predictionOutsideCoreInterval: "EXCLUDED_UNLESS_MATCHED_TO_A_BOUNDARY_REFERENCE_WITHIN_INCLUSIVE_TOLERANCE",
      unmatchedPredictionBeforeFirstReference: "EXCLUDED_EDGE_BEFORE",
      unmatchedPredictionAfterLastReference: "EXCLUDED_EDGE_AFTER",
      referenceAtEitherCoreBoundary: "INCLUDED",
      toleranceBoundary: "INCLUSIVE",
      emptyOrMalformedCoverage: "FAIL_CLOSED",
      singleReferenceCoverage: "FAIL_CLOSED_AS_NO_INTERVAL_CAN_BE_ESTABLISHED",
    },
    sampleCount,
    toleranceSamples,
    annotationObservableInterval: {
      firstReferenceSampleIndex,
      lastReferenceSampleIndex,
      startInclusive: true,
      endInclusive: true,
    },
    fullRecord: {
      predictedEventCount: predictions.length,
      matching: fullRecordMatching,
    },
    observable: {
      referenceEventCount: references.length,
      predictedEventCount: observablePredictedEventCount,
      matchedEventCount: matches.length,
      falsePositiveCount: internalUnmatchedPredictions.length,
      falseNegativeCount: boundaryMatching.falseNegativeCount,
      matches,
      unmatchedReferenceSampleIndices: boundaryMatching.unmatchedReferenceSampleIndices,
      internalFalsePositiveSampleIndices: internalUnmatchedPredictions.map(row => row.sampleIndex),
      boundaryRescueBeforeCount: matches.filter(row => row.predictionLocation === "BEFORE_CORE_INTERVAL_BOUNDARY_RESCUE").length,
      boundaryRescueAfterCount: matches.filter(row => row.predictionLocation === "AFTER_CORE_INTERVAL_BOUNDARY_RESCUE").length,
    },
    excludedEdges: {
      beforeCount: excludedBefore.length,
      afterCount: excludedAfter.length,
      totalCount: excludedEdgeDetectionCount,
      beforeSampleIndices: excludedBefore.map(row => row.sampleIndex),
      afterSampleIndices: excludedAfter.map(row => row.sampleIndex),
    },
  };
}

module.exports = {
  COVERAGE_EVALUATOR_ALGORITHM,
  scoreAnnotationObservableInterval,
};
