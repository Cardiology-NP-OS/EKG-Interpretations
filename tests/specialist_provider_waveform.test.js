"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const fx = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const config = require("../evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json");
const { dispatch } = require("../tools/specialist_provider");

const leads = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];

function fill(values, start, end, value) {
  for (let i = start; i <= end; i += 1) values[i] = value;
}

function buildFixture() {
  const samples = Array(fx.sampleCount).fill(0);
  const r = fx.relativeFiducials;
  const a = fx.amplitudesMv;
  for (const peak of fx.rPeaks) {
    fill(samples, peak + r.pOnset, peak + r.pOffset, a.p);
    samples[peak + r.pPeak] = a.pPeak;
    fill(samples, peak + r.qrsOnset, peak + r.qrsOffset, a.qrs);
    samples[peak] = a.rPeak;
    fill(samples, peak + r.tOnset, peak + r.tOffset, a.t);
    samples[peak + r.tPeak] = a.tPeak;
  }
  const record = "provider12";
  const header = [
    `${record} 12 ${fx.sampleRateHz} ${fx.sampleCount}`,
    ...leads.map(lead => `${record}.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`),
  ].join("\n") + "\n";
  const data = Buffer.alloc(12 * fx.sampleCount * 2);
  for (let i = 0; i < fx.sampleCount; i += 1) {
    for (let leadIndex = 0; leadIndex < 12; leadIndex += 1) {
      const value = leads[leadIndex] === "II" ? samples[i] : 0;
      data.writeInt16LE(Math.round(value * 1000), (i * 12 + leadIndex) * 2);
    }
  }
  return { header, data };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-provider-waveform-"));
const fixture = buildFixture();
const header = path.join(dir, "provider12.hea");
const data = path.join(dir, "provider12.dat");
const configPath = path.join(dir, "config.json");
const outDir = path.join(dir, "out");
fs.writeFileSync(header, fixture.header);
fs.writeFileSync(data, fixture.data);
fs.writeFileSync(configPath, JSON.stringify(config));
const out = dispatch({
  operation: "waveform_execute",
  args: {
    header,
    data,
    config: configPath,
    "source-id": "fixture:provider-waveform",
    "out-dir": outDir,
  },
});

assert.strictEqual(out.pass, true);
assert.strictEqual(out.analysisFile, "analysis.json");
assert.strictEqual(out.waveformFile, "waveform.svg");
assert.ok(/^[a-f0-9]{64}$/.test(out.renderingSha256));
assert.strictEqual(out.diagnosticRuntime, "GOVERNED_INACTIVE");
assert.strictEqual(out.runtimeAuthority, false);
assert.strictEqual(out.clinicalAuthorityAdded, false);
assert.strictEqual(fs.existsSync(path.join(outDir, "analysis.json")), true);
assert.strictEqual(fs.existsSync(path.join(outDir, "waveform.svg")), true);

console.log(JSON.stringify({
  schema: "ekg-specialist-provider-waveform-tests-v1",
  pass: true,
  syntheticOnly: true,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  clinicalAuthorityAdded: false,
}));
