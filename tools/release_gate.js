const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { verify } = require("./verify_source");
const { renderBlind } = require("./render_blind");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED = [
  "README.md",
  "RECOVERY_PROVENANCE.md",
  "ATTRIBUTION_PTBXL.md",
  "manifests/V12_RECOVERED_BASELINE.json",
  "manifests/PTBXL_RECORD_00001.json",
  "docs/V12_EVIDENCE_SEMANTICS.md",
  "docs/V13_REAL_SIGNAL_EXECUTION.md",
  "tools/verify_source.js",
  "tools/render_blind.js",
  "tests/recovery.test.js",
];

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function gate() {
  for (const rel of REQUIRED) {
    requireCondition(fs.existsSync(path.join(ROOT, rel)), `REQUIRED_FILE_MISSING:${rel}`);
  }

  const baseline = require(path.join(ROOT, "manifests", "V12_RECOVERED_BASELINE.json"));
  requireCondition(
    baseline.identity_claim === "semantic-recovery-not-byte-identical",
    "RECOVERY_IDENTITY_BOUNDARY"
  );
  requireCondition(baseline.clinical_accuracy_claimed === false, "CLINICAL_CLAIM_BOUNDARY");
  requireCondition(baseline.adjudicated_clinical_gold_ecgs === 0, "GOLD_COUNT_BOUNDARY");
  requireCondition(
    baseline.native_ptbxl_labels_are_project_gold === false,
    "NATIVE_LABEL_BOUNDARY"
  );

  const source = verify();
  const tests = spawnSync(
    process.execPath,
    [path.join(ROOT, "tests", "recovery.test.js")],
    { cwd: ROOT, encoding: "utf8" }
  );
  requireCondition(tests.status === 0, "RECOVERY_TESTS_FAILED");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-gate-"));
  const rendered = renderBlind(path.join(tmp, "blind.svg"));
  requireCondition(rendered.pass === true, "BLIND_RENDER_FAILED");
  requireCondition(
    rendered.diagnostic_interpretation_included === false,
    "BLIND_RENDER_DIAGNOSTIC_CONTENT"
  );
  requireCondition(
    rendered.record_identifier_included === false,
    "BLIND_RENDER_IDENTITY_CONTENT"
  );

  return {
    schema: "ekg-recovery-release-gate-v1",
    pass: true,
    evidence_tier: "engineering_harness_only",
    clinical_accuracy_claimed: false,
    adjudicated_clinical_gold_ecgs: 0,
    source_files_verified: Object.keys(source.hashes).length,
    recovery_tests_passed: 5,
    blind_render_sha256: rendered.svg_sha256,
    historical_v12_identity_restored: false,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(gate(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schema: "ekg-recovery-release-gate-v1",
      pass: false,
      error: String(error.message || error),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = { gate };
