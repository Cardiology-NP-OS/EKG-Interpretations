"use strict";

const assert = require("assert");
const { MATCHER_ALGORITHM, matchEventsV2 } = require("../lib/event_matcher_v2");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

test("nearest candidate is credited and a farther duplicate remains false positive", () => {
  const out = matchEventsV2([100], [80, 99], { toleranceSamples: 25 });
  assert.strictEqual(out.matchedCount, 1);
  assert.strictEqual(out.matches[0].predictedSampleIndex, 99);
  assert.deepStrictEqual(out.unmatchedPredictedSampleIndices, [80]);
});

test("maximum cardinality wins before locally nearest timing", () => {
  const out = matchEventsV2([100, 200], [149, 151], { toleranceSamples: 51 });
  assert.strictEqual(out.matchedCount, 2);
  assert.strictEqual(out.falsePositiveCount, 0);
  assert.strictEqual(out.falseNegativeCount, 0);
  assert.deepStrictEqual(out.matches.map(row => [row.referenceSampleIndex, row.predictedSampleIndex]), [[100, 149], [200, 151]]);
});

test("one prediction cannot be reused for two close references", () => {
  const out = matchEventsV2([100, 110], [105], { toleranceSamples: 10 });
  assert.strictEqual(out.matchedCount, 1);
  assert.strictEqual(out.falseNegativeCount, 1);
  assert.strictEqual(out.falsePositiveCount, 0);
  assert.strictEqual(new Set(out.matches.map(row => row.predictedInputIndex)).size, 1);
});

test("duplicate predictions at one sample are accounted independently", () => {
  const out = matchEventsV2([100], [100, 100], { toleranceSamples: 0 });
  assert.strictEqual(out.matchedCount, 1);
  assert.strictEqual(out.falsePositiveCount, 1);
  assert.strictEqual(out.falseNegativeCount, 0);
});

test("events exactly on either tolerance boundary match", () => {
  const left = matchEventsV2([100], [85], { toleranceSamples: 15 });
  const right = matchEventsV2([100], [115], { toleranceSamples: 15 });
  assert.strictEqual(left.matchedCount, 1);
  assert.strictEqual(right.matchedCount, 1);
});

test("events one sample outside the tolerance window do not match", () => {
  const out = matchEventsV2([100], [84, 116], { toleranceSamples: 15 });
  assert.strictEqual(out.matchedCount, 0);
  assert.strictEqual(out.falsePositiveCount, 2);
  assert.strictEqual(out.falseNegativeCount, 1);
});

test("deterministic tie behavior produces byte-identical output", () => {
  const first = matchEventsV2([100], [90, 110], { toleranceSamples: 10 });
  const second = matchEventsV2([100], [90, 110], { toleranceSamples: 10 });
  assert.strictEqual(JSON.stringify(first), JSON.stringify(second));
  assert.strictEqual(first.matches[0].predictedSampleIndex, 110);
});

test("unsorted inputs are normalized without losing original identity", () => {
  const out = matchEventsV2([{sampleIndex:200},{sampleIndex:100}], [{sampleIndex:201},{sampleIndex:99}], { toleranceSamples: 2 });
  assert.strictEqual(out.matchedCount, 2);
  assert.deepStrictEqual(out.matches.map(row => row.referenceInputIndex), [1, 0]);
  assert.strictEqual(out.algorithm, MATCHER_ALGORITHM);
});

test("matrix resource limit fails closed", () => {
  assert.throws(() => matchEventsV2([1,2,3], [1,2,3], { toleranceSamples: 0, maxMatrixCells: 10 }), /MATCHER_V2_MATRIX_LIMIT_EXCEEDED/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-event-matcher-v2-tests-v1",
  pass: true,
  passed,
  total: passed,
  semantics: "MAX_CARDINALITY_MINIMUM_ABSOLUTE_ERROR_ORDERED_ONE_TO_ONE",
  historicalV1MetricsRewritten: false,
}));
