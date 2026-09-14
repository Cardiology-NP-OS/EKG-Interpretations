const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSyntheticFixture } = require("./synthetic_fixture");
const { buildInspection, parseOutputArg } = require("../tools/inspect_signal");
const schema = require("../manifests/SOURCE_INSPECTION_SCHEMA.json");

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

test("inspection report is deterministic and explicitly non-diagnostic", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-inspection-"));
  const manifest = createSyntheticFixture(dir);
  const a = buildInspection(dir, manifest);
  const b = buildInspection(dir, manifest);
  assert.deepEqual(a, b);
  assert.equal(a.schema, "ekg-source-inspection-report-v1");
  assert.equal(a.clinicalAccuracyClaimed, false);
  assert.equal(a.diagnosticInterpretationIncluded, false);
  assert.equal(a.sourceFilesVerified, 5);
  assert.equal(a.records.lowRate.leads.length, 12);
  assert.equal(a.records.highRate.leads.length, 12);
  assert.equal(a.pairConsistency.sampleRateRatio, 5);
});

test("inspection report matches its declared required top-level keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-inspection-schema-"));
  const report = buildInspection(dir, createSyntheticFixture(dir));
  for (const key of schema.required) {
    assert.equal(Object.prototype.hasOwnProperty.call(report, key), true, key);
  }
});

test("inspection fails when source bytes drift", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-inspection-tamper-"));
  const manifest = createSyntheticFixture(dir);
  const target = path.join(dir, "00001_lr.dat");
  const bytes = fs.readFileSync(target);
  bytes[10] ^= 0xff;
  fs.writeFileSync(target, bytes);
  assert.throws(
    () => buildInspection(dir, manifest),
    /SOURCE_SHA256_MISMATCH:00001_lr\.dat/
  );
});

test("output argument parser is explicit and fail closed", () => {
  assert.equal(parseOutputArg([]), null);
  assert.equal(
    parseOutputArg(["--out", "report.json"]),
    path.resolve("report.json")
  );
  assert.throws(() => parseOutputArg(["--out"]), /OUTPUT_PATH_REQUIRED/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-inspection-report-tests-v1",
  pass: true,
  passed,
  total: passed,
  clinical_accuracy_claimed: false,
}));
