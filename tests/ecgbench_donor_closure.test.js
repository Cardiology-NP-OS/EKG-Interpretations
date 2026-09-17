const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8").replace(/^\uFEFF/, ""));
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; };
const donorRegistry = readJson("ECG_DONOR_REGISTRY.json");
const capabilityRegistry = readJson("ECG_DONOR_CAPABILITY_REGISTRY.json");
const licenseLedger = readJson("ECG_LICENSE_LEDGER.json");
const datasetRegistry = readJson("ECG_DATASET_REGISTRY.json");
const modelRegistry = readJson("ECG_MODEL_CHALLENGER_REGISTRY.json");
const manifest = readJson("donors/vlbthambawita_ecgbench/DONOR_MANIFEST.json");
const inventory = readJson("donors/vlbthambawita_ecgbench/INVENTORY.json");
const gap = readJson("donors/vlbthambawita_ecgbench/GAP_MATRIX.json");
const licenseBoundary = readJson("donors/vlbthambawita_ecgbench/LICENSE_BOUNDARY.json");
const datasetBoundary = readJson("donors/vlbthambawita_ecgbench/DATASET_BOUNDARY.json");
const modelBoundary = readJson("donors/vlbthambawita_ecgbench/MODEL_BOUNDARY.json");
const associated = readJson("donors/vlbthambawita_ecgbench/ASSOCIATED_REPOSITORY_DISPOSITIONS.json");
const comparative = readJson("donors/vlbthambawita_ecgbench/COMPARATIVE_PROOF.json");
const independent = readJson("donors/vlbthambawita_ecgbench/INDEPENDENT_VERIFICATION.json");
const receipt = readJson("donors/vlbthambawita_ecgbench/DONOR_RECEIPT.json");
const pkg = readJson("package.json");
const donor = donorRegistry.donors.find(item => item.donor_id === "DONOR-007");
const caps = capabilityRegistry.capabilities.filter(item => item.donor === "vlbthambawita/ECGBench");
const license = licenseLedger.entries.find(item => item.donor_id === "DONOR-007");
const allowed = new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);
check("exact upstream identity and full inventory are pinned", () => {
  assert.strictEqual(manifest.audited_head.commit, "31b5050002622a72a8f3558f731929c3e3a6c68e");
  assert.strictEqual(manifest.audited_head.tree, "9f52c3f551b443ff660f7b112bca84684f4f1239");
  assert.strictEqual(inventory.recursive_tree_audit.tracked_file_count, 385);
  assert.strictEqual(inventory.recursive_tree_audit.complete, true);
});
check("catalogue and config inventory is explicit", () => {
  assert.strictEqual(inventory.package_summary.dataset_catalogue_markdown_count, 64);
  assert.strictEqual(inventory.package_summary.dataset_config_yaml_count, 52);
  assert.strictEqual(datasetBoundary.catalogue_entries.length, 64);
  assert.strictEqual(datasetBoundary.dataset_config_count, 52);
});
check("all material capabilities have terminal dispositions", () => {
  assert.strictEqual(gap.rows.length, 36);
  assert.strictEqual(gap.disposition_summary.total, 36);
  for (const row of gap.rows) assert.ok(allowed.has(row.final_disposition));
});
check("canonical capability registry matches gap matrix", () => {
  assert.strictEqual(caps.length, 36);
  assert.strictEqual(capabilityRegistry.capability_count, capabilityRegistry.capabilities.length);
  assert.ok(capabilityRegistry.capability_count >= 213);
  const byId = new Map(caps.map(item => [item.capability_id, item]));
  for (const row of gap.rows) assert.strictEqual(byId.get(row.capability_id).disposition, row.final_disposition);
});
check("software license and external dataset rights remain separate", () => {
  assert.strictEqual(licenseBoundary.source_code.spdx, "MIT");
  assert.strictEqual(licenseBoundary.source_code.license_blob_sha, "3b97c4cdca87936b7512d1656347e22e16656e58");
  assert.strictEqual(license.source_code_license.spdx, "MIT");
  assert.ok(license.dataset_license.status.includes("LICENSE_REVIEW_REQUIRED"));
  assert.strictEqual(license.copied_source_code, false);
});
check("external datasets and splits remain non-gold and unimported", () => {
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  const aggregate = datasetRegistry.datasets.find(item => item.introduced_by === "DONOR-007");
  assert.ok(aggregate && aggregate.status.includes("LICENSE_REVIEW_REQUIRED"));
  assert.strictEqual(datasetBoundary.raw_dataset_bytes_imported, false);
  assert.strictEqual(datasetBoundary.huggingface_fold_split_bytes_imported, false);
  assert.strictEqual(datasetBoundary.source_labels_promoted_to_project_gold, false);
  for (const item of datasetBoundary.catalogue_entries) assert.strictEqual(item.source_labels_project_gold, false);
});
check("no model or checkpoint authority exists", () => {
  assert.strictEqual(modelBoundary.tracked_model_weight_count, 0);
  assert.strictEqual(modelBoundary.tracked_checkpoint_count, 0);
  assert.strictEqual(modelBoundary.weights_imported, false);
  assert.strictEqual(modelRegistry.models.some(item => item.donor_id === "DONOR-007" || item.donor === "vlbthambawita/ECGBench"), false);
});
check("no donor runtime dependency source data or external artifacts are activated", () => {
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(donor.runtime_dependency_added, false);
  assert.strictEqual(donor.source_code_copied, false);
  assert.strictEqual(donor.model_weights_imported, false);
  assert.strictEqual(donor.dataset_bytes_imported, false);
  assert.strictEqual(donor.clinical_authority_added, false);
});
check("remote download remains rejected and label separation remains non-authoritative", () => {
  const byId = new Map(gap.rows.map(row => [row.capability_id, row]));
  assert.strictEqual(byId.get("ECGB-027").final_disposition, "REJECTED");
  assert.strictEqual(byId.get("ECGB-011").final_disposition, "SUPERSEDED");
  assert.strictEqual(byId.get("ECGB-017").final_disposition, "DATA_ONLY");
});
check("associated dependencies do not expand the donor queue", () => {
  assert.strictEqual(associated.repositories.length, 6);
  for (const item of associated.repositories) assert.strictEqual(item.queued_as_associated_donor, false);
});
check("candidate CI and independent verification are bound", () => {
  assert.strictEqual(donor.verified_candidate_commit, "bcb68e39a09790d6018ca58b0a63b9c420fb7c0d");
  assert.strictEqual(donor.verified_candidate_tree, "aa3a13527a2fe83b0bf3e56218fdd90b4c924a9a");
  assert.strictEqual(donor.candidate_ci_run_id, 35243347524);
  assert.strictEqual(comparative.verification.head_sha, donor.verified_candidate_commit);
  assert.strictEqual(comparative.verification.conclusion, "success");
  assert.strictEqual(independent.candidate_commit, donor.verified_candidate_commit);
  assert.strictEqual(independent.result, "PASS");
  assert.strictEqual(independent.full_target_suite, "PASS");
});
check("donor is accepted only after promotion and target-main CI", () => {
  assert.ok(donorRegistry.completed_donors >= 7);
  assert.notStrictEqual(donorRegistry.next_donor_id, "DONOR-007");
  assert.strictEqual(donor.status, "ACCEPTED_ON_MAIN");
  assert.strictEqual(donor.receipt_status, "FINALIZED");
  assert.strictEqual(donor.receipt, "donors/vlbthambawita_ecgbench/DONOR_RECEIPT.json");
  assert.strictEqual(donor.promotion_commit, "e12e781e8b9c27d0aefbe75f55c99d80dce76fe8");
  assert.strictEqual(donor.target_main_ci_run_id, 35243673584);
  assert.strictEqual(donor.target_main_ci_conclusion, "success");
  assert.strictEqual(receipt.acceptance_state, "ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
  assert.strictEqual(receipt.promotion.merge_commit, donor.promotion_commit);
  assert.strictEqual(receipt.promotion.target_main_ci_run_id, donor.target_main_ci_run_id);
});
check("governed inactive state remains explicit", () => {
  assert.strictEqual(gap.clinical_authority_added, false);
  assert.strictEqual(capabilityRegistry.clinical_authority_added, false);
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
});
console.log(JSON.stringify({schema:"ekg-donor-007-acceptance-closure-tests-v1",donor:"vlbthambawita/ECGBench",pass:true,passed,total:passed,completed_donors:donorRegistry.completed_donors,next_donor_id:donorRegistry.next_donor_id,receipt_finalized:true,diagnostic_runtime:"GOVERNED_INACTIVE",evidence_admission:"NOT_ADMITTED",approved_adjudicated_gold_count:datasetRegistry.approved_adjudicated_project_gold_count,metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinical_validity:"NOT_INFERRED",clinical_authority_added:false}));
