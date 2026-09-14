const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSyntheticFixture, LEADS } = require("./synthetic_fixture");
const {
  compareRecordShapes,
  decodeInt16Interleaved,
  inspectRecord,
  parseGainToken,
  parseHeaderDetailed,
  summarize,
  toPhysical,
  uniformPreview,
} = require("../lib/wfdb_signal");

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

test("gain token parses WFDB gain baseline and unit", () => {
  assert.deepEqual(parseGainToken("1000.0(0)/mV"), {
    gain: 1000,
    baseline: 0,
    unit: "mV",
  });
});

test("interleaved int16 decoding preserves lead/sample order", () => {
  const buffer = Buffer.alloc(12);
  [1,10,2,20,3,30].forEach((value, index) =>
    buffer.writeInt16LE(value, index * 2)
  );
  assert.deepEqual(decodeInt16Interleaved(buffer, 2, 3), [
    [1,2,3],
    [10,20,30],
  ]);
});

test("physical conversion respects gain and baseline", () => {
  assert.equal(toPhysical(1500, 1000, 500), 1);
  assert.equal(toPhysical(-500, 1000, 0), -0.5);
});

test("synthetic headers preserve 12 leads and ten-second duration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-core-header-"));
  createSyntheticFixture(dir);
  const lr = parseHeaderDetailed(fs.readFileSync(path.join(dir, "00001_lr.hea"), "utf8"));
  const hr = parseHeaderDetailed(fs.readFileSync(path.join(dir, "00001_hr.hea"), "utf8"));
  assert.equal(lr.leadCount, 12);
  assert.equal(hr.leadCount, 12);
  assert.equal(lr.durationSeconds, 10);
  assert.equal(hr.durationSeconds, 10);
  assert.deepEqual(lr.signals.map(s => s.leadName), LEADS);
  assert.deepEqual(hr.signals.map(s => s.leadName), LEADS);
});

test("record inspection produces deterministic non-diagnostic lead summaries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-core-inspect-"));
  createSyntheticFixture(dir);
  const header = fs.readFileSync(path.join(dir, "00001_lr.hea"), "utf8");
  const data = fs.readFileSync(path.join(dir, "00001_lr.dat"));
  const a = inspectRecord(header, data, 9);
  const b = inspectRecord(header, data, 9);
  assert.deepEqual(a, b);
  assert.equal(a.diagnosticInterpretationIncluded, false);
  assert.equal(a.leads.length, 12);
  assert.equal(a.leads[0].summary.count, 1000);
  assert.equal(a.leads[0].preview.length, 9);
});

test("100 and 500 Hz inspections bind the same leads and duration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-core-pair-"));
  createSyntheticFixture(dir);
  const lr = inspectRecord(
    fs.readFileSync(path.join(dir, "00001_lr.hea"), "utf8"),
    fs.readFileSync(path.join(dir, "00001_lr.dat"))
  );
  const hr = inspectRecord(
    fs.readFileSync(path.join(dir, "00001_hr.hea"), "utf8"),
    fs.readFileSync(path.join(dir, "00001_hr.dat"))
  );
  assert.deepEqual(compareRecordShapes(lr, hr), {
    leadCount: 12,
    durationSeconds: 10,
    sampleRateRatio: 5,
    sameLeadOrder: true,
  });
});

test("summary and preview are deterministic bounded engineering outputs", () => {
  assert.deepEqual(summarize([-1, 0, 1]), {
    count: 3, min: -1, max: 1, mean: 0,
    rms: 0.816496580928, dynamicRange: 2, finite: true,
  });
  assert.deepEqual(uniformPreview([0,1,2,3,4], 3), [0,2,4]);
});

test("malformed data size and gain fail closed", () => {
  assert.throws(
    () => decodeInt16Interleaved(Buffer.alloc(10), 2, 3),
    /WFDB_DATA_SIZE/
  );
  assert.throws(() => parseGainToken("0(0)/mV"), /WFDB_GAIN/);
  assert.throws(() => parseGainToken("bogus"), /WFDB_GAIN_TOKEN/);
});

if (process.exitCode) {
  console.error(JSON.stringify({
    schema: "ekg-signal-core-tests-v1",
    pass: false,
    passed,
  }));
  process.exit(process.exitCode);
}

console.log(JSON.stringify({
  schema: "ekg-signal-core-tests-v1",
  pass: true,
  passed,
  total: passed,
  diagnostic_interpretation_tested: false,
}));
