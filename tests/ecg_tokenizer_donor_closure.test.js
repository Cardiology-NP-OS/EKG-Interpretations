"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const base = "donors/heartwise-ai_ecg-tokenizer/";

const manifest = read(base + "DONOR_MANIFEST.json");
const inventory = read(base + "INVENTORY.json");
const gap = read(base + "GAP_MATRIX.json");
const licenses = read(base + "LICENSE_BOUNDARY.json");
const data = read(base + "DATASET_BOUNDARY.json");
const models = read(base + "MODEL_BOUNDARY.json");
const assoc = read(base + "ASSOCIATED_REPOSITORY_DISPOSITIONS.json");
const upstream = read(base + "UPSTREAM_VERIFICATION.json");
const draft = read(base + "DONOR_RECEIPT_DRAFT.json");
const fullTree = read(base + "FULL_TREE_INDEX.json");
const donorRegistry = read("ECG_DONOR_REGISTRY.json");
const canonical = read("ECG_CAPABILITY_REGISTRY.json");
const donorCapabilities = read("ECG_DONOR_CAPABILITY_REGISTRY.json");
const challengers = read("ECG_MODEL_CHALLENGER_REGISTRY.json");
const ledger = read("ECG_LICENSE_LEDGER.json");
const protocol = read("evaluation/protocols/REPRESENTATION_SEMANTICS_CONTRACT.json");

const donor = donorRegistry.donors.find(row => row.donor_id === "DONOR-014");
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("PASS " + name);
}

test("source commit and Git tree are exact and verified", () => {
  assert.strictEqual(manifest.audited_head.branch, "main");
  assert.strictEqual(manifest.audited_head.commit, "64f7963a7f55b90895dce31f1e7d55c7eba2d51d");
  assert.strictEqual(manifest.audited_head.tree, "6c0d631ca1ca9dad892ae8343362d20147fdd44e");
  assert.strictEqual(manifest.audited_head.tree_verification, "VERIFIED_GIT_COMMIT_OBJECT");
  assert.strictEqual(upstream.audited_commit, manifest.audited_head.commit);
  assert.strictEqual(upstream.audited_tree, manifest.audited_head.tree);
  assert.strictEqual(upstream.audited_tree_status, "VERIFIED_GIT_COMMIT_OBJECT");
  assert.strictEqual(donor.audited_commit, manifest.audited_head.commit);
  assert.strictEqual(donor.audited_tree, manifest.audited_head.tree);
  assert.strictEqual(donor.audited_tree_status, "VERIFIED_GIT_COMMIT_OBJECT");
});

test("target pre-donor basis is the exact green PR13 merge", () => {
  assert.strictEqual(manifest.target_basis.commit, "dd2b7a0bc3c2fd0576db4c7de05b1f2eb887e456");
  assert.strictEqual(manifest.target_basis.tree, "11c01cb7505b9b9dbe8e9d247ff2fb5d5bc24bd4");
  assert.deepStrictEqual(draft.target_baseline, manifest.target_basis);
});

test("upstream inventory binds a complete non-truncated recursive Git tree", () => {
  assert.strictEqual(
    inventory.inventory_completeness,
    "FULL_RECURSIVE_GIT_TREE_VERIFIED_PLUS_SELECTED_HIGH_VALUE_BLOB_AUDIT"
  );
  assert.strictEqual(inventory.full_recursive_tree_verified, true);
  assert.strictEqual(inventory.recursive_tree_truncated, false);
  assert.strictEqual(inventory.tree, "6c0d631ca1ca9dad892ae8343362d20147fdd44e");
  assert.strictEqual(inventory.recursive_entry_count, 392);
  assert.strictEqual(inventory.recursive_blob_count, 350);
  assert.strictEqual(inventory.recursive_tree_count, 42);
  assert.strictEqual(inventory.exact_files.length, 15);
  assert.strictEqual(new Set(inventory.exact_files.map(row => row.path)).size, 15);
  for (const row of inventory.exact_files) {
    assert.match(row.blob_sha, /^[0-9a-f]{40}$/);
    assert.strictEqual(row.inspection, "EXACT_CONNECTOR_FILE");
  }
  assert.strictEqual(fullTree.tree, inventory.tree);
  assert.strictEqual(fullTree.recursive_tree_truncated, false);
  assert.strictEqual(fullTree.entry_count, 392);
  assert.strictEqual(fullTree.blob_count, 350);
  assert.strictEqual(fullTree.tree_count, 42);
  assert.deepStrictEqual(fullTree.tracked_model_or_dataset_artifact_candidates, []);
  assert.deepStrictEqual(inventory.tracked_model_or_dataset_artifact_candidates, []);
  assert.strictEqual(upstream.selected_exact_blob_audit_count, 15);
});

test("MIT source boundary is explicit while weights and datasets remain unadmitted", () => {
  assert.strictEqual(licenses.source_code.spdx, "MIT");
  assert.strictEqual(licenses.source_code.license_blob_sha, "09ef05852eeeab23785b9a44e93154e10b7028d8");
  assert.strictEqual(licenses.source_code_copied, false);
  assert.strictEqual(licenses.model_weights.status, "NOT_ADMITTED_NOT_IMPORTED");
  assert.strictEqual(data.phi_or_restricted_data_imported, false);
  assert.strictEqual(data.clinical_gold_created, false);
  assert.strictEqual(models.checkpoints.imported, false);
  assert.strictEqual(models.checkpoints.executed_by_target, false);
});

test("all ten donor capabilities have one canonical disposition", () => {
  assert.strictEqual(gap.capabilities.length, 10);
  assert.strictEqual(gap.summary.total, 10);
  assert.strictEqual(new Set(gap.capabilities.map(row => row.id)).size, 10);
  const targetIds = new Set(canonical.capabilities.map(row => row.capability_id));
  const normalized = donorCapabilities.capabilities.filter(
    row => row.donor === manifest.repository && row.donor_commit === manifest.audited_head.commit
  );
  assert.strictEqual(normalized.length, 10);
  assert.deepStrictEqual(
    normalized.map(row => row.capability_id).sort(),
    gap.capabilities.map(row => row.id).sort()
  );
  for (const row of normalized) {
    assert.ok(targetIds.has(row.canonical_target_implementation), row.capability_id);
  }
});

test("target-owned representation semantics capability is executable and nonruntime", () => {
  const row = canonical.capabilities.find(
    item => item.capability_id === "ECG-CAP-MODEL-REPRESENTATION-SEMANTICS"
  );
  assert.ok(row);
  assert.strictEqual(row.canonical_target_path, "lib/representation_contract.js");
  assert.strictEqual(row.implementation_status, "TARGET_OWNED_EVALUATION_IMPLEMENTATION");
  assert.ok(row.test_paths.includes("tests/representation_contract.test.js"));
  assert.ok(row.evaluation_paths.includes("evaluation/protocols/REPRESENTATION_SEMANTICS_CONTRACT.json"));
  assert.strictEqual(row.runtime_status, "INACTIVE_EVALUATION_ONLY");
  assert.strictEqual(protocol.runtimeAuthority, false);
  assert.strictEqual(protocol.clinicalValidityInferred, false);
});

test("canonical capability counts reconcile after donor normalization", () => {
  assert.strictEqual(canonical.capability_count, canonical.capabilities.length);
  assert.strictEqual(
    canonical.generated_from_donor_capability_registry_count,
    donorCapabilities.capabilities.length
  );
  assert.strictEqual(donorCapabilities.capability_count, donorCapabilities.capabilities.length);
});

test("three donor model families remain architecture-only and nonexecuted", () => {
  const rows = challengers.models.filter(row => row.donor_id === "DONOR-014");
  assert.strictEqual(rows.length, 3);
  for (const row of rows) {
    assert.strictEqual(row.checkpoint_hash, null);
    assert.strictEqual(row.weights_imported, false);
    assert.strictEqual(row.execution_status, "ARCHITECTURE_ONLY_NONEXECUTED");
    assert.strictEqual(row.runtime_authority, false);
    assert.strictEqual(row.clinical_validity, "NOT_INFERRED");
    assert.strictEqual(row.software_license, "MIT");
  }
});

test("license ledger forbids silent dependency, data, and weight import", () => {
  const row = ledger.entries.find(item => item.donor_id === "DONOR-014");
  assert.ok(row);
  assert.strictEqual(row.source_code_license.spdx, "MIT");
  assert.strictEqual(row.copied_source_code, false);
  assert.strictEqual(row.model_weight_license.weights_imported, false);
  assert.strictEqual(row.dataset_license.raw_bytes_imported, false);
  assert.strictEqual(row.dependency_license_action.transitive_dependency_import, false);
});

test("associated repositories remain separately governed and globally queued", () => {
  const qa = assoc.repositories.find(row => row.repository === "HeartWise-AI/ECG_Dataset_QA");
  const docker = assoc.repositories.find(row => row.repository === "HeartWise-AI/DeepECG_Docker");
  assert.ok(qa);
  assert.strictEqual(qa.audited_in_donor_014, false);
  assert.strictEqual(qa.registered_donor_id, "DONOR-A007");
  assert.strictEqual(qa.observed_commit, "a664ab92f6036752a96b119d87118b7e4b9d36c2");
  assert.strictEqual(qa.observed_tree, "8465d628ad7460c4dcd8b5edce2acba23180c1b8");
  assert.strictEqual(qa.disposition, "QUEUED_ASSOCIATED_DONOR_LICENSE_REVIEW");
  const queued = donorRegistry.donors.find(row => row.donor_id === "DONOR-A007");
  assert.ok(queued);
  assert.strictEqual(queued.repository, "HeartWise-AI/ECG_Dataset_QA");
  assert.strictEqual(queued.observed_commit, qa.observed_commit);
  assert.strictEqual(queued.observed_tree, qa.observed_tree);
  assert.strictEqual(queued.status, "QUEUED_ASSOCIATED_DONOR_LICENSE_REVIEW");
  assert.match(queued.license_note, /No LICENSE file/);
  assert.ok(docker);
  assert.strictEqual(docker.disposition, "ALREADY_GOVERNED_SEPARATE_DONOR");
});

test("donor artifact directory contains governance evidence only, not donor runtime source", () => {
  const names = fs.readdirSync(path.join(root, base));
  assert.ok(names.length >= 10);
  for (const name of names) {
    assert.ok(/\.(json|md)$/.test(name), name);
    assert.ok(!/\.(py|pt|pth|safetensors|parquet|npy|csv)$/i.test(name), name);
  }
});

test("DONOR-014 is accepted on main with post-promotion CI", () => {
  const receipt = read(base + "DONOR_RECEIPT.json");
  const review = read(base + "REVIEW_VERIFICATION.json");
  assert.strictEqual(donor.status, "ACCEPTED_ON_MAIN");
  assert.strictEqual(donor.receipt_status, "FINALIZED");
  assert.strictEqual(donor.verified_candidate_commit, "50ee3dd668a3c19d5c250defac50358c12827bcc");
  assert.strictEqual(donor.verified_candidate_tree, "67af315ed4bca26e3ba6944dd1ab893cdc9dc081");
  assert.strictEqual(donor.candidate_ci_run_id, 35540276319);
  assert.strictEqual(donor.candidate_ci_conclusion, "success");
  assert.strictEqual(donor.independently_attested, false);
  assert.strictEqual(donor.promotion_commit, "de7e13a28c502fa5e1ced202a888ee66a44db700");
  assert.strictEqual(donor.promotion_tree, "75d8f4d894280ef381d495cb79d8902a7f11bc69");
  assert.strictEqual(donor.target_main_ci_run_id, 35541158296);
  assert.strictEqual(donor.target_main_ci_conclusion, "success");
  assert.strictEqual(donorRegistry.completed_donors, 14);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-015");
  assert.strictEqual(receipt.acceptance_state, "ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
  assert.strictEqual(receipt.promotion.status, "ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
  assert.strictEqual(receipt.promotion.commit, donor.promotion_commit);
  assert.strictEqual(receipt.promotion.tree, donor.promotion_tree);
  assert.strictEqual(receipt.promotion.target_main_ci_run_id, donor.target_main_ci_run_id);
  assert.strictEqual(receipt.promotion.target_main_ci_conclusion, "success");
  assert.strictEqual(review.review_disposition, "PASS_WITH_EXPLICIT_ENGINEERING_SCOPE_LIMITS");
  assert.strictEqual(review.independently_attested, false);
  assert.strictEqual(draft.superseded, true);
  assert.strictEqual(draft.superseded_by, base + "DONOR_RECEIPT.json");
});

test("governed inactive clinical invariants remain unchanged", () => {
  const state = donorRegistry.governed_clinical_state;
  assert.strictEqual(state.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(state.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(state.approved_adjudicated_gold_count, 0);
  assert.strictEqual(state.metrics, "NOT_REPORTABLE");
  assert.strictEqual(state.activation, "NOT_ELIGIBLE");
  assert.strictEqual(state.clinical_validity, "NOT_INFERRED");
  assert.strictEqual(draft.boundaries.clinical_authority_added, false);
});

test("CI and edge coverage include representation and donor closure suites", () => {
  const pkg = read("package.json");
  const edges = read("ECG_EDGE_CASE_COVERAGE.json");
  for (const name of [
    "tests/representation_contract.test.js",
    "tests/ecg_tokenizer_donor_closure.test.js",
  ]) {
    assert.ok(pkg.scripts["test:ci"].includes(name), name);
    assert.ok(edges.categories.some(row => row.tests.includes(name)), name);
  }
});

console.log(JSON.stringify({
  schema: "ekg-donor-014-closure-tests-v1",
  pass: true,
  passed,
  total: passed,
  acceptance: true,
  runtimeAuthority: false,
  clinicalAuthorityAdded: false
}));
