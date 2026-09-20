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

test("source commit is exact and unresolved tree is explicit rather than invented", () => {
  assert.strictEqual(manifest.audited_head.branch, "main");
  assert.strictEqual(manifest.audited_head.commit, "64f7963a7f55b90895dce31f1e7d55c7eba2d51d");
  assert.strictEqual(manifest.audited_head.tree, null);
  assert.strictEqual(manifest.audited_head.tree_verification, "UNRESOLVED_CONNECTOR_SURFACE_DO_NOT_INVENT");
  assert.strictEqual(upstream.audited_commit, manifest.audited_head.commit);
  assert.strictEqual(upstream.audited_tree, null);
  assert.strictEqual(donor.audited_commit, manifest.audited_head.commit);
  assert.strictEqual(donor.audited_tree, null);
});

test("target pre-donor basis is the exact green PR13 merge", () => {
  assert.strictEqual(manifest.target_basis.commit, "dd2b7a0bc3c2fd0576db4c7de05b1f2eb887e456");
  assert.strictEqual(manifest.target_basis.tree, "11c01cb7505b9b9dbe8e9d247ff2fb5d5bc24bd4");
  assert.deepStrictEqual(draft.target_baseline, manifest.target_basis);
});

test("selected upstream inventory is exact-blob pinned and honestly incomplete", () => {
  assert.strictEqual(inventory.inventory_completeness, "SELECTED_HIGH_VALUE_SURFACES_ONLY");
  assert.strictEqual(inventory.complete_recursive_tree, false);
  assert.strictEqual(inventory.tree, null);
  assert.strictEqual(inventory.exact_files.length, 15);
  assert.strictEqual(new Set(inventory.exact_files.map(row => row.path)).size, 15);
  for (const row of inventory.exact_files) {
    assert.match(row.blob_sha, /^[0-9a-f]{40}$/);
    assert.strictEqual(row.inspection, "EXACT_CONNECTOR_FILE");
  }
  assert.strictEqual(upstream.selected_exact_blob_audit_count, 15);
  assert.strictEqual(upstream.full_recursive_tree_verified, false);
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

test("associated repositories remain separately governed", () => {
  const qa = assoc.repositories.find(row => row.repository === "HeartWise-AI/ECG_Dataset_QA");
  const docker = assoc.repositories.find(row => row.repository === "HeartWise-AI/DeepECG_Docker");
  assert.ok(qa);
  assert.strictEqual(qa.audited_in_donor_014, false);
  assert.strictEqual(qa.disposition, "SEPARATE_DONOR_OR_RESEARCH_SOURCE_NOT_SILENTLY_INCLUDED");
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

test("DONOR-014 remains implemented-unverified until verification and promotion", () => {
  assert.strictEqual(donor.status, "IMPLEMENTED_UNVERIFIED");
  assert.strictEqual(donor.receipt_status, "PENDING");
  assert.strictEqual(donorRegistry.completed_donors, 13);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-014");
  assert.strictEqual(draft.acceptance_state, "IMPLEMENTED_UNVERIFIED");
  assert.strictEqual(draft.independent_verification, "NOT_PERFORMED");
  assert.strictEqual(draft.promotion, "NOT_PERFORMED");
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
  acceptance: false,
  runtimeAuthority: false,
  clinicalAuthorityAdded: false
}));
