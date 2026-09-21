"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const receipt = require("../validation/development/results/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2_TRAIN_RECEIPT.json");
const comparison = require("../validation/development/results/LUDB_QRS_V2_EVALUATOR_V1_V2_COMPARISON.json");
const historicalReceipt = require("../validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json");
const protocol = require("../evaluation/protocols/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function sha256File(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

test("result is bound to the committed predeclaration and exact successful CI", () => {
  assert.strictEqual(receipt.protocol.id, protocol.protocol_id);
  assert.strictEqual(receipt.protocol.sha256, sha256File(receipt.protocol.path));
  assert.strictEqual(receipt.protocol.predeclared_commit, "11ac6712ab52ed802c49d6f4bc2c896fe08adc03");
  assert.strictEqual(receipt.protocol.predeclared_tree, "e98a715129bb89ca979d86cf7074f984ca2c61b6");
  assert.strictEqual(receipt.protocol.exact_head_ci.run_id, 35598586487);
  assert.strictEqual(receipt.protocol.exact_head_ci.conclusion, "success");
  assert.strictEqual(receipt.code_under_test.changed_from_historical_train_result, false);
});

test("historical receipt and full-record aggregate are preserved exactly", () => {
  assert.strictEqual(sha256File("validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json"), protocol.historical_relationship.historical_receipt_sha256);
  const old = historicalReceipt.observed_development_metrics;
  const reproduced = receipt.historical_full_record_reproduction;
  assert.strictEqual(reproduced.exact_aggregate_reproduction, true);
  assert.strictEqual(reproduced.reference_event_count, old.reference_event_count);
  assert.strictEqual(reproduced.predicted_event_count, old.predicted_event_count);
  assert.strictEqual(reproduced.matched_event_count, old.matched_event_count);
  assert.strictEqual(reproduced.false_positive_count, old.false_positive_count);
  assert.strictEqual(reproduced.false_negative_count, old.false_negative_count);
  assert.strictEqual(reproduced.sensitivity, old.sensitivity);
  assert.strictEqual(reproduced.positive_predictive_value, old.positive_predictive_value);
  assert.strictEqual(reproduced.f1, old.f1);
  assert.strictEqual(reproduced.timing_mean_absolute_error_ms, old.timing_mean_absolute_error_ms);
  assert.strictEqual(reproduced.timing_median_absolute_error_ms, old.timing_median_absolute_error_ms);
});

test("coverage-aware accounting separates all edge exclusions from internal errors", () => {
  const observed = receipt.annotation_observable_metrics;
  const decomposition = receipt.false_positive_decomposition;
  assert.strictEqual(observed.reference_event_count, 1466);
  assert.strictEqual(observed.predicted_event_count, 1466);
  assert.strictEqual(observed.matched_event_count, 1465);
  assert.strictEqual(observed.false_positive_count, 1);
  assert.strictEqual(observed.false_negative_count, 1);
  assert.strictEqual(decomposition.excluded_before_count, 167);
  assert.strictEqual(decomposition.excluded_after_count, 164);
  assert.strictEqual(decomposition.excluded_outside_annotation_coverage_count, 331);
  assert.strictEqual(decomposition.historical_apparent_false_positive_count, decomposition.excluded_outside_annotation_coverage_count + decomposition.remaining_internal_false_positive_count);
  assert.strictEqual(decomposition.remaining_internal_false_positive_count, observed.false_positive_count);
  assert.strictEqual(decomposition.accounting_reconciles, true);
});

test("side-by-side comparison preserves timing scope and aggregate distributions", () => {
  assert.strictEqual(comparison.same_detector_implementation_and_configuration, true);
  assert.deepStrictEqual(comparison.views.historical_full_record, {
    reference_event_count: 1466,
    predicted_event_count: 1797,
    matched_event_count: 1465,
    false_positive_count: 332,
    false_negative_count: 1,
    sensitivity: 0.9993178717598908,
    positive_predictive_value: 0.8152476349471341,
    f1: 0.8979466748391052,
    timing_mean_absolute_error_ms: 14.501023890784984,
    timing_median_absolute_error_ms: 4,
  });
  assert.strictEqual(comparison.interpretation.timing_unchanged_because_matched_pairs_are_identical, true);
  assert.strictEqual(comparison.metric_delta_annotation_observable_minus_historical.timing_mean_absolute_error_ms, 0);
  assert.strictEqual(comparison.record_distribution.annotation_observable.positive_predictive_value_minimum, 0.875);
  assert.strictEqual(comparison.record_distribution.annotation_observable.f1_minimum, 0.9333333333333333);
  assert.strictEqual(comparison.failure_pattern_summary.catastrophic_records, 0);
});

test("record-level comparisons remain hash-bound outside Git", () => {
  assert.strictEqual(receipt.artifacts.record_level_result.repository_storage, false);
  assert.strictEqual(receipt.artifacts.side_by_side_comparison.repository_storage, false);
  assert.match(receipt.artifacts.record_level_result.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.artifacts.side_by_side_comparison.sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(comparison.outside_git_comparison_artifact.sha256, receipt.artifacts.side_by_side_comparison.sha256);
  assert.strictEqual(Object.hasOwn(comparison, "records"), false);
  assert.strictEqual(Object.hasOwn(comparison, "worstObservableRecords"), false);
});

test("holdout locked evaluation and clinical authority remain closed", () => {
  assert.strictEqual(receipt.dataset.executed_split, "train");
  assert.strictEqual(receipt.dataset.internal_holdout_annotations_parsed_or_scored, false);
  assert.strictEqual(receipt.frozen_v1_preservation.locked_cohort_used_for_parameter_selection, false);
  assert.strictEqual(receipt.frozen_v1_preservation.locked_v2_evaluation_executed, false);
  assert.strictEqual(receipt.decision.detector_tuning_justified_now, false);
  assert.strictEqual(receipt.decision.holdout_run_authorized_by_this_receipt, false);
  assert.strictEqual(receipt.authority.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(receipt.authority.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(receipt.authority.metrics, "NOT_REPORTABLE");
  assert.strictEqual(receipt.authority.activation, "NOT_ELIGIBLE");
  assert.strictEqual(receipt.authority.clinical_validity_inferred, false);
  assert.strictEqual(receipt.locked_v2_readiness, "NOT_READY_FOR_LOCKED_V2_EVALUATION");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-ludb-qrs-v2-coverage-result-tests-v2",
  pass: true,
  passed,
  total: passed,
  resultId: receipt.result_id,
  historicalFalsePositives: receipt.false_positive_decomposition.historical_apparent_false_positive_count,
  excludedEdgeDetections: receipt.false_positive_decomposition.excluded_outside_annotation_coverage_count,
  remainingInternalFalsePositives: receipt.false_positive_decomposition.remaining_internal_false_positive_count,
  holdoutAccessed: false,
  lockedMitbihAccessed: false,
}));
