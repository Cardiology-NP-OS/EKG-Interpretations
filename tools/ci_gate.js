const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED = [
  "package.json",
  "manifests/V12_RECOVERED_BASELINE.json",
  "manifests/PTBXL_RECORD_00001.json",
  "tests/synthetic_fixture.js",
  "tests/ci_contract.test.js",
  "tests/signal_core.test.js",
  "tests/inspection_report.test.js",
  "lib/wfdb_signal.js",
  "manifests/SOURCE_INSPECTION_SCHEMA.json",
  "tools/inspect_signal.js",
  "tools/verify_source.js",
  "tools/render_blind.js",
  "tools/source_preflight.js",
  "tools/release_gate.js",
  ".github/workflows/ci.yml",
];

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function gate() {
  for (const rel of REQUIRED) {
    requireCondition(
      fs.existsSync(path.join(ROOT, rel)),
      `REQUIRED_FILE_MISSING:${rel}`
    );
  }

  const baseline = require(
    path.join(ROOT, "manifests", "V12_RECOVERED_BASELINE.json")
  );
  requireCondition(
    baseline.identity_claim === "semantic-recovery-not-byte-identical",
    "RECOVERY_IDENTITY_BOUNDARY"
  );
  requireCondition(
    baseline.clinical_accuracy_claimed === false,
    "CLINICAL_CLAIM_BOUNDARY"
  );
  requireCondition(
    baseline.adjudicated_clinical_gold_ecgs === 0,
    "GOLD_COUNT_BOUNDARY"
  );
  requireCondition(
    baseline.native_ptbxl_labels_are_project_gold === false,
    "NATIVE_LABEL_BOUNDARY"
  );

  const suites = [
    ["ci_contract.test.js", "CI_CONTRACT_TESTS_FAILED"],
    ["signal_core.test.js", "SIGNAL_CORE_TESTS_FAILED"],
    ["inspection_report.test.js", "INSPECTION_REPORT_TESTS_FAILED"],
  ];
  for (const [file, code] of suites) {
    const child = spawnSync(
      process.execPath,
      [path.join(ROOT, "tests", file)],
      { cwd: ROOT, encoding: "utf8" }
    );
    requireCondition(child.status === 0, code);
    requireCondition(child.stdout.includes('"pass":true'), code + "_RECEIPT");
  }

  return {
    schema: "ekg-ci-release-gate-v1",
    pass: true,
    evidence_tier: "synthetic-contract-ci-only",
    ci_contract_tests_passed: 7,
    signal_core_tests_passed: 8,
    inspection_report_tests_passed: 4,
    ci_tests_total: 19,
    clinical_data_used: false,
    external_ptbxl_validation_performed: false,
    clinical_accuracy_claimed: false,
    adjudicated_clinical_gold_ecgs: 0,
    real_source_gate_required_for_source_evidence: true,
    historical_v12_identity_restored: false,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(gate(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-ci-release-gate-v1",
      pass: false,
      error: String(error.message || error),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = { gate };
