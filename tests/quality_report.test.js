const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSyntheticFixture } = require("./synthetic_fixture");
const { buildQualityReport, parseOutputArg } = require("../tools/quality_report");
const schema = require("../manifests/SIGNAL_QUALITY_SCHEMA.json");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

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

test("quality report is deterministic and non-diagnostic", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-quality-report-"));
  const manifest = createSyntheticFixture(dir);
  const a = buildQualityReport(dir, manifest);
  const b = buildQualityReport(dir, manifest);
  assert.deepEqual(a, b);
  assert.equal(a.schema, "ekg-signal-quality-report-v1");
  assert.equal(a.usableForEngineeringInspection, true);
  assert.equal(a.unusableLeadCount, 0);
  assert.equal(a.sourceFilesVerified, 5);
  assert.equal(a.clinicalAccuracyClaimed, false);
  assert.equal(a.diagnosticInterpretationIncluded, false);
});

test("quality report contains every required top-level schema field", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-quality-schema-"));
  const report = buildQualityReport(dir, createSyntheticFixture(dir));
  for (const key of schema.required) {
    assert.equal(Object.prototype.hasOwnProperty.call(report, key), true, key);
  }
});

test("checksum-rebound flatline remains unusable by QC", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-quality-flatline-"));
  const manifest = createSyntheticFixture(dir);
  const target = path.join(dir, "00001_lr.dat");
  fs.writeFileSync(target, Buffer.alloc(12 * 1000 * 2));
  manifest.expected["00001_lr.dat"] = sha256(target);
  const report = buildQualityReport(dir, manifest);
  assert.equal(report.records.lowRate.unusableLeadCount, 12);
  assert.equal(report.records.lowRate.usableForEngineeringInspection, false);
  assert.equal(report.usableForEngineeringInspection, false);
  for (const lead of report.records.lowRate.leads) {
    assert.deepEqual(lead.flags, ["ALL_SAMPLES_IDENTICAL"]);
  }
});

test("source drift still fails before QC when checksum is not rebound", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-quality-tamper-"));
  const manifest = createSyntheticFixture(dir);
  const target = path.join(dir, "00001_hr.dat");
  const bytes = fs.readFileSync(target);
  bytes[0] ^= 0xff;
  fs.writeFileSync(target, bytes);
  assert.throws(
    () => buildQualityReport(dir, manifest),
    /SOURCE_SHA256_MISMATCH:00001_hr\.dat/
  );
});

test("output parser is explicit and fail closed", () => {
  assert.equal(parseOutputArg([]), null);
  assert.equal(parseOutputArg(["--out", "qc.json"]), path.resolve("qc.json"));
  assert.throws(() => parseOutputArg(["--out"]), /OUTPUT_PATH_REQUIRED/);
});

if (process.exitCode) process.exit(process.exitCode);

console.log(JSON.stringify({
  schema: "ekg-signal-quality-report-tests-v1",
  pass: true,
  passed,
  total: passed,
  clinical_accuracy_claimed: false,
  diagnostic_interpretation_included: false,
}));
