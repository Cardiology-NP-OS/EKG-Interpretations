"use strict";
const assert = require("assert");
const { compareModelProbabilities, COMPARISON_LIMITS } = require("../lib/probability_comparison");
const hash = c => c.repeat(64);
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const table = (modelId, checkpoint, rows) => ({
    kind: "MODEL_PREDICTIONS", labels: ["A", "B"],
    provenance: { modelId, checkpointSha256: hash(checkpoint), preprocessingSha256: hash("c"), datasetManifestSha256: hash("d") },
    rows: rows.map((probabilities, i) => ({ recordId: "r" + i, sourceSha256: hash(i ? "f" : "e"), probabilities })),
  });
  return {
    reference: table("reference", "a", [[0.25, 0.75], [0.75, 0.25]]),
    candidate: table("candidate", "b", [[0.5, 0.5], [0.5, 0.5]]),
    thresholdPolicy: {
      thresholds: ["A", "B"].map(labelId => ({ labelId, referenceThreshold: 0.5, candidateThreshold: 0.5 })),
      provenance: { sourceCommit: "1".repeat(40), sourceTree: "2".repeat(40), artifactSha256: hash("3") },
    },
  };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
function reject(name, mutate, code) { test(name, () => { const input = fixture(); mutate(input); assert.throws(() => compareModelProbabilities(input), code); }); }

test("exact synthetic probability and threshold disagreement", () => {
  const result = compareModelProbabilities(fixture());
  assert.strictEqual(result.recordCount, 2);
  assert.strictEqual(result.labelCount, 2);
  assert.strictEqual(result.meanAbsoluteProbabilityDifference, 0.25);
  for (const row of result.perLabel) {
    assert.strictEqual(row.meanAbsoluteProbabilityDifference, 0.25);
    assert.strictEqual(row.thresholdDisagreementCount, 1);
    assert.strictEqual(row.referenceAboveThreshold, 1);
    assert.strictEqual(row.candidateAboveThreshold, 2);
  }
});
test("agreement never becomes diagnostic performance or gold", () => {
  const result = compareModelProbabilities(fixture());
  assert.strictEqual(result.comparisonType, "MODEL_TO_MODEL_AGREEMENT");
  assert.strictEqual(result.projectGold, false);
  assert.strictEqual(result.sourceLabelsAreProjectGold, false);
  assert.strictEqual(result.runtimeAuthority, false);
  assert.strictEqual(result.metrics, "NOT_REPORTABLE");
  assert.strictEqual(result.reportable, false);
  assert.strictEqual(result.clinicalAccuracyClaimed, false);
  assert.strictEqual(result.decisionAuthority, "NONE");
  assert.strictEqual(result.thresholdsOptimized, false);
  assert.strictEqual(result.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(result.activation, "NOT_ELIGIBLE");
  assert.ok(!("accuracy" in result));
  assert.ok(!("sensitivity" in result));
});
test("explicit label and record reorder preserves result and fingerprint", () => {
  const input = fixture(), expected = compareModelProbabilities(input);
  input.candidate.labels.reverse();
  input.candidate.rows.forEach(row => row.probabilities.reverse());
  input.candidate.rows.reverse();
  input.reference.rows.reverse();
  input.thresholdPolicy.thresholds.reverse();
  assert.deepStrictEqual(compareModelProbabilities(input), expected);
});
test("input is not mutated", () => {
  const input = fixture(), before = copy(input);
  compareModelProbabilities(input);
  assert.deepStrictEqual(input, before);
});
test("identity comparison returns zero difference", () => {
  const input = fixture(); input.candidate = copy(input.reference);
  const result = compareModelProbabilities(input);
  assert.strictEqual(result.meanAbsoluteProbabilityDifference, 0);
  assert.ok(result.perLabel.every(row => row.thresholdDisagreementCount === 0));
});
test("inclusive threshold equality is deterministic at zero and one", () => {
  const input = fixture();
  input.reference.rows.forEach(row => { row.probabilities = [0, 1]; });
  input.candidate = copy(input.reference);
  input.thresholdPolicy.thresholds[0].referenceThreshold = input.thresholdPolicy.thresholds[0].candidateThreshold = 0;
  input.thresholdPolicy.thresholds[1].referenceThreshold = input.thresholdPolicy.thresholds[1].candidateThreshold = 1;
  assert.ok(compareModelProbabilities(input).perLabel.every(row => row.referenceAboveThreshold === 2));
});
test("fingerprint binds probabilities thresholds source and both model identities", () => {
  const input = fixture(), expected = compareModelProbabilities(input).fingerprintSha256;
  for (const mutate of [
    x => { x.candidate.rows[0].probabilities[0] = 0.4; },
    x => { x.thresholdPolicy.thresholds[0].candidateThreshold = 0.4; },
    x => { x.candidate.provenance.checkpointSha256 = hash("4"); },
    x => { x.reference.provenance.preprocessingSha256 = hash("4"); },
    x => { x.thresholdPolicy.provenance.artifactSha256 = hash("4"); },
    x => { x.reference.rows[0].sourceSha256 = x.candidate.rows[0].sourceSha256 = hash("4"); },
  ]) { const altered = copy(input); mutate(altered); assert.notStrictEqual(compareModelProbabilities(altered).fingerprintSha256, expected); }
});
reject("no ground truth or authority override field", x => { x.projectGold = true; }, /COMPARISON_INPUT_FIELDS/);
reject("no model prediction relabeling as source truth", x => { x.reference.kind = "PROJECT_GOLD"; }, /COMPARISON_KIND/);
reject("source labels require a separate evaluation path", x => { x.reference.kind = "SOURCE_LABELS"; }, /COMPARISON_KIND/);
reject("no nested runtime authority override", x => { x.reference.provenance.runtimeAuthority = true; }, /COMPARISON_PROVENANCE_FIELDS/);
reject("no per-record gold override", x => { x.reference.rows[0].projectGold = true; }, /COMPARISON_ROW_FIELDS/);
reject("no threshold optimization mode", x => { x.thresholdPolicy.optimize = true; }, /COMPARISON_POLICY_FIELDS/);
reject("all model identity hashes required", x => { delete x.reference.provenance.checkpointSha256; }, /COMPARISON_PROVENANCE_FIELDS/);
reject("model hashes cannot be mutable URLs", x => { x.reference.provenance.checkpointSha256 = "https://example.com/main"; }, /COMPARISON_HASH/);
reject("different dataset manifests fail closed", x => { x.candidate.provenance.datasetManifestSha256 = hash("4"); }, /COMPARISON_DATASET_MISMATCH/);
reject("same record ID cannot hide substituted source", x => { x.candidate.rows[0].sourceSha256 = hash("4"); }, /COMPARISON_RECORD_SOURCE_MISMATCH/);
reject("duplicate record IDs fail closed", x => { x.candidate.rows[1].recordId = "r0"; }, /COMPARISON_DUPLICATE_RECORD/);
reject("missing record cannot silently intersect", x => { x.candidate.rows.pop(); }, /COMPARISON_RECORD_SET_MISMATCH/);
reject("unknown same-count record cannot silently intersect", x => { x.candidate.rows[0].recordId = "r9"; }, /COMPARISON_RECORD_SET_MISMATCH/);
reject("empty record arrays rejected", x => { x.reference.rows = []; }, /COMPARISON_ROWS/);
reject("duplicate labels rejected", x => { x.reference.labels[1] = "A"; }, /COMPARISON_DUPLICATE_LABEL/);
reject("mismatched labels rejected", x => { x.candidate.labels[1] = "C"; }, /COMPARISON_LABEL_SET_MISMATCH/);
reject("missing threshold has no fallback", x => { x.thresholdPolicy.thresholds.pop(); }, /COMPARISON_THRESHOLD_SET/);
reject("unknown threshold labels rejected", x => { x.thresholdPolicy.thresholds[1].labelId = "C"; }, /COMPARISON_THRESHOLD_SET/);
reject("duplicate threshold labels rejected", x => { x.thresholdPolicy.thresholds[1].labelId = "A"; }, /COMPARISON_THRESHOLD_SET/);
reject("probability geometry rejected", x => { x.reference.rows[0].probabilities.pop(); }, /COMPARISON_PROBABILITY_SHAPE/);
for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1, "0.5", null]) {
  reject("invalid probability " + String(value), x => { x.reference.rows[0].probabilities[0] = value; }, /COMPARISON_PROBABILITY/);
  reject("invalid threshold " + String(value), x => { x.thresholdPolicy.thresholds[0].candidateThreshold = value; }, /COMPARISON_THRESHOLD/);
}
reject("threshold provenance commit pinned", x => { x.thresholdPolicy.provenance.sourceCommit = "main"; }, /COMPARISON_GIT_ID/);
reject("sparse probability arrays rejected", x => { delete x.reference.rows[0].probabilities[0]; }, /COMPARISON_ARRAY/);
reject("sparse record arrays rejected", x => { delete x.reference.rows[0]; }, /COMPARISON_ARRAY/);
reject("array custom properties rejected", x => { x.reference.rows.extra = true; }, /COMPARISON_ARRAY/);
reject("symbol fields rejected", x => { x[Symbol("hidden")] = true; }, /COMPARISON_INPUT_FIELDS/);
reject("inherited authority containers rejected", x => { Object.setPrototypeOf(x.reference, { runtimeAuthority: true }); }, /COMPARISON_TABLE_OBJECT/);
test("accessor rejected without executing it", () => {
  const input = fixture(); let invoked = false;
  Object.defineProperty(input.reference.rows[0], "probabilities", { enumerable: true, get() { invoked = true; throw Error("getter executed"); } });
  assert.throws(() => compareModelProbabilities(input), /COMPARISON_ROW_FIELDS/);
  assert.strictEqual(invoked, false);
});
test("proxy rejected without executing traps", () => {
  let invoked = false;
  const proxy = new Proxy(fixture(), { ownKeys() { invoked = true; throw Error("trap executed"); } });
  assert.throws(() => compareModelProbabilities(proxy), /COMPARISON_INPUT_OBJECT/);
  assert.strictEqual(invoked, false);
});
reject("oversized labels rejected before traversal", x => { x.reference.labels = new Array(COMPARISON_LIMITS.maxLabels + 1); }, /COMPARISON_LABELS/);
reject("oversized record table rejected before traversal", x => { x.reference.rows = new Array(COMPARISON_LIMITS.maxRecords + 1); }, /COMPARISON_ROWS/);
reject("cycles cannot enter comparison schema", x => { x.reference.rows[0].probabilities = x; }, /COMPARISON_PROBABILITY_SHAPE/);
test("77-label tables align by label identity rather than column position", () => {
  const input = fixture();
  const labels = Array.from({ length: 77 }, (_, i) => "label:" + i);
  input.reference.labels = labels;
  input.reference.rows.forEach(row => { row.probabilities = labels.map((_, i) => i / 76); });
  input.candidate.labels = [...labels].reverse();
  input.candidate.rows.forEach(row => { row.probabilities = labels.map((_, i) => i / 76).reverse(); });
  input.thresholdPolicy.thresholds = labels.map(labelId => ({ labelId, referenceThreshold: 0.5, candidateThreshold: 0.5 }));
  const result = compareModelProbabilities(input);
  assert.strictEqual(result.labelCount, 77);
  assert.strictEqual(result.meanAbsoluteProbabilityDifference, 0);
  assert.ok(result.perLabel.every(row => row.thresholdDisagreementCount === 0));
});
test("cell budget rejects individually legal dimensions before inspecting rows", () => {
  const input = fixture();
  input.reference.labels = Array.from({ length: COMPARISON_LIMITS.maxLabels }, (_, i) => "L" + i);
  let invoked = false;
  const row = {};
  Object.defineProperty(row, "recordId", { enumerable: true, get() { invoked = true; throw Error("row inspected"); } });
  input.reference.rows = Array(COMPARISON_LIMITS.maxRecords).fill(row);
  assert.throws(() => compareModelProbabilities(input), /COMPARISON_CELL_BUDGET/);
  assert.strictEqual(invoked, false);
});
console.log(JSON.stringify({ schema: "ekg-model-probability-comparison-tests-v1", pass: true, passed, total: passed, projectGold: false, runtimeAuthority: false }));
