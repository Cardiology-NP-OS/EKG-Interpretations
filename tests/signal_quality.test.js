const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSyntheticFixture } = require("./synthetic_fixture");
const {
  analyzeRawLead,
  inspectSignalQuality,
  longestConstantRun,
} = require("../lib/signal_quality");

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

test("longest constant run is exact", () => {
  assert.equal(longestConstantRun([1,1,2,2,2,3,3]), 3);
  assert.equal(longestConstantRun([7]), 1);
});

test("normal varying raw lead has no fatal engineering flags", () => {
  const result = analyzeRawLead([-3,-2,-1,0,1,2,3]);
  assert.deepEqual(result.flags, []);
  assert.equal(result.usableForEngineeringInspection, true);
  assert.equal(result.rawSpan, 6);
  assert.equal(result.distinctSampleCount, 7);
});

test("exact flatline is detected without diagnostic interpretation", () => {
  const result = analyzeRawLead([5,5,5,5]);
  assert.deepEqual(result.flags, ["ALL_SAMPLES_IDENTICAL"]);
  assert.equal(result.usableForEngineeringInspection, false);
  assert.equal(result.longestConstantRun, 4);
});

test("ADC rail hits are surfaced exactly", () => {
  const result = analyzeRawLead([-32768, 0, 32767]);
  assert.deepEqual(result.flags, ["ADC_RAIL_HIT"]);
  assert.equal(result.adcRailHitCount, 2);
  assert.equal(result.usableForEngineeringInspection, false);
});

test("synthetic record passes engineering QC", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-qc-"));
  createSyntheticFixture(dir);
  const report = inspectSignalQuality(
    fs.readFileSync(path.join(dir, "00001_lr.hea"), "utf8"),
    fs.readFileSync(path.join(dir, "00001_lr.dat"))
  );
  assert.equal(report.leadCount, 12);
  assert.equal(report.unusableLeadCount, 0);
  assert.equal(report.usableForEngineeringInspection, true);
  assert.equal(report.diagnosticInterpretationIncluded, false);
  assert.equal(report.clinicalAccuracyClaimed, false);
});

test("non-integer samples fail closed", () => {
  assert.throws(() => analyzeRawLead([0, 1.5, 2]), /QC_RAW_SAMPLE/);
});

if (process.exitCode) process.exit(process.exitCode);

console.log(JSON.stringify({
  schema: "ekg-signal-quality-tests-v1",
  pass: true,
  passed,
  total: passed,
  clinical_accuracy_claimed: false,
  diagnostic_interpretation_included: false,
}));
