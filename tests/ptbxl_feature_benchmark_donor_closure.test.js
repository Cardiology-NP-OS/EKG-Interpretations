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
const manifest = readJson("donors/tmehari_ptbxl_feature_benchmark/DONOR_MANIFEST.json");
const inventory = readJson("donors/tmehari_ptbxl_feature_benchmark/INVENTORY.json");
const gap = readJson("donors/tmehari_ptbxl_feature_benchmark/GAP_MATRIX.json");
const licenseBoundary = readJson("donors/tmehari_ptbxl_feature_benchmark/LICENSE_BOUNDARY.json");
const datasetBoundary = readJson("donors/tmehari_ptbxl_feature_benchmark/DATASET_BOUNDARY.json");
const modelBoundary = readJson("donors/tmehari_ptbxl_feature_benchmark/MODEL_BOUNDARY.json");
const associated = readJson("donors/tmehari_ptbxl_feature_benchmark/ASSOCIATED_REPOSITORY_DISPOSITIONS.json");
const comparative = readJson("donors/tmehari_ptbxl_feature_benchmark/COMPARATIVE_PROOF.json");
const independent = readJson("donors/tmehari_ptbxl_feature_benchmark/INDEPENDENT_VERIFICATION.json");
const receipt = readJson("donors/tmehari_ptbxl_feature_benchmark/DONOR_RECEIPT.json");
const attribution = readText("ECG_ATTRIBUTION_LEDGER.md");
const pkg = readJson("package.json");
const donor = donorRegistry.donors.find(item => item.donor_id === "DONOR-006");
const caps = capabilityRegistry.capabilities.filter(item => item.donor === "tmehari/ptbxl_feature_benchmark");
const license = licenseLedger.entries.find(item => item.donor_id === "DONOR-006");
const allowed = new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);
check("upstream identity and complete 20-file inventory are pinned", () => {
  assert.strictEqual(manifest.audited_head.commit, "4c37b775e56d23e2c844fcd0aec52d2cd05cb35e");
  assert.strictEqual(manifest.audited_head.tree, "b9be6b9546e2b437493b286532ffbbba00e01a8c");
  assert.strictEqual(inventory.recursive_tree_audit.complete, true);
  assert.strictEqual(inventory.recursive_tree_audit.tracked_file_count, 20);
});
check("all 36 material capabilities have terminal non-runtime dispositions", () => {
  assert.strictEqual(gap.rows.length, 36);
  assert.strictEqual(new Set(gap.rows.map(row => row.capability_id)).size, 36);
  assert.strictEqual(gap.disposition_summary.total, 36);
  for (const row of gap.rows) assert.ok(allowed.has(row.final_disposition), row.capability_id);
  assert.strictEqual(gap.rows.some(row => ["INTEGRATED","DEPENDENCY","ADAPTER"].includes(row.final_disposition)), false);
  assert.strictEqual(gap.implementation_decision, "GOVERNANCE_ONLY_NO_RUNTIME_IMPLEMENTATION");
});
check("canonical capability registry matches the gap matrix", () => {
  assert.strictEqual(caps.length, 36);
  assert.strictEqual(capabilityRegistry.capability_count, capabilityRegistry.capabilities.length);
  assert.strictEqual(capabilityRegistry.capability_count, 177);
  const byId = new Map(caps.map(item => [item.capability_id, item]));
  for (const row of gap.rows) assert.strictEqual(byId.get(row.capability_id).disposition, row.final_disposition);
  const challenger = byId.get("PTBXLFB-022");
  assert.strictEqual(challenger.challengers[0].runtime_authority, false);
  assert.ok(challenger.challengers[0].execution_status.includes("NOT_EXECUTABLE"));
});
check("audited-head source licensing fails closed while historical MIT is not inherited", () => {
  assert.strictEqual(licenseBoundary.audited_head.license_file_present, false);
  assert.strictEqual(licenseBoundary.audited_head.reuse_status, "LICENSE_REVIEW_REQUIRED");
  assert.strictEqual(licenseBoundary.historical_release.spdx, "MIT");
  assert.strictEqual(licenseBoundary.historical_release.historical_license_not_inherited_to_audited_head, true);
  assert.strictEqual(license.source_code_license.spdx, null);
  assert.strictEqual(license.copied_source_code, false);
});
check("PTB-XL plus external assets and notebook outputs remain non-gold and quarantined", () => {
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  assert.strictEqual(datasetRegistry.datasets.filter(item => item.name === "PTB-XL").length, 1);
  const asset = datasetRegistry.datasets.find(item => item.introduced_by === "DONOR-006");
  assert.ok(asset && asset.status.includes("LICENSE_REVIEW_REQUIRED"));
  assert.strictEqual(datasetBoundary.approved_adjudicated_project_gold_added, 0);
  assert.strictEqual(inventory.data_assets.notebook_embedded_outputs_present, true);
  assert.strictEqual(inventory.data_assets.notebook_embedded_output_count, 116);
  assert.strictEqual(inventory.data_assets.target_import_allowed, false);
});
check("model and checkpoint execution remain ineligible and unregistered", () => {
  assert.strictEqual(modelBoundary.artifact_families.length, 2);
  assert.strictEqual(modelBoundary.weights_imported, false);
  assert.strictEqual(modelBoundary.clinical_validity, "NOT_INFERRED");
  assert.strictEqual(modelRegistry.models.some(item => item.donor_id === "DONOR-006" || item.donor === "tmehari/ptbxl_feature_benchmark"), false);
  assert.strictEqual(license.model_weight_license.tracked_weights_found, false);
  assert.strictEqual(license.model_weight_license.execution_eligible, false);
});
check("no donor runtime dependency source data or model artifact is activated", () => {
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(Boolean(pkg.devDependencies && Object.keys(pkg.devDependencies).some(key => /torch|sklearn|pytorch|lightning|wfdb|conda/i.test(key))), false);
  assert.strictEqual(donor.runtime_dependency_added, false);
  assert.strictEqual(donor.source_code_copied, false);
  assert.strictEqual(donor.model_weights_imported, false);
  assert.strictEqual(donor.dataset_bytes_imported, false);
  assert.strictEqual(donor.clinical_authority_added, false);
});
check("known benchmark and deserialization defects remain rejected", () => {
  const byId = new Map(gap.rows.map(row => [row.capability_id, row]));
  for (const id of ["PTBXLFB-019","PTBXLFB-020","PTBXLFB-021","PTBXLFB-024"]) assert.strictEqual(byId.get(id).final_disposition, "REJECTED");
});
check("associated provenance is explicit without queue expansion", () => {
  assert.strictEqual(associated.repositories.length, 3);
  for (const item of associated.repositories) assert.strictEqual(item.queued_as_associated_donor, false);
  assert.strictEqual(associated.external_non_repository_lineage[0].disposition, "LICENSE_REVIEW_REQUIRED");
});
check("candidate CI and independent verification are bound", () => {
  assert.strictEqual(donor.verified_candidate_commit, "321fcd2448f8fda8b3599793e40b5803aba7fd92");
  assert.strictEqual(donor.verified_candidate_tree, "d4f326b28cf2f00f3a8ae0771793d42e7b52064c");
  assert.strictEqual(donor.candidate_ci_run_id, 35197265071);
  assert.strictEqual(comparative.verification.head_sha, donor.verified_candidate_commit);
  assert.strictEqual(comparative.verification.conclusion, "success");
  assert.strictEqual(independent.candidate_commit, donor.verified_candidate_commit);
  assert.strictEqual(independent.result, "PASS");
  assert.strictEqual(independent.full_target_suite, "PASS");
});
check("donor is accepted only after promotion and target-main CI", () => {
  assert.strictEqual(donorRegistry.completed_donors, 6);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-007");
  assert.strictEqual(donor.status, "ACCEPTED_ON_MAIN");
  assert.strictEqual(donor.receipt_status, "FINALIZED");
  assert.strictEqual(donor.receipt, "donors/tmehari_ptbxl_feature_benchmark/DONOR_RECEIPT.json");
  assert.strictEqual(donor.promotion_commit, "fdb1eef6dee4772b235b167de6e52e026bba34e3");
  assert.strictEqual(donor.target_main_ci_run_id, 35197432536);
  assert.strictEqual(donor.target_main_ci_conclusion, "success");
  assert.strictEqual(receipt.acceptance_state, "ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
  assert.strictEqual(receipt.promotion.merge_commit, donor.promotion_commit);
  assert.strictEqual(receipt.promotion.target_main_ci_run_id, donor.target_main_ci_run_id);
});
check("donor directory contains governance artifacts only", () => {
  const names = fs.readdirSync(path.join(root, "donors/tmehari_ptbxl_feature_benchmark"));
  assert.strictEqual(names.some(name => /\.(py|ipynb|pkl|pt|pth|ckpt|npy|npz|csv)$/i.test(name)), false);
});
check("governed inactive state and attribution remain explicit", () => {
  assert.strictEqual(gap.clinical_authority_added, false);
  assert.strictEqual(capabilityRegistry.clinical_authority_added, false);
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  assert.ok(attribution.includes("## DONOR-006 -- tmehari/ptbxl_feature_benchmark"));
  assert.ok(attribution.includes("Audited-head software license: **LICENSE_REVIEW_REQUIRED**"));
  assert.ok(attribution.includes("Source labels promoted to project clinical gold: **no**"));
  assert.ok(attribution.includes("`DONOR_RECEIPT.json`"));
});
console.log(JSON.stringify({schema:"ekg-donor-006-acceptance-closure-tests-v1",donor:"tmehari/ptbxl_feature_benchmark",pass:true,passed,total:passed,completed_donors:donorRegistry.completed_donors,next_donor_id:donorRegistry.next_donor_id,receipt_finalized:true,diagnostic_runtime:"GOVERNED_INACTIVE",evidence_admission:"NOT_ADMITTED",approved_adjudicated_gold_count:datasetRegistry.approved_adjudicated_project_gold_count,metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinical_validity:"NOT_INFERRED",clinical_authority_added:false}));
