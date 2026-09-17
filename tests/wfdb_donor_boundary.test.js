const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  compareRecordShapes,
  inspectRecord,
  parseHeaderDetailed,
} = require("../lib/wfdb_signal");

const DONOR_PIN = "f627b5ff9dcfdb11d4c3150f9c1ebb47cfc3909d";

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

function header({
  record = "synthetic",
  leads = ["I", "II"],
  dataFiles = null,
  formats = null,
  gains = null,
  sampleRate = 500,
  samples = 4,
} = {}) {
  const files = dataFiles || leads.map(() => `${record}.dat`);
  const fmts = formats || leads.map(() => "16");
  const gainTokens = gains || leads.map(() => "1000(0)/mV");
  const lines = [`${record} ${leads.length} ${sampleRate} ${samples}`];
  for (let i = 0; i < leads.length; i += 1) {
    lines.push(
      `${files[i]} ${fmts[i]} ${gainTokens[i]} 16 0 0 0 0 ${leads[i]}`
    );
  }
  return lines.join("\n") + "\n";
}

function int16(values) {
  const out = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => out.writeInt16LE(value, index * 2));
  return out;
}

test("supported format-16 header has stable golden parse output", () => {
  assert.deepEqual(parseHeaderDetailed(header()), {
    record: "synthetic",
    leadCount: 2,
    sampleRate: 500,
    sampleCount: 4,
    durationSeconds: 0.008,
    signals: [
      {
        dataFile: "synthetic.dat",
        format: 16,
        gain: 1000,
        baseline: 0,
        unit: "mV",
        leadName: "I",
      },
      {
        dataFile: "synthetic.dat",
        format: 16,
        gain: 1000,
        baseline: 0,
        unit: "mV",
        leadName: "II",
      },
    ],
  });
});

test("sampling-frequency changes remain explicit and deterministic", () => {
  const a = parseHeaderDetailed(header({ sampleRate: 250 }));
  const b = parseHeaderDetailed(header({ sampleRate: 1000 }));
  assert.equal(a.sampleRate, 250);
  assert.equal(a.durationSeconds, 0.016);
  assert.equal(b.sampleRate, 1000);
  assert.equal(b.durationSeconds, 0.004);
});

test("calibration gain and baseline changes are preserved", () => {
  const parsed = parseHeaderDetailed(header({
    gains: ["200(10)/mV", "500(-25)/mV"],
  }));
  assert.deepEqual(
    parsed.signals.map(x => [x.gain, x.baseline, x.unit]),
    [[200, 10, "mV"], [500, -25, "mV"]]
  );
});

test("missing signal line fails closed", () => {
  assert.throws(
    () => parseHeaderDetailed(
      "synthetic 2 500 4\nsynthetic.dat 16 1000(0)/mV 16 0 0 0 0 I\n"
    ),
    /WFDB_SIGNAL_LINES_MISSING/
  );
});

test("duplicate lead fails closed", () => {
  assert.throws(
    () => parseHeaderDetailed(header({ leads: ["I", "I"] })),
    /WFDB_DUPLICATE_LEAD/
  );
});

test("lead-order changes are detectable by pair comparison", () => {
  const data = Buffer.alloc(16);
  const a = inspectRecord(header({ record: "a", leads: ["I", "II"] }), data, 2);
  const b = inspectRecord(header({ record: "b", leads: ["II", "I"] }), data, 2);
  assert.throws(() => compareRecordShapes(a, b), /WFDB_PAIR_LEAD_ORDER/);
});

test("truncated and oversized waveform buffers fail closed", () => {
  const h = header();
  assert.throws(() => inspectRecord(h, Buffer.alloc(14)), /WFDB_DATA_SIZE/);
  assert.throws(() => inspectRecord(h, Buffer.alloc(18)), /WFDB_DATA_SIZE/);
});

test("flatline waveform remains finite non-diagnostic engineering output", () => {
  const out = inspectRecord(
    header({ record: "flat", leads: ["I"], samples: 4 }),
    Buffer.alloc(8),
    2
  );
  assert.equal(out.diagnosticInterpretationIncluded, false);
  assert.equal(out.leads[0].summary.dynamicRange, 0);
  assert.equal(out.leads[0].summary.finite, true);
});

test("clipped int16 extremes are decoded deterministically", () => {
  const data = int16([-32768, 32767, -32768, 32767]);
  const out = inspectRecord(
    header({ record: "clip", leads: ["I"], samples: 4 }),
    data,
    2
  );
  assert.equal(out.leads[0].summary.min, -32.768);
  assert.equal(out.leads[0].summary.max, 32.767);
});

test("high-variation synthetic waveform is repeatable", () => {
  const data = int16([100, -200, 300, -400]);
  const h = header({ record: "vary", leads: ["I"], samples: 4 });
  assert.deepEqual(inspectRecord(h, data, 4), inspectRecord(h, data, 4));
});

test("unsupported WFDB encoding fails closed", () => {
  assert.throws(
    () => parseHeaderDetailed(header({ formats: ["212", "16"] })),
    /WFDB_FORMAT/
  );
  assert.throws(
    () => parseHeaderDetailed(header({ formats: ["16x2", "16"] })),
    /WFDB_FORMAT/
  );
});

test("path traversal and absolute signal paths fail closed", () => {
  assert.throws(
    () => parseHeaderDetailed(header({
      dataFiles: ["../synthetic.dat", "../synthetic.dat"],
    })),
    /WFDB_DATA_FILE/
  );
  assert.throws(
    () => parseHeaderDetailed(header({
      dataFiles: ["/tmp/synthetic.dat", "/tmp/synthetic.dat"],
    })),
    /WFDB_DATA_FILE/
  );
});

test("multiple signal data files fail as source substitution", () => {
  assert.throws(
    () => parseHeaderDetailed(header({
      dataFiles: ["synthetic.dat", "other.dat"],
    })),
    /WFDB_DATA_FILE_MULTIPLE/
  );
});

test("record-to-data-file mismatch fails as provenance mismatch", () => {
  assert.throws(
    () => parseHeaderDetailed(header({
      dataFiles: ["other.dat", "other.dat"],
    })),
    /WFDB_DATA_FILE_RECORD_MISMATCH/
  );
});

test("multi-segment and hostile record identifiers are unsupported", () => {
  assert.throws(
    () => parseHeaderDetailed(header({ record: "master/2" })),
    /WFDB_RECORD_ID/
  );
  assert.throws(
    () => parseHeaderDetailed(header({ record: "../escape" })),
    /WFDB_RECORD_ID/
  );
});

test("hostile lead metadata cannot escape the bounded token contract", () => {
  assert.throws(
    () => parseHeaderDetailed(header({ leads: ["I", "../../II"] })),
    /WFDB_LEAD_NAME/
  );
});

test("donor is audit-pinned but not a runtime dependency", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")
      .replace(/^\uFEFF/, "")
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname, "..", "donors", "mit-lcp_wfdb-python", "DONOR_MANIFEST.json"
      ),
      "utf8"
    )
  );
  assert.equal(manifest.audited_head.commit, DONOR_PIN);
  assert.equal(pkg.dependencies?.wfdb, undefined);
  assert.equal(pkg.devDependencies?.wfdb, undefined);
});

if (process.exitCode) {
  console.error(JSON.stringify({
    schema: "ekg-wfdb-donor-boundary-tests-v1",
    donor: "MIT-LCP/wfdb-python",
    donor_pin: DONOR_PIN,
    pass: false,
    passed,
  }));
  process.exit(process.exitCode);
}

console.log(JSON.stringify({
  schema: "ekg-wfdb-donor-boundary-tests-v1",
  donor: "MIT-LCP/wfdb-python",
  donor_pin: DONOR_PIN,
  pass: true,
  passed,
  total: passed,
  clinical_accuracy_claimed: false,
  diagnostic_runtime_authority_added: false,
}));
