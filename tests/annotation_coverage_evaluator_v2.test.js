"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { scoreAnnotationObservableInterval } = require("../lib/annotation_coverage_evaluator_v2");

const root = path.join(__dirname, "..");
const historicalReceiptSha256 = "34738b112f033a9cb699afc1ea840c89ef79f5e0a4d47c6c2b0a02aa5bb58daf";
const frozenDetectorSha256 = Object.freeze({
  "lib/qrs_detector_v2.js": "da8dcab76e4bb43a69e5ec69cd7689a2b9bf49bddf25e9760be46ffbccbbc11b",
  "lib/qrs_multilead_v2.js": "182af61463d4037ae2ac3a1456a65cb9713418018fbdb2ed751933ff27f725d9",
  "evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json": "4ab92dfcc44d5348a7759bfd1e58cfe16cf2adbeb5ee982366f209070c66ec57",
});

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function score(predictions, references = [100, 200], toleranceSamples = 10) {
  return scoreAnnotationObservableInterval(references, predictions, { toleranceSamples, sampleCount: 300 });
}

test("prediction inside the closed observable interval is scored", () => {
  const result = score([100, 150, 200]);
  assert.strictEqual(result.observable.matchedEventCount, 2);
  assert.deepStrictEqual(result.observable.internalFalsePositiveSampleIndices, [150]);
  assert.strictEqual(result.observable.falsePositiveCount, 1);
});

test("unmatched predictions immediately before and after coverage are excluded", () => {
  const result = score([89, 100, 200, 211]);
  assert.strictEqual(result.excludedEdges.beforeCount, 1);
  assert.strictEqual(result.excludedEdges.afterCount, 1);
  assert.strictEqual(result.observable.falsePositiveCount, 0);
  assert.strictEqual(result.fullRecord.predictedEventCount, 4);
});

test("predictions exactly on both interval boundaries are included", () => {
  const result = score([100, 200]);
  assert.strictEqual(result.observable.predictedEventCount, 2);
  assert.strictEqual(result.excludedEdges.totalCount, 0);
  assert.strictEqual(result.observable.matchedEventCount, 2);
});

test("inclusive matcher tolerance rescues predictions outside a boundary", () => {
  const result = score([90, 210]);
  assert.strictEqual(result.observable.matchedEventCount, 2);
  assert.strictEqual(result.observable.boundaryRescueBeforeCount, 1);
  assert.strictEqual(result.observable.boundaryRescueAfterCount, 1);
  assert.strictEqual(result.excludedEdges.totalCount, 0);
});

test("one sample beyond tolerance is excluded and leaves the boundary reference false negative", () => {
  const result = score([89, 200]);
  assert.strictEqual(result.excludedEdges.beforeCount, 1);
  assert.strictEqual(result.observable.falseNegativeCount, 1);
});

test("multiple predictions around a boundary are accounted once each", () => {
  const result = score([95, 100, 105, 200]);
  assert.strictEqual(result.observable.matchedEventCount, 2);
  assert.strictEqual(result.excludedEdges.beforeCount, 1);
  assert.deepStrictEqual(result.observable.internalFalsePositiveSampleIndices, [105]);
  assert.strictEqual(result.fullRecord.predictedEventCount, result.observable.predictedEventCount + result.excludedEdges.totalCount);
});

test("an internal genuine false positive remains a false positive", () => {
  const result = score([100, 175, 200]);
  assert.strictEqual(result.observable.falsePositiveCount, 1);
  assert.deepStrictEqual(result.observable.internalFalsePositiveSampleIndices, [175]);
});

test("a missing internal reference is an observable false negative", () => {
  const result = score([100, 200], [100, 150, 200]);
  assert.strictEqual(result.observable.falseNegativeCount, 1);
  assert.deepStrictEqual(result.observable.unmatchedReferenceSampleIndices, [150]);
});

test("empty malformed duplicate and single-event coverage fail closed", () => {
  assert.throws(() => scoreAnnotationObservableInterval([], [], { toleranceSamples: 10, sampleCount: 300 }), /EMPTY_REFERENCE_UNOBSERVABLE/);
  assert.throws(() => scoreAnnotationObservableInterval([100], [], { toleranceSamples: 10, sampleCount: 300 }), /SINGLE_REFERENCE_UNOBSERVABLE/);
  assert.throws(() => scoreAnnotationObservableInterval([100, "bad"], [], { toleranceSamples: 10, sampleCount: 300 }), /REFERENCE_SAMPLE_INDEX/);
  assert.throws(() => scoreAnnotationObservableInterval([100, 100], [], { toleranceSamples: 10, sampleCount: 300 }), /NOT_STRICTLY_INCREASING/);
  assert.throws(() => scoreAnnotationObservableInterval([200, 100], [], { toleranceSamples: 10, sampleCount: 300 }), /NOT_STRICTLY_INCREASING/);
});

test("full-record counts remain available and all predictions reconcile", () => {
  const result = score([20, 100, 150, 200, 280]);
  assert.strictEqual(result.fullRecord.predictedEventCount, 5);
  assert.strictEqual(result.observable.predictedEventCount, 3);
  assert.strictEqual(result.excludedEdges.totalCount, 2);
  assert.strictEqual(result.fullRecord.predictedEventCount, result.observable.predictedEventCount + result.excludedEdges.totalCount);
});

test("observable scoring does not mutate detector output or references", () => {
  const references = Object.freeze([100, 200]);
  const predictions = Object.freeze([
    Object.freeze({ sampleIndex: 200, confidence: "PRIMARY" }),
    Object.freeze({ sampleIndex: 100, confidence: "PRIMARY" }),
  ]);
  const before = JSON.stringify(predictions);
  const result = scoreAnnotationObservableInterval(references, predictions, { toleranceSamples: 10, sampleCount: 300 });
  assert.strictEqual(JSON.stringify(predictions), before);
  assert.strictEqual(result.observable.matchedEventCount, 2);
});

test("detector/configuration and historical receipt identities remain immutable", () => {
  for (const [relativePath, expected] of Object.entries(frozenDetectorSha256)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
    assert.strictEqual(actual, expected, relativePath);
  }
  const receiptPath = path.join(root, "validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json");
  const receiptHash = crypto.createHash("sha256").update(fs.readFileSync(receiptPath)).digest("hex");
  assert.strictEqual(receiptHash, historicalReceiptSha256);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-annotation-coverage-evaluator-v2-tests",
  pass: true,
  passed,
  total: passed,
  singleReferenceBehavior: "FAIL_CLOSED",
  historicalReceiptRewritten: false,
  detectorConfigurationChanged: false,
}));
