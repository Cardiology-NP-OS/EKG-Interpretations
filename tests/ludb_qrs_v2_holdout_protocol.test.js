"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const protocol = require("../evaluation/protocols/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1.json");
const split = require("../evaluation/splits/LUDB_QRS_V2_DEV_V1_SPLIT.json");
const cohort = require("../validation/development/LUDB_QRS_V2_DEV_V1.json");
const initialTrainReceipt = require("../validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json");
const coverageTrainReceipt = require("../validation/development/results/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2_TRAIN_RECEIPT.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function sha256File(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

function runTarget(payload) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qrs-v2-holdout-protocol-"));
  const inputPath = path.join(tempRoot, "input.json");
  const outputPath = path.join(tempRoot, "output.json");
  fs.writeFileSync(inputPath, JSON.stringify(payload));
  const process = spawnSync("node", [path.join(root, protocol.evaluator.target_runner), inputPath, outputPath], {
    cwd: root,
    encoding: "utf8",
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return process;
}

test("holdout protocol freezes every detector evaluator matcher split runner and train-result identity", () => {
  for (const [relativePath, expected] of Object.entries(protocol.frozen_file_identities)) {
    assert.strictEqual(sha256File(relativePath), expected, relativePath);
  }
  assert.strictEqual(protocol.detector_code_under_test.implementation_or_parameter_change_after_train_result, false);
  assert.strictEqual(protocol.evaluator.semantics_changed_after_train_result, false);
  assert.strictEqual(protocol.matching.semantics_changed_after_train_result, false);
  assert.strictEqual(protocol.candidate_basis.train_aggregate_targets_met, true);
  assert.strictEqual(protocol.candidate_basis.train_catastrophic_record_count, 0);
});

test("prior holdout non-use is supported by all frozen machine-readable evidence", () => {
  assert.strictEqual(cohort.split.holdout_annotations_observed_before_freeze, false);
  assert.strictEqual(initialTrainReceipt.dataset.internal_holdout_annotations_parsed_or_scored, false);
  assert.strictEqual(coverageTrainReceipt.dataset.internal_holdout_annotations_parsed_or_scored, false);
  assert.match(protocol.prior_holdout_nonuse_proof.source_hash_verification_distinction, /NO HOLDOUT WFDB ANNOTATION LOADER CALL/);
  assert.match(protocol.prior_holdout_nonuse_proof.assertion, /UNOBSERVED/);
});

test("holdout target rejects train records and admits only frozen validation membership", () => {
  const rejected = runTarget({ recordId: "ludb/1.0.1/data/1" });
  assert.notStrictEqual(rejected.status, 0);
  assert.match(rejected.stderr, /QRS_V2_HOLDOUT_RECORD_NOT_IN_FROZEN_VALIDATION_SPLIT/);

  const admittedMembership = runTarget({
    recordId: `ludb/1.0.1/data/${split.validation_source_records[0]}`,
    sampleRateHz: 500,
    sampleCount: 5000,
    configurationId: protocol.detector_code_under_test.configuration_id,
  });
  assert.notStrictEqual(admittedMembership.status, 0);
  assert.match(admittedMembership.stderr, /QRS_V2_HOLDOUT_LEADS/);
  assert.doesNotMatch(admittedMembership.stderr, /RECORD_NOT_IN_FROZEN_VALIDATION_SPLIT/);
});

test("cohort runner is a one-shot exact 40-record holdout with no split override", () => {
  const runner = fs.readFileSync(path.join(root, protocol.evaluator.cohort_runner), "utf8");
  assert.strictEqual(protocol.executed_split, "validation");
  assert.strictEqual(protocol.executed_record_count, 40);
  assert.strictEqual(protocol.executed_record_count, split.validation_count);
  assert.strictEqual(protocol.holdout_authorized, true);
  assert.strictEqual(protocol.execution_policy.one_shot, true);
  assert.match(runner, /validation = list\(split\["validation_source_records"\]\)/);
  assert.match(runner, /for source_record in validation:/);
  assert.doesNotMatch(runner, /add_argument\("--split"/);
  assert.doesNotMatch(runner, /if record not in validation/);
  assert.match(runner, /LUDB_HOLDOUT_OUTPUT_ALREADY_EXISTS/);
  assert.match(runner, /LUDB_HOLDOUT_COMPARISON_ALREADY_EXISTS/);
});

test("holdout outcomes cannot authorize post-hoc tuning or clinical claims", () => {
  assert.strictEqual(protocol.change_policy.post_holdout_parameter_tuning, "PROHIBITED");
  assert.strictEqual(protocol.change_policy.post_holdout_evaluator_selection, "PROHIBITED");
  assert.match(protocol.change_policy.failed_outcome_response, /THIS HOLDOUT REMAINS SPENT/);
  assert.match(protocol.change_policy.passed_outcome_response, /WITHOUT CLAIMING CLINICAL VALIDITY/);
  assert.strictEqual(protocol.change_policy.locked_mitbih_access, "PROHIBITED");
  assert.strictEqual(protocol.change_policy.locked_v2_evaluation, "NOT_AUTHORIZED");
  assert.strictEqual(protocol.authority.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(protocol.authority.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(protocol.authority.metrics, "NOT_REPORTABLE");
  assert.strictEqual(protocol.authority.activation, "NOT_ELIGIBLE");
  assert.strictEqual(protocol.authority.clinical_validity_inferred, false);
  assert.strictEqual(protocol.locked_v2_readiness, "NOT_READY_FOR_LOCKED_V2_EVALUATION");
});

test("receipt paths and outside-Git record-level artifacts are predeclared", () => {
  assert.strictEqual(protocol.result_identity.result_id, "LUDB-QRS-V2-COVERAGE-V2-HOLDOUT-V1");
  assert.match(protocol.result_identity.compact_receipt_path, /HOLDOUT_V1_RECEIPT\.json$/);
  assert.match(protocol.result_identity.compact_comparison_path, /TRAIN_HOLDOUT_V1_COMPARISON\.json$/);
  assert.strictEqual(protocol.result_identity.record_level_artifacts_repository_storage, false);
  assert.strictEqual(fs.existsSync(path.join(root, protocol.result_identity.compact_receipt_path)), false);
  assert.strictEqual(fs.existsSync(path.join(root, protocol.result_identity.compact_comparison_path)), false);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-ludb-qrs-v2-holdout-protocol-tests-v1",
  pass: true,
  passed,
  total: passed,
  executedSplit: protocol.executed_split,
  recordCount: protocol.executed_record_count,
  oneShot: protocol.execution_policy.one_shot,
  priorHoldoutAnnotationsParsedOrScored: false,
  postHoldoutTuningAllowed: false,
  lockedMitbihAuthorized: false,
}));
