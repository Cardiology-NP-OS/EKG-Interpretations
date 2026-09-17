const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8").replace(/^\uFEFF/, ""));
const readText = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; };
const donorRegistry = readJson("ECG_DONOR_REGISTRY.json");
const capabilityRegistry = readJson("ECG_DONOR_CAPABILITY_REGISTRY.json");
const licenseLedger = readJson("ECG_LICENSE_LEDGER.json");
const datasetRegistry = readJson("ECG_DATASET_REGISTRY.json");
const modelRegistry = readJson("ECG_MODEL_CHALLENGER_REGISTRY.json");
const manifest = readJson("donors/alphanumericslab_ecg-image-kit/DONOR_MANIFEST.json");
const inventory = readJson("donors/alphanumericslab_ecg-image-kit/INVENTORY.json");
const gap = readJson("donors/alphanumericslab_ecg-image-kit/GAP_MATRIX.json");
const modelBoundary = readJson("donors/alphanumericslab_ecg-image-kit/MODEL_BOUNDARY.json");
const associated = readJson("donors/alphanumericslab_ecg-image-kit/ASSOCIATED_REPOSITORY_DISPOSITIONS.json");
const comparative = readJson("donors/alphanumericslab_ecg-image-kit/COMPARATIVE_PROOF.json");
const independent = readJson("donors/alphanumericslab_ecg-image-kit/INDEPENDENT_VERIFICATION.json");
const receipt = readJson("donors/alphanumericslab_ecg-image-kit/DONOR_RECEIPT.json");
const attribution = readText("ECG_ATTRIBUTION_LEDGER.md");
const pkg = readJson("package.json");
const donor = donorRegistry.donors.find(item => item.donor_id === "DONOR-005");
const caps = capabilityRegistry.capabilities.filter(item => item.donor === "alphanumericslab/ecg-image-kit");
const license = licenseLedger.entries.find(item => item.donor_id === "DONOR-005");
const allowed = new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);
check("upstream identity and complete inventory are pinned", () => {
  assert.strictEqual(manifest.audited_head.commit, "27b90f56896c9fc78b05a83ca14844ea2637aa0b");
  assert.strictEqual(manifest.audited_head.tree, "529bfe2cadae767c4851cc2be0fb194a25511674");
  assert.strictEqual(manifest.audited_head.latest_release_tag, "v1.0.0");
  assert.strictEqual(inventory.recursive_tree_audit.complete, true);
  assert.strictEqual(inventory.recursive_tree_audit.tracked_file_count, 346);
});
check("all material capabilities have terminal non-runtime dispositions", () => {
  assert.strictEqual(gap.rows.length, 33);
  assert.strictEqual(new Set(gap.rows.map(row => row.capability_id)).size, 33);
  assert.strictEqual(gap.disposition_summary.total, 33);
  for (const row of gap.rows) assert.ok(allowed.has(row.final_disposition), row.capability_id);
  assert.strictEqual(gap.rows.some(row => ["INTEGRATED","DEPENDENCY","ADAPTER"].includes(row.final_disposition)), false);
});
check("canonical capability registry matches gap matrix", () => {
  assert.strictEqual(caps.length, 33);
  assert.strictEqual(capabilityRegistry.capability_count, capabilityRegistry.capabilities.length);
  assert.ok(capabilityRegistry.capability_count >= 141);
  const byId = new Map(caps.map(item => [item.capability_id, item]));
  for (const row of gap.rows) assert.strictEqual(byId.get(row.capability_id).disposition, row.final_disposition);
  for (const item of caps.filter(item => item.disposition === "CHALLENGER")) {
    assert.strictEqual(item.challengers[0].execution_status, "NOT_EXECUTED_IN_TARGET");
    assert.strictEqual(item.challengers[0].runtime_authority, false);
  }
});
check("mixed software licensing remains explicit and no source is copied", () => {
  assert.strictEqual(license.source_code_license.spdx, "BSD-3-Clause");
  assert.ok(license.source_code_license.status.includes("MIXED_SUBTREE_LICENSES"));
  assert.strictEqual(license.source_code_license.subtree_licenses.length, 2);
  assert.ok(license.source_code_license.subtree_licenses.every(x => x.license === "GPL-3.0-text"));
  assert.strictEqual(license.copied_source_code, false);
});
check("tracked model artifacts remain ineligible and unregistered", () => {
  assert.strictEqual(modelBoundary.artifact_families.length, 2);
  assert.strictEqual(modelBoundary.weights_imported, false);
  assert.strictEqual(modelBoundary.clinical_validity, "NOT_INFERRED");
  assert.strictEqual(modelRegistry.models.some(item => item.donor_id === "DONOR-005"), false);
  assert.strictEqual(license.model_weight_license.status, "LICENSE_REVIEW_REQUIRED_PER_ARTIFACT");
  assert.strictEqual(license.model_weight_license.execution_eligible, false);
});
check("data fonts textures and labels remain fail closed and non-gold", () => {
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  const asset = datasetRegistry.datasets.find(item => item.introduced_by === "DONOR-005");
  assert.ok(asset && asset.status.includes("LICENSE_REVIEW_REQUIRED"));
  assert.strictEqual(manifest.dataset_license.raw_data_imported_into_target, false);
  assert.strictEqual(manifest.dataset_license.source_labels_promoted_to_project_gold, false);
  assert.strictEqual(license.dataset_license.fonts_or_textures_imported, false);
});
check("no runtime dependency or image digitizer is activated", () => {
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(Boolean(pkg.devDependencies && Object.keys(pkg.devDependencies).some(key => /tensorflow|opencv|yolo|wfdb|matlab|scispacy/i.test(key))), false);
  assert.strictEqual(donor.runtime_dependency_added, false);
  assert.strictEqual(donor.model_weights_imported, false);
  assert.strictEqual(donor.dataset_bytes_imported, false);
  assert.strictEqual(donor.clinical_authority_added, false);
});
check("unsafe remote scraping is rejected and digitization remains challenger-only", () => {
  const byId = new Map(gap.rows.map(row => [row.capability_id,row]));
  assert.strictEqual(byId.get("EIK-014").final_disposition, "REJECTED");
  assert.strictEqual(byId.get("EIK-022").final_disposition, "CHALLENGER");
  assert.strictEqual(byId.get("EIK-025").final_disposition, "LICENSE_REVIEW_REQUIRED");
});
check("associated provenance is explicit without queue expansion", () => {
  assert.strictEqual(associated.repositories.length, 3);
  for (const item of associated.repositories) assert.strictEqual(item.queued_as_associated_donor, false);
  assert.ok(associated.repositories.some(item => item.repository === "WongKinYiu/yolov7"));
  assert.ok(associated.repositories.some(item => item.repository === "Grzego/handwriting-generation"));
});
check("candidate verification evidence is exact and independent", () => {
  assert.strictEqual(donor.verified_candidate_commit, "f795148bf88c31304c5b58f4fb5136a4e2a4fcd6");
  assert.strictEqual(donor.verified_candidate_tree, "baa08a42b91b06f75cf101c17dbb4b9ec13e9319");
  assert.strictEqual(donor.candidate_ci_run_id, 35187787185);
  assert.strictEqual(comparative.verification.head_sha, donor.verified_candidate_commit);
  assert.strictEqual(comparative.verification.conclusion, "success");
  assert.strictEqual(independent.candidate_commit, donor.verified_candidate_commit);
  assert.strictEqual(independent.result, "PASS");
  assert.strictEqual(independent.full_target_suite, "PASS");
});
check("donor is accepted only after promotion and target-main CI", () => {
  assert.ok(donorRegistry.completed_donors >= 5);
  assert.notStrictEqual(donorRegistry.next_donor_id, "DONOR-005");
  assert.strictEqual(donor.status, "ACCEPTED_ON_MAIN");
  assert.strictEqual(donor.receipt_status, "FINALIZED");
  assert.strictEqual(donor.receipt, "donors/alphanumericslab_ecg-image-kit/DONOR_RECEIPT.json");
  assert.strictEqual(donor.promotion_commit, "569f2a5747cff5bac38ca22ed88fac5fb2ed713e");
  assert.strictEqual(donor.target_main_ci_run_id, 35187896259);
  assert.strictEqual(donor.target_main_ci_conclusion, "success");
  assert.strictEqual(receipt.acceptance_state, "ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
  assert.strictEqual(receipt.promotion.merge_commit, donor.promotion_commit);
  assert.strictEqual(receipt.promotion.target_main_ci_run_id, donor.target_main_ci_run_id);
});
check("governed inactive state and attribution remain explicit", () => {
  assert.strictEqual(gap.clinical_authority_added, false);
  assert.strictEqual(capabilityRegistry.clinical_authority_added, false);
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  const state = receipt.governed_state_after;
  assert.strictEqual(state.completion_state, "SPECIALIST_COMPLETE_INACTIVE");
  assert.strictEqual(state.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(state.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(state.approved_adjudicated_gold_count, 0);
  assert.strictEqual(state.metrics, "NOT_REPORTABLE");
  assert.strictEqual(state.activation, "NOT_ELIGIBLE");
  assert.strictEqual(state.clinical_validity, "NOT_INFERRED");
  assert.ok(attribution.includes("## DONOR-005 -- alphanumericslab/ecg-image-kit"));
  assert.ok(attribution.includes("Donor checkpoint/model weights copied or executed: **no**"));
  assert.ok(attribution.includes("Source labels promoted to project clinical gold: **no**"));
  assert.ok(attribution.includes("`DONOR_RECEIPT.json`"));
});
console.log(JSON.stringify({schema:"ekg-donor-005-acceptance-closure-tests-v1",donor:"alphanumericslab/ecg-image-kit",pass:true,passed,total:passed,completed_donors:donorRegistry.completed_donors,next_donor_id:donorRegistry.next_donor_id,receipt_finalized:true,diagnostic_runtime:"GOVERNED_INACTIVE",evidence_admission:"NOT_ADMITTED",approved_adjudicated_gold_count:datasetRegistry.approved_adjudicated_project_gold_count,metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinical_validity:"NOT_INFERRED",clinical_authority_added:false}));
