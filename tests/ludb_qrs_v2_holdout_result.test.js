"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const receipt = require("../validation/development/results/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1_RECEIPT.json");
const comparison = require("../validation/development/results/LUDB_QRS_V2_COVERAGE_V2_TRAIN_HOLDOUT_V1_COMPARISON.json");
const protocol = require("../evaluation/protocols/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1.json");
const trainReceipt = require("../validation/development/results/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2_TRAIN_RECEIPT.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function sha256File(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

test("holdout result is bound to the exact predeclaration and successful CI", () => {
  assert.strictEqual(receipt.protocol.id, protocol.protocol_id);
  assert.strictEqual(receipt.protocol.sha256, sha256File(receipt.protocol.path));
  assert.strictEqual(receipt.protocol.predeclared_commit, "577d2488dc06daabc73b625cb89eb9594b393d2c");
  assert.strictEqual(receipt.protocol.predeclared_tree, "d032f661e52e12dcc197e77d89bea7ab3d1cee44");
  assert.strictEqual(receipt.protocol.exact_head_ci.run_id, 35601184795);
  assert.strictEqual(receipt.protocol.exact_head_ci.conclusion, "success");
  assert.strictEqual(receipt.protocol.exact_head_ci.all_jobs_successful, true);
});

test("frozen detector evaluator matcher and configuration stayed unchanged", () => {
  assert.strictEqual(receipt.code_under_test.configuration_id, protocol.detector_code_under_test.configuration_id);
  assert.strictEqual(receipt.code_under_test.changed_after_frozen_train_result, false);
  assert.strictEqual(receipt.evaluator.changed_after_frozen_train_result, false);
  assert.strictEqual(comparison.same_detector_configuration_evaluator_and_matcher, true);
  for (const [relativePath, expectedHash] of Object.entries(protocol.frozen_file_identities)) {
    assert.strictEqual(sha256File(relativePath), expectedHash, relativePath);
  }
});

test("holdout aggregate and coverage accounting reconcile exactly", () => {
  const full = receipt.full_record_context;
  const observed = receipt.annotation_observable_metrics;
  const edge = receipt.false_positive_decomposition;
  assert.strictEqual(full.reference_event_count, 364);
  assert.strictEqual(full.predicted_event_count, 445);
  assert.strictEqual(full.matched_event_count, 363);
  assert.strictEqual(full.false_positive_count, 82);
  assert.strictEqual(full.false_negative_count, 1);
  assert.strictEqual(observed.reference_event_count, 364);
  assert.strictEqual(observed.predicted_event_count, 365);
  assert.strictEqual(observed.matched_event_count, 363);
  assert.strictEqual(observed.false_positive_count, 2);
  assert.strictEqual(observed.false_negative_count, 1);
  assert.strictEqual(edge.excluded_before_count, 41);
  assert.strictEqual(edge.excluded_after_count, 39);
  assert.strictEqual(edge.excluded_outside_annotation_coverage_count, 80);
  assert.strictEqual(edge.full_record_apparent_false_positive_count, edge.excluded_outside_annotation_coverage_count + edge.remaining_internal_false_positive_count);
  assert.strictEqual(full.predicted_event_count, observed.predicted_event_count + edge.excluded_outside_annotation_coverage_count);
  assert.strictEqual(edge.accounting_reconciles, true);
});

test("aggregate pass cannot override the frozen catastrophic-record failure", () => {
  assert.strictEqual(receipt.holdout_criteria.aggregate_targets_met, true);
  assert.strictEqual(receipt.holdout_criteria.catastrophic_record_present, true);
  assert.strictEqual(receipt.holdout_criteria.outcome, "HOLDOUT_ENGINEERING_TARGETS_NOT_MET");
  assert.strictEqual(receipt.failure_analysis.catastrophic_record_count, 1);
  assert.strictEqual(receipt.failure_analysis.catastrophic_record_observable_metrics.sensitivity, 0.875);
  assert.ok(receipt.failure_analysis.catastrophic_record_observable_metrics.sensitivity < protocol.holdout_criteria.catastrophic_record_sensitivity_floor);
  assert.strictEqual(receipt.decision.candidate_passed_one_shot_holdout, false);
  assert.strictEqual(receipt.decision.detector_configuration_promotion_eligible, false);
});

test("train versus holdout comparison preserves frozen train evidence", () => {
  const train = comparison.views.frozen_open_train_annotation_observable;
  assert.strictEqual(train.record_count, trainReceipt.dataset.record_count);
  assert.strictEqual(train.reference_event_count, trainReceipt.annotation_observable_metrics.reference_event_count);
  assert.strictEqual(train.predicted_event_count, trainReceipt.annotation_observable_metrics.predicted_event_count);
  assert.strictEqual(train.matched_event_count, trainReceipt.annotation_observable_metrics.matched_event_count);
  assert.strictEqual(train.false_positive_count, trainReceipt.annotation_observable_metrics.false_positive_count);
  assert.strictEqual(train.false_negative_count, trainReceipt.annotation_observable_metrics.false_negative_count);
  assert.strictEqual(train.sensitivity, trainReceipt.annotation_observable_metrics.sensitivity);
  assert.strictEqual(train.positive_predictive_value, trainReceipt.annotation_observable_metrics.positive_predictive_value);
  assert.strictEqual(train.f1, trainReceipt.annotation_observable_metrics.f1);
  assert.strictEqual(comparison.timing_interpretation.full_record_and_annotation_observable_timing_are_identical_within_holdout, true);
});

test("record-level identities stay outside Git while bounded mechanisms remain auditable", () => {
  assert.strictEqual(receipt.artifacts.record_level_result.repository_storage, false);
  assert.strictEqual(receipt.artifacts.train_holdout_comparison.repository_storage, false);
  assert.match(receipt.artifacts.record_level_result.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.artifacts.train_holdout_comparison.sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(receipt.failure_analysis.record_identities_and_sample_indices, "PRESENT_ONLY_IN_HASH_BOUND_OUTSIDE_GIT_ARTIFACTS");
  assert.strictEqual(Object.hasOwn(comparison, "records"), false);
  assert.strictEqual(Object.hasOwn(comparison, "worstHoldoutRecords"), false);
  assert.strictEqual(receipt.failure_analysis.internal_false_positive_mechanisms.length, 2);
});

test("spent holdout locked MIT-BIH and governance boundaries fail closed", () => {
  assert.strictEqual(receipt.dataset.executed_split, "validation");
  assert.strictEqual(receipt.dataset.holdout_annotations_parsed_or_scored_before_this_execution, false);
  assert.strictEqual(receipt.dataset.holdout_annotations_parsed_and_scored_by_this_execution, true);
  assert.strictEqual(receipt.dataset.holdout_now_consumed, true);
  assert.strictEqual(receipt.dataset.post_holdout_parameter_tuning_on_this_split_allowed, false);
  assert.strictEqual(receipt.decision.holdout_may_be_reopened_for_candidate_selection, false);
  assert.strictEqual(receipt.frozen_v1_preservation.locked_cohort_used_for_parameter_selection, false);
  assert.strictEqual(receipt.frozen_v1_preservation.locked_v2_evaluation_executed, false);
  assert.strictEqual(receipt.authority.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(receipt.authority.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(receipt.authority.metrics, "NOT_REPORTABLE");
  assert.strictEqual(receipt.authority.activation, "NOT_ELIGIBLE");
  assert.strictEqual(receipt.authority.clinical_validity_inferred, false);
  assert.strictEqual(receipt.locked_v2_readiness, "NOT_READY_FOR_LOCKED_V2_EVALUATION");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-ludb-qrs-v2-holdout-result-tests-v1",
  pass: true,
  passed,
  total: passed,
  resultId: receipt.result_id,
  outcome: receipt.holdout_criteria.outcome,
  holdoutConsumed: receipt.dataset.holdout_now_consumed,
  postHoldoutTuningAllowed: false,
  lockedMitbihAccessed: false,
}));
