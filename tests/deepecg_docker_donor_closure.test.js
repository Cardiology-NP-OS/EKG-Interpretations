"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.resolve(__dirname, "..");
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const base = "donors/heartwise-ai_deepecg_docker/";
const manifest = read(base + "DONOR_MANIFEST.json");
const inventory = read(base + "INVENTORY.json");
const gap = read(base + "GAP_MATRIX.json");
const licenses = read(base + "LICENSE_BOUNDARY.json");
const data = read(base + "DATASET_BOUNDARY.json");
const models = read(base + "MODEL_BOUNDARY.json");
const upstream = read(base + "UPSTREAM_VERIFICATION.json");
const donorRegistry = read("ECG_DONOR_REGISTRY.json");
const donor = donorRegistry.donors.find(row => row.donor_id === "DONOR-013");
const canonical = read("ECG_CAPABILITY_REGISTRY.json");
const donorCapabilities = read("ECG_DONOR_CAPABILITY_REGISTRY.json");
const challengers = read("ECG_MODEL_CHALLENGER_REGISTRY.json");
const ledger = read("ECG_LICENSE_LEDGER.json");
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS " + name); }
test("source and target comparison basis are immutable exact identities", () => {
  assert.strictEqual(manifest.audited_head.commit, "cabf6c06b74731c86b8c5a27ae7101f14db5ec38");
  assert.strictEqual(manifest.audited_head.tree, "6433a9443a47ace3b3df616f57d422758ebe3ded");
  assert.strictEqual(manifest.target_basis.commit, "81e5920826a37cc5d8236293969662a1bfd27df5");
  assert.strictEqual(manifest.target_basis.tree, "3fad006629893baeacf91e70474fc1880b4ae7e8");
  assert.strictEqual(donor.audited_commit, manifest.audited_head.commit);
});
test("complete tree has 41 files and exact total bytes", () => {
  assert.strictEqual(inventory.recursive_tree_audit.tracked_file_count, 41);
  assert.strictEqual(inventory.recursive_tree_audit.tracked_bytes, 1017267);
  assert.strictEqual(inventory.tracked_files.length, 41);
  assert.strictEqual(new Set(inventory.tracked_files.map(row => row.path)).size, 41);
  assert.strictEqual(inventory.recursive_tree_audit.truncated, false);
  assert.strictEqual(inventory.tracked_files.reduce((sum, row) => sum + row.bytes, 0), 1017267);
  assert.strictEqual(inventory.package_summary.materialized_exact_source_files, 34);
});
test("credential file and samples were not inspected or imported as payloads", () => {
  for (const name of ["api_key.json", "ecg_signals/dummy_ecg.npy", "ecg_signals/dummy_ecg.xml"]) {
    const row = inventory.tracked_files.find(row => row.path === name);
    assert.ok(row); assert.match(row.inspection, /TREE_METADATA_ONLY/); assert.ok(!("sha256" in row));
    assert.ok(!fs.existsSync(path.join(root, base, name)));
  }
  assert.strictEqual(data.raw_dataset_bytes_imported, false);
  assert.strictEqual(data.source_labels_promoted_to_project_gold, false);
});
test("all 40 source capabilities have one terminal disposition and canonical map", () => {
  assert.strictEqual(gap.capability_count, 40);
  assert.strictEqual(gap.capabilities.length, 40);
  assert.strictEqual(new Set(gap.capabilities.map(row => row.capability_id)).size, 40);
  const allowed = new Set(["INTEGRATED", "DEPENDENCY", "ADAPTER", "CHALLENGER", "EVALUATION_ONLY", "DATA_ONLY", "RESEARCH_ONLY", "SUPERSEDED", "REJECTED", "LICENSE_REVIEW_REQUIRED"]);
  const ids = new Set(canonical.capabilities.map(row => row.capability_id));
  for (const row of gap.capabilities) {
    assert.ok(allowed.has(row.disposition), row.capability_id);
    assert.ok(ids.has(row.canonical_target_implementation), row.capability_id);
    assert.ok(row.reason.length > 10, row.capability_id);
  }
  const rows = donorCapabilities.capabilities.filter(row => row.donor === manifest.repository && row.donor_commit === manifest.audited_head.commit);
  assert.strictEqual(rows.length, 40);
  assert.deepStrictEqual(rows.map(row => row.capability_id).sort(), gap.capabilities.map(row => row.capability_id).sort());
});
test("new functional capability has executable implementation and direct tests", () => {
  const row = canonical.capabilities.find(row => row.capability_id === "ECG-CAP-EVALUATION-PROBABILITY-COMPARISON");
  assert.ok(row); assert.strictEqual(row.canonical_target_path, "lib/probability_comparison.js");
  assert.strictEqual(row.implementation_status, "TARGET_OWNED_EVALUATION_IMPLEMENTATION");
  assert.ok(row.test_paths.includes("tests/probability_comparison.test.js"));
  assert.ok(row.evaluation_paths.includes("evaluation/protocols/MODEL_PROBABILITY_COMPARISON_CONTRACT.json"));
});
test("absent code and model licenses fail closed", () => {
  assert.strictEqual(licenses.source_code.spdx, null);
  assert.strictEqual(licenses.source_code.status, "LICENSE_REVIEW_REQUIRED");
  assert.deepStrictEqual(licenses.source_code.license_files, []);
  assert.strictEqual(licenses.donor_source_code_copied, false);
  assert.strictEqual(licenses.model_weights.weights_imported, false);
  assert.strictEqual(licenses.model_weights.runtime_activation, false);
  const row = ledger.entries.find(row => row.donor_id === "DONOR-013");
  assert.strictEqual(row.source_code_license.status, "LICENSE_REVIEW_REQUIRED");
  assert.strictEqual(row.copied_source_code, false);
});
test("eleven model names remain unexecuted metadata with identity gaps", () => {
  const rows = challengers.models.filter(row => row.donor_id === "DONOR-013");
  assert.strictEqual(rows.length, 11);
  assert.strictEqual(models.models.length, 11);
  for (const row of rows) {
    assert.strictEqual(row.checkpoint_hash, null);
    assert.strictEqual(row.weights_imported, false);
    assert.strictEqual(row.runtime_authority, false);
    assert.strictEqual(row.clinical_validity, "NOT_INFERRED");
    assert.strictEqual(row.execution_status, "BLOCKED_LICENSE_AND_CHECKPOINT_IDENTITY");
  }
});
test("upstream observations are bounded and reproducible", () => {
  assert.strictEqual(upstream.test_error_collector.exit_code, 0);
  assert.strictEqual(upstream.test_error_collector.test_functions, 3);
  const by = new Map(upstream.synthetic_source_method_probe.cases.map(row => [row.case, row]));
  assert.deepStrictEqual(by.get("nonmultiple_length").output_shape, [3000, 12]);
  assert.strictEqual(by.get("infinite_sample").output_finite, false);
  assert.strictEqual(by.get("nan_sample").donor_status, "Failed");
  assert.strictEqual(upstream.full_upstream_pipeline_executed, false);
  assert.strictEqual(upstream.models_executed, false);
});
test("unacceptable truth tuning loading and input behavior remain rejected", () => {
  const by = new Map(gap.capabilities.map(row => [row.capability_id, row]));
  for (const id of ["D13-015", "D13-016", "D13-017", "D13-018", "D13-021", "D13-025", "D13-026", "D13-028", "D13-029", "D13-030", "D13-032", "D13-033", "D13-038", "D13-040"])
    assert.strictEqual(by.get(id).disposition, "REJECTED", id);
});
test("associated fork rename is explicit and not substituted for donor 009", () => {
  const assoc = read(base + "ASSOCIATED_REPOSITORY_DISPOSITIONS.json");
  const fork = assoc.repositories.find(row => row.registered_repository === "HeartWise-AI/fairseq-signals");
  assert.strictEqual(fork.resolved_repository, "HeartWise-AI/DeepECG-SSL-finetune");
  assert.strictEqual(fork.repository_id, "848017407");
  assert.strictEqual(fork.equivalence_to_Jwoo5_fairseq_signals_inferred, false);
  assert.ok(donorRegistry.donors.some(row => row.donor_id === "DONOR-A005" && row.repository === fork.resolved_repository));
  assert.ok(donorRegistry.donors.some(row => row.donor_id === "DONOR-A006" && row.repository === "HeartWise-AI/HeartWise_StatPlots"));
});
test("new suites are wired into CI and edge categories", () => {
  const pkg = read("package.json"), edges = read("ECG_EDGE_CASE_COVERAGE.json");
  for (const name of ["tests/probability_comparison.test.js", "tests/deepecg_docker_donor_closure.test.js"]) {
    assert.ok(pkg.scripts["test:ci"].includes(name));
    assert.ok(edges.categories.some(row => row.tests.includes(name)));
  }
});
test("model switch checkpoint cannot claim acceptance or advance frontier", () => {
  assert.strictEqual(donor.status, "IMPLEMENTED_UNVERIFIED");
  assert.strictEqual(donor.receipt_status, "PENDING");
  assert.strictEqual(donorRegistry.completed_donors, 12);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-013");
  assert.strictEqual(donor.target_main_ci_conclusion, undefined);
  const receipt = read(base + "DONOR_RECEIPT_DRAFT.json");
  assert.strictEqual(receipt.acceptance_state, "IMPLEMENTED_UNVERIFIED");
  assert.strictEqual(receipt.independent_verification, "NOT_PERFORMED");
  assert.strictEqual(receipt.promotion, "NOT_PERFORMED");
});
test("governed inactive invariants retained", () => {
  assert.strictEqual(donorRegistry.governed_clinical_state.diagnostic_runtime, "GOVERNED_INACTIVE");
  assert.strictEqual(donorRegistry.governed_clinical_state.evidence_admission, "NOT_ADMITTED");
  assert.strictEqual(donorRegistry.governed_clinical_state.approved_adjudicated_gold_count, 0);
  assert.strictEqual(donorRegistry.governed_clinical_state.metrics, "NOT_REPORTABLE");
  assert.strictEqual(donorRegistry.governed_clinical_state.activation, "NOT_ELIGIBLE");
  assert.strictEqual(canonical.capability_count, canonical.capabilities.length);
});
console.log(JSON.stringify({schema:"ekg-donor-013-closure-tests-v1",pass:true,passed,total:passed,acceptance:false,runtimeAuthority:false}));
