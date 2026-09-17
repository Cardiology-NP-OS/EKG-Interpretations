const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const readText = rel => fs.readFileSync(path.join(root, rel), "utf8");
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; };

const donorRegistry = readJson("ECG_DONOR_REGISTRY.json");
const capabilityRegistry = readJson("ECG_DONOR_CAPABILITY_REGISTRY.json");
const licenseLedger = readJson("ECG_LICENSE_LEDGER.json");
const datasetRegistry = readJson("ECG_DATASET_REGISTRY.json");
const modelRegistry = readJson("ECG_MODEL_CHALLENGER_REGISTRY.json");
const gap = readJson("donors/neuropsychology_neurokit/GAP_MATRIX.json");
const manifest = readJson("donors/neuropsychology_neurokit/DONOR_MANIFEST.json");
const comparative = readJson("donors/neuropsychology_neurokit/COMPARATIVE_PROOF.json");
const independent = readJson("donors/neuropsychology_neurokit/INDEPENDENT_VERIFICATION.json");
const attribution = readText("ECG_ATTRIBUTION_LEDGER.md");
const pkg = readJson("package.json");

const allowed = new Set(["INTEGRATED", "DEPENDENCY", "ADAPTER", "CHALLENGER", "EVALUATION_ONLY", "DATA_ONLY", "RESEARCH_ONLY", "SUPERSEDED", "REJECTED", "LICENSE_REVIEW_REQUIRED"]);
const donor = donorRegistry.donors.find(item => item.donor_id === "DONOR-003");
const nkCaps = capabilityRegistry.capabilities.filter(item => item.donor === "neuropsychology/NeuroKit");
const license = licenseLedger.entries.find(item => item.donor_id === "DONOR-003");
check("donor remains pre-promotion and uncounted", () => {
  assert.strictEqual(donorRegistry.completed_donors, 2);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-003");
  assert.strictEqual(donor.status, "AUDITED_CANDIDATE_FOR_MERGE");
  assert.strictEqual(donor.receipt_status, "PENDING_POST_PROMOTION_TARGET_MAIN_CI");
  assert.strictEqual(fs.existsSync(path.join(root, "donors/neuropsychology_neurokit/DONOR_RECEIPT.json")), false);
});
check("all material capabilities have terminal dispositions", () => {
  assert.strictEqual(gap.rows.length, 24);
  assert.strictEqual(new Set(gap.rows.map(row => row.capability_id)).size, 24);
  for (const row of gap.rows) assert.ok(allowed.has(row.final_disposition), row.capability_id);
  assert.strictEqual(gap.disposition_summary.total, 24);
});
check("canonical capability registry matches gap matrix", () => {
  assert.strictEqual(nkCaps.length, 24);
  assert.strictEqual(capabilityRegistry.capability_count, capabilityRegistry.capabilities.length);
  const byId = new Map(nkCaps.map(item => [item.capability_id, item]));
  for (const row of gap.rows) assert.strictEqual(byId.get(row.capability_id).disposition, row.final_disposition);
});
check("license and data boundaries remain fail closed", () => {
  assert.strictEqual(license.source_code_license.spdx, "MIT");
  assert.strictEqual(license.copied_source_code, false);
  assert.strictEqual(license.dataset_license.status, "LICENSE_REVIEW_REQUIRED_PER_DATASET");
  assert.strictEqual(license.dataset_license.raw_data_imported, false);
  assert.strictEqual(license.dependency_license_action.status, "NO_RUNTIME_DEPENDENCY_ADDED");
  assert.strictEqual(datasetRegistry.approved_adjudicated_project_gold_count, 0);
  assert.ok(datasetRegistry.datasets.some(item => item.introduced_by === "DONOR-003" && item.status.includes("LICENSE_REVIEW_REQUIRED")));
});
check("no NeuroKit model or runtime dependency was imported", () => {
  assert.strictEqual(modelRegistry.models.some(item => item.donor_id === "DONOR-003"), false);
  assert.strictEqual(manifest.model_license.weights_imported_into_target, false);
  assert.strictEqual(Boolean(pkg.dependencies && Object.keys(pkg.dependencies).some(key => /neurokit/i.test(key))), false);
});
check("comparative and independent evidence bind the verified candidate", () => {
  assert.strictEqual(comparative.after.verified_candidate_commit, "9b441fbfcb2318853ff2a661abb2068bd72a3207");
  assert.strictEqual(comparative.verification.conclusion, "success");
  assert.strictEqual(independent.candidate_commit, "9b441fbfcb2318853ff2a661abb2068bd72a3207");
  assert.strictEqual(independent.result, "PASS");
  assert.strictEqual(independent.full_candidate_diff_check, "PASS");
  assert.strictEqual(independent.full_target_suite, "PASS");
});
check("governed clinical state remains inactive", () => {
  const state = comparative.after.governed_state;
  assert.strictEqual(manifest.clinical_authority_change_allowed, false);
  assert.strictEqual(state.completion_state, "SPECIALIST_COMPLETE_INACTIVE");
  assert.strictEqual(state.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(state.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(state.approved_adjudicated_gold_count, 0);
  assert.strictEqual(state.metrics, "NOT_REPORTABLE");
  assert.strictEqual(state.activation, "NOT_ELIGIBLE");
  assert.strictEqual(state.clinical_validity, "NOT_INFERRED");
});
check("attribution records bounded clean reimplementation", () => {
  assert.ok(attribution.includes("## DONOR-003 -- neuropsychology/NeuroKit"));
  assert.ok(attribution.includes("Donor source code copied: **no**"));
  assert.ok(attribution.includes("NeuroKit runtime dependency added: **no**"));
});

console.log(JSON.stringify({schema:"ekg-donor-003-prepromotion-closure-tests-v1",donor:"neuropsychology/NeuroKit",pass:true,passed,total:passed,completed_donors:donorRegistry.completed_donors,next_donor_id:donorRegistry.next_donor_id,receipt_finalized:false,clinical_authority_added:false}));
