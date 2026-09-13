const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const verifyModule = require("../tools/verify_source");
const { renderBlind } = require("../tools/render_blind");
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

test("historical V12 identity is reference-only", () => {
  assert.equal(baseline.identity_claim, "semantic-recovery-not-byte-identical");
  assert.equal(baseline.clinical_accuracy_claimed, false);
  assert.equal(baseline.adjudicated_clinical_gold_ecgs, 0);
  assert.equal(baseline.native_ptbxl_labels_are_project_gold, false);
});

test("PTB-XL record 00001 bytes and headers verify", () => {
  const result = verifyModule.verify();
  assert.equal(result.pass, true);
  assert.equal(result.evidence_tier, "engineering_harness_only");
  assert.equal(result.clinical_accuracy_claimed, false);
  assert.equal(Object.keys(result.hashes).length, 5);
  assert.equal(result.records.lr.sampleRate, 100);
  assert.equal(result.records.lr.samples, 1000);
  assert.equal(result.records.hr.sampleRate, 500);
  assert.equal(result.records.hr.samples, 5000);
});

test("paired records preserve the same canonical 12-lead order", () => {
  const { lr, hr } = verifyModule.verify().records;
  assert.equal(lr.leads, 12);
  assert.equal(hr.leads, 12);
  assert.deepEqual(lr.leadNames, hr.leadNames);
  assert.deepEqual(lr.leadNames, [
    "I","II","III","AVR","AVL","AVF","V1","V2","V3","V4","V5","V6"
  ]);
});

test("blinded render is deterministic and excludes record identity", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-render-"));
  const one = path.join(tmp, "one.svg");
  const two = path.join(tmp, "two.svg");
  const a = renderBlind(one);
  const b = renderBlind(two);
  assert.equal(a.pass, true);
  assert.equal(a.svg_sha256, b.svg_sha256);
  assert.equal(a.diagnostic_interpretation_included, false);
  assert.equal(a.record_identifier_included, false);
  const svg = fs.readFileSync(one, "utf8");
  assert.equal(svg.includes("00001"), false);
});

test("single-byte source tamper fails closed", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-source-"));
  for (const name of [
    "00001_lr.dat", "00001_lr.hea", "00001_hr.dat",
    "00001_hr.hea", "ptbxl_database.csv"
  ]) {
    fs.copyFileSync(path.join(verifyModule.DATA, name), path.join(tmp, name));
  }
  const target = path.join(tmp, "00001_lr.dat");
  const bytes = fs.readFileSync(target);
  bytes[0] ^= 0xff;
  fs.writeFileSync(target, bytes);
  const child = spawnSync(
    process.execPath,
    [path.join(ROOT, "tools", "verify_source.js")],
    { env: { ...process.env, EKG_PTBXL_RECORD_DIR: tmp }, encoding: "utf8" }
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SOURCE_SHA256_MISMATCH:00001_lr\.dat/);
});

if (process.exitCode) {
  console.error(JSON.stringify({
    schema: "ekg-recovery-test-results-v1",
    pass: false,
    passed,
  }));
  process.exit(process.exitCode);
}

console.log(JSON.stringify({
  schema: "ekg-recovery-test-results-v1",
  pass: true,
  passed,
  total: passed,
}));
