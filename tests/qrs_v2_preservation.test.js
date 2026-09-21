"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DEFAULT_QRS_V2_CONFIG, QRS_V2_ALGORITHM } = require("../lib/qrs_detector_v2");
const config = require("../evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json");
const checkpoint = require("../manifests/QRS_DETECTOR_V2_ENGINEERING_CHECKPOINT_V1.json");

const root = path.join(__dirname, "..");
const frozenV1 = Object.freeze({
  "lib/signal_measurement_contract.js": "78a20eb8682883c8b91efeb4a26d920981d2d7d8d935d89122f77bf2d634592a",
  "validation/clinical_accuracy/MITBIH_RPEAK_FULL_V1.json": "6af59c2cebd1899ef12e493e0e5ec76e19af0c53743f1d490c485fc54caeb826",
  "validation/clinical_accuracy/results/MITBIH_RPEAK_FULL_V1_RECEIPT.json": "08dc1f4be4b51a05b29e4c22791ed0c9cd7e4d6cb1d138f143a7d23c4ff6c84a",
  "validation/clinical_accuracy/run_mitbih_rpeak_full.py": "3c756340e54e013e5a4a0698c5f87a559d662783a5b4f6a8612c204f94c0f9eb",
  "validation/clinical_accuracy/run_target_rpeak.js": "468e7618f011e19ea5c168bcc525b5c677fef8d036dbc6301abd27873a39e95b"
});

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

test("locked V1 detector protocol runner and receipt remain byte-identical", () => {
  for (const [relativePath, expected] of Object.entries(frozenV1)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
    assert.strictEqual(actual, expected, relativePath);
  }
});

test("V2 defaults are bound to the frozen synthetic-development configuration", () => {
  assert.strictEqual(config.algorithm, QRS_V2_ALGORITHM);
  assert.deepStrictEqual(DEFAULT_QRS_V2_CONFIG, config.detector);
  assert.strictEqual(config.locked_evaluation_authorized, false);
  assert.match(config.state, /NOT_LOCKED_EVALUATION/);
});

test("development cohort excludes locked MIT-BIH signals and annotations", () => {
  const cohort = require("../validation/development/QRS_V2_SYNTHETIC_DEV_V1.json");
  assert.strictEqual(cohort.relationship_to_locked_evaluation.contains_locked_record_ids, false);
  assert.strictEqual(cohort.relationship_to_locked_evaluation.contains_locked_signal_bytes, false);
  assert.strictEqual(cohort.relationship_to_locked_evaluation.contains_locked_annotations, false);
  assert.strictEqual(cohort.source.project_gold, false);
  assert.match(cohort.external_development_corpus_gate.state, /^BLOCKED_/);
});

test("engineering checkpoint remains fail-closed for locked V2 evaluation", () => {
  assert.strictEqual(checkpoint.detector_code_under_test.algorithm, QRS_V2_ALGORITHM);
  assert.strictEqual(checkpoint.detector_code_under_test.configuration_id, config.configuration_id);
  assert.strictEqual(checkpoint.verification.github_actions.head_sha, checkpoint.detector_code_under_test.commit);
  assert.strictEqual(checkpoint.verification.github_actions.conclusion, "success");
  assert.strictEqual(checkpoint.development_evidence.synthetic_only, true);
  assert.strictEqual(checkpoint.frozen_v1_preservation.locked_cohort_used_for_v2_parameter_selection, false);
  assert.strictEqual(checkpoint.frozen_v1_preservation.locked_v2_evaluation_executed, false);
  assert.match(checkpoint.real_signal_development_gate.state, /^BLOCKED_/);
  assert.strictEqual(checkpoint.governance.runtime_authority, false);
  assert.strictEqual(checkpoint.governance.clinical_validity_inferred, false);
  assert.strictEqual(checkpoint.locked_v2_readiness, "NOT_READY_FOR_LOCKED_V2_EVALUATION");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-qrs-v2-preservation-tests-v1",
  pass: true,
  passed,
  total: passed,
  frozenV1Files: Object.keys(frozenV1).length,
  lockedV2EvaluationAuthorized: false
}));
