"use strict";

const MATCHER_ALGORITHM = "ordered-max-cardinality-minimum-absolute-error-v2";

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function normalizeEvents(values, code) {
  requireCondition(Array.isArray(values), `${code}_ARRAY_REQUIRED`);
  const normalized = values.map((value, inputIndex) => {
    const sampleIndex = Number.isInteger(value) ? value : value && value.sampleIndex;
    requireCondition(Number.isInteger(sampleIndex) && sampleIndex >= 0, `${code}_SAMPLE_INDEX`);
    return { sampleIndex, inputIndex };
  });
  normalized.sort((a, b) => a.sampleIndex - b.sampleIndex || a.inputIndex - b.inputIndex);
  return normalized;
}

function betterScore(candidate, incumbent) {
  if (candidate.matches !== incumbent.matches) return candidate.matches > incumbent.matches;
  if (candidate.cost !== incumbent.cost) return candidate.cost < incumbent.cost;
  return candidate.priority < incumbent.priority;
}

function matchEventsV2(referenceEvents, predictedEvents, options = {}) {
  const toleranceSamples = options.toleranceSamples;
  requireCondition(Number.isInteger(toleranceSamples) && toleranceSamples >= 0, "MATCHER_V2_TOLERANCE_REQUIRED");
  const maxMatrixCells = options.maxMatrixCells === undefined ? 20000000 : options.maxMatrixCells;
  requireCondition(Number.isInteger(maxMatrixCells) && maxMatrixCells > 0, "MATCHER_V2_MATRIX_LIMIT");
  const references = normalizeEvents(referenceEvents, "MATCHER_V2_REFERENCE");
  const predictions = normalizeEvents(predictedEvents, "MATCHER_V2_PREDICTION");
  const rows = references.length + 1;
  const columns = predictions.length + 1;
  requireCondition(rows * columns <= maxMatrixCells, "MATCHER_V2_MATRIX_LIMIT_EXCEEDED");

  const directions = new Uint8Array(rows * columns);
  let previousMatches = new Uint32Array(columns);
  let previousCosts = new Float64Array(columns);
  for (let i = 1; i < rows; i += 1) {
    const currentMatches = new Uint32Array(columns);
    const currentCosts = new Float64Array(columns);
    directions[i * columns] = 1;
    for (let j = 1; j < columns; j += 1) {
      let best = { matches: previousMatches[j], cost: previousCosts[j], direction: 1, priority: 2 };
      const skipPrediction = { matches: currentMatches[j - 1], cost: currentCosts[j - 1], direction: 2, priority: 1 };
      if (betterScore(skipPrediction, best)) best = skipPrediction;
      const error = Math.abs(references[i - 1].sampleIndex - predictions[j - 1].sampleIndex);
      if (error <= toleranceSamples) {
        const match = {
          matches: previousMatches[j - 1] + 1,
          cost: previousCosts[j - 1] + error,
          direction: 3,
          priority: 0,
        };
        if (betterScore(match, best)) best = match;
      }
      currentMatches[j] = best.matches;
      currentCosts[j] = best.cost;
      directions[i * columns + j] = best.direction;
    }
    previousMatches = currentMatches;
    previousCosts = currentCosts;
  }

  const matches = [];
  let i = references.length;
  let j = predictions.length;
  while (i > 0 || j > 0) {
    const direction = directions[i * columns + j];
    if (i > 0 && j > 0 && direction === 3) {
      const reference = references[i - 1];
      const prediction = predictions[j - 1];
      matches.push({
        referenceSampleIndex: reference.sampleIndex,
        predictedSampleIndex: prediction.sampleIndex,
        absoluteErrorSamples: Math.abs(reference.sampleIndex - prediction.sampleIndex),
        referenceInputIndex: reference.inputIndex,
        predictedInputIndex: prediction.inputIndex,
      });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || direction === 2)) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  matches.reverse();
  const matchedReferenceIndices = new Set(matches.map(row => row.referenceInputIndex));
  const matchedPredictionIndices = new Set(matches.map(row => row.predictedInputIndex));
  const unmatchedReferences = references.filter(row => !matchedReferenceIndices.has(row.inputIndex));
  const unmatchedPredictions = predictions.filter(row => !matchedPredictionIndices.has(row.inputIndex));
  return {
    schema: "ekg-event-matching-result-v2",
    algorithm: MATCHER_ALGORITHM,
    semantics: {
      cardinality: "MAXIMIZED",
      timingError: "MINIMIZED_TOTAL_ABSOLUTE_ERROR_AMONG_ORDER_PRESERVING_MAX_CARDINALITY_ASSIGNMENTS",
      candidateReuse: false,
      toleranceBoundary: "INCLUSIVE",
      tieBehavior: "MATCH_THEN_SKIP_PREDICTION_THEN_SKIP_REFERENCE",
    },
    toleranceSamples,
    referenceCount: references.length,
    predictedCount: predictions.length,
    matchedCount: matches.length,
    falseNegativeCount: unmatchedReferences.length,
    falsePositiveCount: unmatchedPredictions.length,
    matches,
    unmatchedReferenceSampleIndices: unmatchedReferences.map(row => row.sampleIndex),
    unmatchedPredictedSampleIndices: unmatchedPredictions.map(row => row.sampleIndex),
  };
}

module.exports = {
  MATCHER_ALGORITHM,
  matchEventsV2,
};
