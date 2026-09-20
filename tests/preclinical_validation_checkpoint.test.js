"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

const checkpoint = read("ECG_PRECLINICAL_VALIDATION_CHECKPOINT.json");
const donors = read("ECG_DONOR_REGISTRY.json");
const image = read("ECG_IMAGE_INTAKE_CHECKPOINT.json");
const receipt = read("donors/heartwise-ai_ecg-tokenizer/DONOR_RECEIPT.json");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + ": " + (error.stack || error));
    process.exitCode = 1;
  }
}

test("checkpoint binds the exact promoted engineering baseline", () => {
  assert.strictEqual(
    checkpoint.promoted_engineering_basis.commit,
    "de7e13a28c502fa5e1ced202a888ee66a44db700"
  );
  assert.strictEqual(
    checkpoint.promoted_engineering_basis.tree,
    "75d8f4d894280ef381d495cb79d8902a7f11bc69"
  );
  assert.strictEqual(checkpoint.promoted_engineering_basis.post_merge_ci_run_id, 35541158296);
  assert.strictEqual(checkpoint.promoted_engineering_basis.post_merge_ci_conclusion, "success");
});

test("DONOR-014 is finalized and the donor frontier advances exactly once", () => {
  const d14 = donors.donors.find(d => d.donor_id === "DONOR-014");
  assert.ok(d14);
  assert.strictEqual(d14.status, "ACCEPTED_ON_MAIN");
  assert.strictEqual(d14.receipt_status, "FINALIZED");
  assert.strictEqual(d14.promotion_commit, checkpoint.promoted_engineering_basis.commit);
  assert.strictEqual(d14.promotion_tree, checkpoint.promoted_engineering_basis.tree);
  assert.strictEqual(donors.completed_donors, 14);
  assert.strictEqual(donors.next_donor_id, "DONOR-015");
  assert.strictEqual(checkpoint.integrated_state.primary_donors_completed, 14);
  assert.strictEqual(checkpoint.integrated_state.next_primary_donor, "DONOR-015");
});

test("DONOR-014 final receipt binds post-promotion CI", () => {
  assert.strictEqual(receipt.acceptance_state, "ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
  assert.strictEqual(receipt.promotion.commit, checkpoint.promoted_engineering_basis.commit);
  assert.strictEqual(receipt.promotion.tree, checkpoint.promoted_engineering_basis.tree);
  assert.strictEqual(receipt.promotion.target_main_ci_run_id, 35541158296);
  assert.strictEqual(receipt.promotion.target_main_ci_conclusion, "success");
  assert.strictEqual(receipt.boundaries.clinical_authority_added, false);
});

test("image engineering stack is integrated but real clinical image validation is not established", () => {
  const p = image.proofBoundary;
  assert.strictEqual(p.jpegFullChainThroughImmutableAnalysisVerified, true);
  assert.strictEqual(p.automaticPerspectiveCornerDetectionImplemented, true);
  assert.strictEqual(p.automaticLeadIdentityVerificationImplemented, true);
  assert.strictEqual(p.traceBaselineEstimationImplemented, true);
  assert.strictEqual(p.simultaneousLeadComparisonPerformed, true);
  assert.strictEqual(p.realClinicalImageValidationEstablished, false);
  assert.strictEqual(p.realClinicalVoltageAccuracyEstablished, false);
  assert.strictEqual(p.clinicalPerformanceClaimed, false);
  assert.strictEqual(p.clinicalValidityInferred, false);
});

test("preclinical checkpoint cannot silently claim clinical validity or reportable metrics", () => {
  const s = checkpoint.clinical_validation_state;
  assert.strictEqual(s.clinical_accuracy_testing_started, false);
  assert.strictEqual(s.clinical_accuracy_claimed, false);
  assert.strictEqual(s.clinical_validity_inferred, false);
  assert.strictEqual(s.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(s.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(s.approved_adjudicated_gold_count, 0);
  assert.strictEqual(s.metrics, "NOT_REPORTABLE");
  assert.strictEqual(s.activation, "NOT_ELIGIBLE");
});

test("validation entry requirements preserve test-set and evidence discipline", () => {
  const req = checkpoint.clinical_accuracy_entry_requirements;
  assert.ok(req.some(x => /Freeze the evaluated target commit\/tree/.test(x)));
  assert.ok(req.some(x => /patient leakage/i.test(x)));
  assert.ok(req.some(x => /before looking at final test results/i.test(x)));
  assert.ok(req.some(x => /confidence intervals/i.test(x)));
  assert.ok(req.some(x => /failure\/abstention/i.test(x)));
  assert.ok(req.some(x => /nonruntime and nonreportable/i.test(x)));
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-preclinical-validation-checkpoint-tests-v1",
  pass: true,
  passed,
  total: passed,
  clinicalAccuracyClaimed: false,
  metrics: checkpoint.clinical_validation_state.metrics,
  diagnosticRuntime: checkpoint.clinical_validation_state.diagnostic_runtime
}));
