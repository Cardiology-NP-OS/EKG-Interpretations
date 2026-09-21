"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const cohort = require("../validation/development/LUDB_QRS_V2_DEV_V1.json");
const split = require("../evaluation/splits/LUDB_QRS_V2_DEV_V1_SPLIT.json");
const protocol = require("../evaluation/protocols/LUDB_QRS_V2_DEVELOPMENT_V1.json");
const configuration = require("../evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function rankedSourceRecords() {
  return Array.from({ length: 200 }, (unused, index) => String(index + 1)).sort((left, right) => {
    const leftHash = crypto.createHash("sha256").update(`LUDB-1.0.1:${left}`).digest("hex");
    const rightHash = crypto.createHash("sha256").update(`LUDB-1.0.1:${right}`).digest("hex");
    return leftHash.localeCompare(rightHash) || Number(left) - Number(right);
  });
}

test("LUDB identity and license review are exact and development-only", () => {
  assert.strictEqual(cohort.dataset.dataset_id, "ECG-DATASET-LUDB");
  assert.strictEqual(cohort.dataset.version, "1.0.1");
  assert.strictEqual(cohort.dataset.license, "Open Data Commons Attribution License v1.0");
  assert.strictEqual(cohort.dataset.license_review.status, "INDEPENDENTLY_VERIFIED_FOR_NONCLINICAL_DEVELOPMENT_USE");
  assert.strictEqual(cohort.dataset.license_review.redistribution_in_repository, false);
  assert.match(cohort.source_identity.source_sha256_manifest_sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(cohort.source_identity.source_files_verified, 2805);
  assert.strictEqual(cohort.source_identity.source_files_failed_verification, 0);
  assert.strictEqual(cohort.authority.project_gold, false);
  assert.strictEqual(cohort.authority.clinical_validity_inferred, false);
});

test("LUDB split is deterministic patient-disjoint and contamination-aware", () => {
  const ranked = rankedSourceRecords();
  const expectedTrain = new Set(ranked.slice(0, 160));
  expectedTrain.add("1");
  expectedTrain.delete("8");
  const expectedValidation = Array.from({ length: 200 }, (unused, index) => String(index + 1))
    .filter(record => !expectedTrain.has(record));
  assert.deepStrictEqual(split.validation_source_records, expectedValidation);
  assert.strictEqual(expectedTrain.size, split.train_count);
  assert.strictEqual(expectedValidation.length, split.validation_count);
  assert.ok(expectedTrain.has("1"));
  assert.ok(expectedValidation.includes("8"));
  const trainPatients = new Set([...expectedTrain].map(record => `ludb/1.0.1/subject/${record}`));
  const validationPatients = new Set(expectedValidation.map(record => `ludb/1.0.1/subject/${record}`));
  assert.strictEqual([...trainPatients].some(patient => validationPatients.has(patient)), false);
});

test("development protocol cannot access the LUDB holdout or locked MIT-BIH cohort", () => {
  assert.strictEqual(protocol.executed_split, "train");
  assert.strictEqual(protocol.internal_holdout_authorized, false);
  assert.strictEqual(protocol.detector_code_under_test.configuration_id, configuration.configuration_id);
  assert.strictEqual(protocol.matching.protocol, "RPEAK-EVENT-MATCHER-V2");
  assert.strictEqual(protocol.matching.candidate_reuse, false);
  assert.strictEqual(protocol.change_policy.locked_v2_evaluation, "NOT_AUTHORIZED");
  assert.strictEqual(cohort.relationship_to_locked_evaluation.contains_locked_signal_bytes, false);
  assert.strictEqual(cohort.relationship_to_locked_evaluation.contains_locked_annotations, false);
  assert.strictEqual(cohort.relationship_to_locked_evaluation.contains_qtdb_or_other_mitbih_derived_excerpts, false);
  assert.ok(cohort.exclusions.some(value => value.startsWith("QTDB 1.0.0")));
});

test("real-signal runner is hard-bound to train and records holdout non-use", () => {
  const runner = fs.readFileSync(path.join(__dirname, "../validation/development/run_ludb_qrs_v2_dev.py"), "utf8");
  assert.match(runner, /protocol\["executed_split"\] == "train"/);
  assert.match(runner, /protocol\["internal_holdout_authorized"\] is False/);
  assert.match(runner, /"internalHoldoutAnnotationsParsedOrScored": False/);
  assert.doesNotMatch(runner, /add_argument\("--split"/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-ludb-qrs-v2-development-contract-tests-v1",
  pass: true,
  passed,
  total: passed,
  trainRecords: split.train_count,
  holdoutRecords: split.validation_count,
  holdoutAuthorized: protocol.internal_holdout_authorized,
  lockedMitbihUsed: false,
  clinicalAuthorityAdded: false,
}));
