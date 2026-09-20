"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), "utf8").replace(/^\uFEFF/, ""));

const checkpoint = read("manifests/PRECLINICAL_VALIDATION_CHECKPOINT_V1.json");
const donors = read("ECG_DONOR_REGISTRY.json");
const datasets = read("ECG_DATASET_REGISTRY.json");
const image = read("ECG_IMAGE_INTAKE_CHECKPOINT.json");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("PASS " + name);
}

test("checkpoint binds exact code-under-test identity", () => {
  assert.strictEqual(checkpoint.checkpoint_id, "PRECLINICAL-V1-2026-09-20");
  assert.strictEqual(checkpoint.checkpoint_ref, "checkpoint/preclinical-validation-v1");
  assert.strictEqual(checkpoint.code_under_test.commit, "32e74373523512c3fcf3921fcb8e2501b8ea2bbb");
  assert.strictEqual(checkpoint.code_under_test.tree, "8134669d78b125adbca7d68c3e1f52c7fce63603");
  assert.strictEqual(checkpoint.code_under_test.immutable_for_validation, true);
});

test("checkpoint donor frontier matches live registry", () => {
  assert.strictEqual(checkpoint.integration_state.donor_program.completed_primary_donors, donors.completed_donors);
  assert.strictEqual(checkpoint.integration_state.donor_program.required_primary_donors, donors.required_donor_count);
  assert.strictEqual(checkpoint.integration_state.donor_program.next_primary_donor_id, donors.next_donor_id);
  assert.strictEqual(donors.completed_donors, 14);
  assert.strictEqual(donors.next_donor_id, "DONOR-015");
  const next = donors.donors.find(row => row.donor_id === donors.next_donor_id);
  assert.ok(next);
  assert.strictEqual(next.repository, checkpoint.integration_state.donor_program.next_primary_donor_repository);
});

test("checkpoint image claims are supported by governed image checkpoint", () => {
  const b = image.proofBoundary;
  assert.strictEqual(checkpoint.integration_state.image_path.png_jpeg_pdf_decode, true);
  assert.strictEqual(b.jpegSupported, true);
  assert.strictEqual(b.pdfSupported, true);
  assert.strictEqual(b.externalInputPreflightMandatory, true);
  assert.strictEqual(b.perspectiveCorrectionImplemented, true);
  assert.strictEqual(b.automaticPerspectiveCornerDetectionImplemented, true);
  assert.strictEqual(b.continuousDeskewImplemented, true);
  assert.strictEqual(b.automaticLeadIdentityVerificationImplemented, true);
  assert.strictEqual(b.traceBaselineEstimationImplemented, true);
  assert.strictEqual(b.immutableExtractionGenerationsImplemented, true);
  assert.strictEqual(b.immutableAnalysisGenerationsImplemented, true);
  assert.strictEqual(b.wholeRecordCrossLeadAggregationPerformed, true);
  assert.strictEqual(b.simultaneousLeadComparisonPerformed, true);
  assert.strictEqual(b.realClinicalImageValidationEstablished, false);
  assert.strictEqual(b.realClinicalVoltageAccuracyEstablished, false);
});

test("checkpoint gold and authority state match registries", () => {
  const state = donors.governed_clinical_state;
  assert.strictEqual(datasets.approved_adjudicated_project_gold_count, 0);
  assert.strictEqual(checkpoint.dataset_state.approved_adjudicated_project_gold_count, 0);
  assert.strictEqual(checkpoint.dataset_state.source_labels_are_project_gold, false);
  assert.strictEqual(checkpoint.dataset_state.model_predictions_are_project_gold, false);
  assert.deepStrictEqual(checkpoint.governed_clinical_state, state);
  assert.strictEqual(state.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(state.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(state.metrics, "NOT_REPORTABLE");
  assert.strictEqual(state.activation, "NOT_ELIGIBLE");
  assert.strictEqual(state.clinical_validity, "NOT_INFERRED");
});

test("checkpoint verification binds exact successful main CI", () => {
  assert.strictEqual(checkpoint.verification.exact_main_ci_run_id, 35542645087);
  assert.strictEqual(checkpoint.verification.conclusion, "success");
  assert.strictEqual(checkpoint.verification.jobs.length, 3);
  assert.ok(checkpoint.verification.jobs.every(job => job.conclusion === "success"));
});

test("clinical validation transition remains quarantined", () => {
  const v = checkpoint.validation_transition;
  assert.strictEqual(v.status, "READY_TO_BEGIN_QUARANTINED_VALIDATION");
  assert.strictEqual(v.metrics_may_be_computed_in_validation_workspace, true);
  assert.strictEqual(v.metrics_may_be_promoted_to_reportable_clinical_metrics, false);
  assert.strictEqual(v.runtime_activation_authorized, false);
  assert.strictEqual(v.project_gold_creation_authorized, false);
});

console.log(JSON.stringify({
  schema:"ekg-preclinical-validation-checkpoint-tests-v1",
  pass:true,
  passed,
  total:passed,
  clinicalAuthorityAdded:false
}));
