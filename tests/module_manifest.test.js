"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const recovered = JSON.parse(fs.readFileSync(path.join(root, "manifests", "V12_RECOVERED_BASELINE.json"), "utf8"));
const preclinical = JSON.parse(fs.readFileSync(path.join(root, "manifests", "PRECLINICAL_VALIDATION_CHECKPOINT_V1.json"), "utf8"));

assert.deepStrictEqual(Object.keys(manifest), ["schema", "module_id", "label", "version", "capabilities", "safety"]);
assert.strictEqual(manifest.schema, "cardiology-module-manifest-v1");
assert.strictEqual(manifest.module_id, "ekg");
assert.strictEqual(manifest.label, "EKG Interpretations");
assert.strictEqual(manifest.version, pkg.version);
assert.ok(Array.isArray(manifest.capabilities) && manifest.capabilities.length >= 16);
assert.strictEqual(new Set(manifest.capabilities).size, manifest.capabilities.length);

const expectedCapabilities = [
  "photo_pdf_ecg_intake",
  "grid_calibration",
  "trace_digitization",
  "per_lead_signal_analysis",
  "multilead_review",
  "immutable_analysis_storage",
  "non_diagnostic_specialist_provider",
  "clinician_review_report",
  "six_axis_review_score",
  "two_reviewer_session",
  "clinician_review_bundle",
  "append_only_clinician_correction",
  "structured_clinician_reader_model",
  "provider_clinician_correction_append",
];
for (const capability of expectedCapabilities) assert.ok(manifest.capabilities.includes(capability), capability);

assert.strictEqual(manifest.safety.requires_source_provenance, true);
for (const [key, value] of Object.entries(manifest.safety)) {
  if (key === "requires_source_provenance") continue;
  assert.strictEqual(value, false, key);
}
assert.strictEqual(manifest.safety.clinical_accuracy_claimed, recovered.clinical_accuracy_claimed);
assert.strictEqual(manifest.safety.real_clinical_image_validation_established, preclinical.integration_state.image_path.real_clinical_image_validation_established);
assert.strictEqual(preclinical.governed_clinical_state.diagnostic_runtime, "GOVERNED_INACTIVE");
assert.strictEqual(preclinical.governed_clinical_state.evidence_admission, "NOT_ADMITTED");
assert.strictEqual(preclinical.governed_clinical_state.metrics, "NOT_REPORTABLE");
assert.strictEqual(preclinical.governed_clinical_state.approved_adjudicated_gold_count, 0);

const intake = require("../lib/image_intake_pipeline");
const analysis = require("../lib/image_analysis_store");
const corrections = require("../lib/clinician_correction_store");
const bundle = require("../lib/clinician_review_bundle");
const provider = require("../tools/specialist_provider");
const reader = require("../lib/clinician_reader_model");

assert.strictEqual(typeof intake.runImageIntakePipeline, "function");
assert.strictEqual(typeof analysis.persistImageAnalysis, "function");
assert.strictEqual(typeof analysis.readImageAnalysis, "function");
assert.strictEqual(typeof corrections.persistClinicianCorrection, "function");
assert.strictEqual(typeof corrections.readClinicianCorrection, "function");
assert.strictEqual(typeof bundle.persistClinicianReviewBundle, "function");
assert.strictEqual(typeof bundle.readClinicianReviewBundle, "function");
assert.strictEqual(typeof provider.dispatch, "function");
assert.strictEqual(typeof provider.status, "function");
assert.strictEqual(typeof reader.buildClinicianReaderModel, "function");

const status = provider.status();
assert.strictEqual(status.diagnosticRuntime, "GOVERNED_INACTIVE");
assert.strictEqual(status.evidenceAdmission, "NOT_ADMITTED");
assert.strictEqual(status.metrics, "NOT_REPORTABLE");
assert.strictEqual(status.clinicalValidityInferred, false);
assert.strictEqual(status.runtimeAuthority, false);
assert.strictEqual(status.projectGold, false);
assert.strictEqual(status.clinicalAuthorityAdded, false);
assert.match(status.disclaimer, /not clinically validated/i);

console.log(JSON.stringify({
  suite: "ROOT_MODULE_MANIFEST",
  pass: true,
  capabilities: manifest.capabilities.length,
  clinical_accuracy_claimed: false,
  diagnostic_runtime_active: false,
  evidence_admitted: false
}));
