const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const { createSyntheticFixture, LEADS } = require("./synthetic_fixture");
const { verifyAt } = require("../tools/verify_source");
const { renderBlindAt } = require("../tools/render_blind");
const baseline = require("../manifests/V12_RECOVERED_BASELINE.json");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error}`);
    process.exitCode = 1;
  }
}

test("synthetic fixture verifies through the same source contract", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-ci-fixture-"));
  const manifest = createSyntheticFixture(dir);
  const result = verifyAt(dir, manifest);
  assert.equal(result.pass, true);
  assert.equal(result.records.lr.sampleRate, 100);
  assert.equal(result.records.hr.sampleRate, 500);
  assert.deepEqual(result.records.lr.leadNames, LEADS);
  assert.deepEqual(result.records.hr.leadNames, LEADS);
  assert.equal(manifest.clinical_data, false);
});

test("synthetic blind render is deterministic and non-diagnostic", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-ci-render-"));
  const manifest = createSyntheticFixture(dir);
  const one = renderBlindAt(dir, path.join(dir, "one.svg"), manifest);
  const two = renderBlindAt(dir, path.join(dir, "two.svg"), manifest);
  assert.equal(one.svg_sha256, two.svg_sha256);
  assert.equal(one.diagnostic_interpretation_included, false);
  assert.equal(one.record_identifier_included, false);
});

test("synthetic source tamper fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-ci-tamper-"));
  const manifest = createSyntheticFixture(dir);
  const target = path.join(dir, "00001_hr.dat");
  const bytes = fs.readFileSync(target);
  bytes[bytes.length - 1] ^= 0xff;
  fs.writeFileSync(target, bytes);
  assert.throws(
    () => verifyAt(dir, manifest),
    /SOURCE_SHA256_MISMATCH:00001_hr\.dat/
  );
});

test("header-shape drift fails even after checksum rebinding", () => {
  const crypto = require("crypto");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-ci-shape-"));
  const manifest = createSyntheticFixture(dir);
  const header = path.join(dir, "00001_lr.hea");
  fs.writeFileSync(
    header,
    fs.readFileSync(header, "utf8").replace(
      "00001_lr 12 100 1000",
      "00001_lr 12 125 1000"
    )
  );
  manifest.expected["00001_lr.hea"] = crypto
    .createHash("sha256").update(fs.readFileSync(header)).digest("hex");
  assert.throws(() => verifyAt(dir, manifest), /LR_SHAPE/);
});

test("missing synthetic source file fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-ci-missing-"));
  const manifest = createSyntheticFixture(dir);
  fs.unlinkSync(path.join(dir, "00001_hr.dat"));
  assert.throws(() => verifyAt(dir, manifest), /SOURCE_MISSING:00001_hr\.dat/);
});

test("full source gate is not silently downgraded when source is absent", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-no-source-"));
  const child = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools", "release_gate.js")],
    {
      cwd: ROOT,
      env: { ...process.env, EKG_PTBXL_RECORD_DIR: empty },
      encoding: "utf8",
    }
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SOURCE_MISSING:/);
});

test("CI preserves evidence and clinical-claim boundaries", () => {
  assert.equal(baseline.identity_claim, "semantic-recovery-not-byte-identical");
  assert.equal(baseline.clinical_accuracy_claimed, false);
  assert.equal(baseline.adjudicated_clinical_gold_ecgs, 0);
  assert.equal(baseline.native_ptbxl_labels_are_project_gold, false);
});

if (process.exitCode) {
  console.error(JSON.stringify({
    schema: "ekg-ci-contract-results-v1",
    pass: false,
    passed,
  }));
  process.exit(process.exitCode);
}

console.log(JSON.stringify({
  schema: "ekg-ci-contract-results-v1",
  pass: true,
  passed,
  total: passed,
  clinical_data_used: false,
  clinical_accuracy_claimed: false,
}));
