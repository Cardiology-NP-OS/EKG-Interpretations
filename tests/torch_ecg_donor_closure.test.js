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
const manifest = readJson("donors/deeppsp_torch_ecg/DONOR_MANIFEST.json");
const inventory = readJson("donors/deeppsp_torch_ecg/INVENTORY.json");
const gap = readJson("donors/deeppsp_torch_ecg/GAP_MATRIX.json");
const modelBoundary = readJson("donors/deeppsp_torch_ecg/MODEL_BOUNDARY.json");
const associated = readJson("donors/deeppsp_torch_ecg/ASSOCIATED_REPOSITORY_DISPOSITIONS.json");
const attribution = readText("ECG_ATTRIBUTION_LEDGER.md");
const pkg = readJson("package.json");

const donor = donorRegistry.donors.find(item => item.donor_id === "DONOR-004");
const caps = capabilityRegistry.capabilities.filter(item => item.donor === "DeepPSP/torch_ecg");
const license = licenseLedger.entries.find(item => item.donor_id === "DONOR-004");
const allowed = new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);

check("upstream identity and inventory are pinned", () => {
  assert.strictEqual(manifest.audited_head.commit, "11967474e46023dc7a82acf264e426c1ce4eacfa");
  assert.strictEqual(manifest.audited_head.tree, "307435b2cb11819f2dc8946866ecc54aab6bff1a");
  assert.strictEqual(manifest.software_license.spdx, "MIT");
  assert.strictEqual(manifest.software_license.license_blob_sha, "40d9a25369b4fd1f3315f16f932eebf297dbd549");
  assert.strictEqual(inventory.recursive_tree_audit.complete, true);
  assert.strictEqual(inventory.recursive_tree_audit.tracked_file_count, 806);
});
check("all material capabilities have governed terminal dispositions", () => {
  assert.strictEqual(gap.rows.length, 34);
  assert.strictEqual(new Set(gap.rows.map(row => row.capability_id)).size, 34);
  assert.strictEqual(gap.disposition_summary.total, 34);
  for (const row of gap.rows) assert.ok(allowed.has(row.final_disposition), row.capability_id);
  assert.strictEqual(gap.rows.some(row => ["INTEGRATED","DEPENDENCY","ADAPTER"].includes(row.final_disposition)), false);
});
check("canonical capability registry matches the gap matrix", () => {
  assert.strictEqual(caps.length, 34);
  assert.strictEqual(capabilityRegistry.capability_count, capabilityRegistry.capabilities.length);
  assert.strictEqual(capabilityRegistry.capability_count, 108);
  const byId = new Map(caps.map(item => [item.capability_id, item]));
  for (const row of gap.rows) assert.strictEqual(byId.get(row.capability_id).disposition, row.final_disposition);
  for (const item of caps.filter(item => item.disposition === "CHALLENGER")) {
    assert.strictEqual(item.challengers[0].execution_status, "NOT_EXECUTABLE_NO_APPROVED_CHECKPOINT");
    assert.strictEqual(item.challengers[0].runtime_authority, false);
  }
});
check("code checkpoint and dataset licenses remain separate and fail closed", () => {
  assert.strictEqual(license.source_code_license.spdx, "MIT");
  assert.strictEqual(license.copied_source_code, false);
  assert.strictEqual(license.model_weight_license.status, "LICENSE_REVIEW_REQUIRED_PER_ARTIFACT");
  assert.strictEqual(license.model_weight_license.weights_imported, false);
  assert.strictEqual(license.model_weight_license.execution_eligible, false);
  assert.strictEqual(license.dataset_license.status, "LICENSE_REVIEW_REQUIRED_PER_DATASET");
  assert.strictEqual(license.dataset_license.raw_data_imported, false);
  assert.strictEqual(license.dataset_license.source_labels_promoted_to_project_gold, false);
  assert.strictEqual(license.dependency_license_action.status, "NO_RUNTIME_DEPENDENCY_ADDED");
});
check("no executable Donor 004 model is registered", () => {
  assert.strictEqual(modelRegistry.models.some(item => item.donor_id === "DONOR-004"), false);
  assert.strictEqual(modelBoundary.checkpoint_identity, null);
  assert.strictEqual(modelBoundary.checkpoint_hash, null);
  assert.strictEqual(modelBoundary.weights_imported, false);
  assert.strictEqual(modelBoundary.execution_status, "NOT_EXECUTED_IN_TARGET");
  assert.strictEqual(modelBoundary.runtime_authority, false);
  assert.strictEqual(modelBoundary.clinical_validity, "NOT_INFERRED");
});
check("sample and benchmark assets remain data-only and non-gold", () => {
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  const asset = datasetRegistry.datasets.find(item => item.introduced_by === "DONOR-004");
  assert.ok(asset);
  assert.strictEqual(asset.status, "DATA_ONLY_LICENSE_REVIEW_REQUIRED_PER_DATASET");
  assert.strictEqual(manifest.dataset_license.raw_data_imported_into_target, false);
  assert.strictEqual(manifest.dataset_license.source_labels_promoted_to_project_gold, false);
});
check("no target runtime dependency or implementation is added", () => {
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(Boolean(pkg.devDependencies && Object.keys(pkg.devDependencies).some(key => /torch|torch-ecg/i.test(key))), false);
  assert.strictEqual(donor.runtime_dependency_added, false);
  assert.strictEqual(donor.model_weights_imported, false);
  assert.strictEqual(donor.dataset_bytes_imported, false);
  assert.strictEqual(donor.clinical_authority_added, false);
});
check("associated references are explicitly dispositioned without queue expansion", () => {
  assert.strictEqual(associated.repositories.length, 8);
  for (const item of associated.repositories) {
    assert.ok(allowed.has(item.disposition), item.repository);
    assert.strictEqual(item.queued_as_associated_donor, false);
  }
});
check("donor remains pre-promotion and uncounted", () => {
  assert.strictEqual(donorRegistry.completed_donors, 3);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-004");
  assert.strictEqual(donor.status, "AUDITED_CANDIDATE_FOR_MERGE");
  assert.strictEqual(donor.receipt_status, "PENDING_PREPROMOTION_CLOSURE");
  assert.strictEqual(fs.existsSync(path.join(root, "donors/deeppsp_torch_ecg/DONOR_RECEIPT.json")), false);
});
check("governed inactive state and attribution are preserved", () => {
  assert.strictEqual(gap.clinical_authority_added, false);
  assert.strictEqual(capabilityRegistry.clinical_authority_added, false);
  assert.strictEqual(modelBoundary.runtime_authority, false);
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  assert.ok(attribution.includes("## DONOR-004 -- DeepPSP/torch_ecg"));
  assert.ok(attribution.includes("Donor checkpoint/model weights copied or executed: **no**"));
  assert.ok(attribution.includes("Donor benchmark scores promoted to target metrics: **no**"));
});

console.log(JSON.stringify({schema:"ekg-donor-004-prepromotion-closure-tests-v1",donor:"DeepPSP/torch_ecg",pass:true,passed,total:passed,completed_donors:donorRegistry.completed_donors,next_donor_id:donorRegistry.next_donor_id,receipt_finalized:false,diagnostic_runtime:"GOVERNED_INACTIVE",evidence_admission:"NOT_ADMITTED",approved_adjudicated_gold_count:datasetRegistry.approved_adjudicated_project_gold_count,metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinical_validity:"NOT_INFERRED",clinical_authority_added:false}));