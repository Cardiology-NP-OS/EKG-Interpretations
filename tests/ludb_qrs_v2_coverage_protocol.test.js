"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const protocol = require("../evaluation/protocols/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2.json");
const historicalReceipt = require("../validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function sha256File(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

test("coverage protocol freezes detector config matcher evaluator dataset split runners and history", () => {
  for (const [relativePath, expected] of Object.entries(protocol.frozen_file_identities)) {
    assert.strictEqual(sha256File(relativePath), expected, relativePath);
  }
  assert.strictEqual(protocol.detector_code_under_test.detector_parameter_or_implementation_change_from_historical_result, false);
  assert.strictEqual(protocol.historical_relationship.rewrite_or_supersede_historical_result, false);
  assert.strictEqual(protocol.historical_relationship.historical_result_id, historicalReceipt.result_id);
});

test("coverage and matcher boundary semantics are fully predeclared", () => {
  assert.strictEqual(protocol.evaluator.start_boundary, "INCLUSIVE");
  assert.strictEqual(protocol.evaluator.end_boundary, "INCLUSIVE");
  assert.match(protocol.evaluator.prediction_before_first_reference, /^EXCLUDED /);
  assert.match(protocol.evaluator.prediction_after_last_reference, /^EXCLUDED /);
  assert.match(protocol.evaluator.matcher_tolerance_interaction, /BOUNDARY REFERENCE/);
  assert.strictEqual(protocol.evaluator.empty_annotations, "FAIL_CLOSED");
  assert.strictEqual(protocol.evaluator.malformed_or_nonmonotonic_annotations, "FAIL_CLOSED");
  assert.match(protocol.evaluator.single_reference_annotation, /^FAIL_CLOSED_/);
  assert.strictEqual(protocol.matching.tolerance_boundary, "INCLUSIVE");
  assert.strictEqual(protocol.matching.candidate_reuse, false);
});

test("cohort runner is train-only and exposes no split override", () => {
  const runner = fs.readFileSync(path.join(root, protocol.evaluator.cohort_runner), "utf8");
  assert.match(runner, /protocol\["executed_split"\] == "train"/);
  assert.match(runner, /protocol\["internal_holdout_authorized"\] is False/);
  assert.match(runner, /"internalHoldoutAnnotationsParsedOrScored": False/);
  assert.doesNotMatch(runner, /add_argument\("--split"/);
  assert.doesNotMatch(runner, /validation_source_records[^\n]+rdann/);
});

test("target runner rejects configuration substitution before detector execution", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qrs-v2-coverage-protocol-"));
  const inputPath = path.join(tempRoot, "input.json");
  const outputPath = path.join(tempRoot, "output.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    recordId: "ludb/1.0.1/data/1",
    sampleRateHz: 500,
    sampleCount: 5000,
    configurationId: "SUBSTITUTED-CONFIGURATION",
  }));
  const process = spawnSync("node", [path.join(root, protocol.evaluator.target_runner), inputPath, outputPath], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notStrictEqual(process.status, 0);
  assert.match(process.stderr, /QRS_V2_COVERAGE_CONFIGURATION/);
  assert.strictEqual(fs.existsSync(outputPath), false);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("holdout MIT-BIH and authority gates remain closed", () => {
  assert.strictEqual(protocol.executed_split, "train");
  assert.strictEqual(protocol.internal_holdout_authorized, false);
  assert.strictEqual(protocol.change_policy.holdout_access, "PROHIBITED");
  assert.match(protocol.change_policy.locked_mitbih_access, /^PROHIBITED/);
  assert.strictEqual(protocol.change_policy.locked_v2_evaluation, "NOT_AUTHORIZED");
  assert.strictEqual(protocol.authority.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(protocol.authority.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(protocol.authority.metrics, "NOT_REPORTABLE");
  assert.strictEqual(protocol.authority.activation, "NOT_ELIGIBLE");
  assert.strictEqual(protocol.authority.clinical_validity_inferred, false);
  assert.strictEqual(protocol.locked_v2_readiness, "NOT_READY_FOR_LOCKED_V2_EVALUATION");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-ludb-qrs-v2-coverage-protocol-tests-v2",
  pass: true,
  passed,
  total: passed,
  executedSplit: protocol.executed_split,
  holdoutAuthorized: protocol.internal_holdout_authorized,
  detectorChanged: false,
  historicalReceiptRewritten: false,
}));
