"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const fixture = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const { runWaveformMeasurementPipeline } = require("../lib/signal_measurement_pipeline");
const { parseArgs, sha256 } = require("../tools/measure_wfdb");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function fill(samples, start, end, value) {
  for (let i = start; i <= end; i += 1) samples[i] = value;
}

function syntheticWfdb() {
  const samples = Array(fixture.sampleCount).fill(fixture.baseline);
  const rel = fixture.relativeFiducials;
  const amp = fixture.amplitudesMv;
  fixture.rPeaks.forEach(rPeak => {
    fill(samples, rPeak + rel.pOnset, rPeak + rel.pOffset, amp.p);
    samples[rPeak + rel.pPeak] = amp.pPeak;
    fill(samples, rPeak + rel.qrsOnset, rPeak + rel.qrsOffset, amp.qrs);
    samples[rPeak] = amp.rPeak;
    fill(samples, rPeak + rel.tOnset, rPeak + rel.tOffset, amp.t);
    samples[rPeak + rel.tPeak] = amp.tPeak;
  });
  const header = `synthetic 1 ${fixture.sampleRateHz} ${fixture.sampleCount}\n` +
    `synthetic.dat 16 1000.0(0)/mV 16 0 0 0 0 ${fixture.lead}\n`;
  const data = Buffer.alloc(fixture.sampleCount * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(value * 1000), i * 2));
  return { header, data };
}

function workflowConfig() {
  return {
    detector: { minAbsoluteDeviation: 0.9, refractoryMs: 200 },
    delineation: JSON.parse(JSON.stringify(fixture.config)),
  };
}

const provenance = {
  sourceKind: "SYNTHETIC_FIXTURE",
  locator: "ECG-FIXTURE-SYNTHETIC-FIDUCIAL-DELINEATION-V1",
};
test("pipeline composes raw WFDB through candidate delineation and measurements", () => {
  const fx = syntheticWfdb();
  const out = runWaveformMeasurementPipeline({
    headerText: fx.header,
    dataBuffer: fx.data,
    leadName: fixture.lead,
    config: workflowConfig(),
    provenance,
  });
  assert.strictEqual(out.candidateRPeaks.events.length, 4);
  assert.strictEqual(out.candidateFiducials.beats.length, 4);
  assert.deepStrictEqual(out.coverage, {beats:4,pWaveCandidates:4,qrsCandidates:4,tWaveCandidates:4});
  const byMetric = new Map(out.intervalMeasurements.measurements.map(x => [x.metric, x.value]));
  assert.strictEqual(byMetric.get("pr"), fixture.expectedMeasurements.prMs);
  assert.strictEqual(byMetric.get("qrs"), fixture.expectedMeasurements.qrsMs);
  assert.strictEqual(byMetric.get("qt"), fixture.expectedMeasurements.qtMs);
  assert.strictEqual(byMetric.get("rr"), fixture.expectedMeasurements.rrMs);
  assert.strictEqual(byMetric.get("ventricular_rate"), fixture.expectedMeasurements.ventricularRateBpm);
});

test("pipeline emits calibrated fiducial amplitudes without diagnosis", () => {
  const fx = syntheticWfdb();
  const out = runWaveformMeasurementPipeline({headerText:fx.header,dataBuffer:fx.data,leadName:fixture.lead,config:workflowConfig(),provenance});
  assert.strictEqual(out.amplitudeMeasurements.length, 16);
  assert.ok(out.amplitudeMeasurements.some(x => x.fiducial === "R_PEAK" && x.value === 1.2));
  assert.strictEqual(out.diagnosticInterpretationIncluded, false);
  assert.strictEqual(out.runtimeAuthority, false);
});
test("CLI processes local WFDB files and writes a path-minimized artifact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-measure-workflow-"));
  const fx = syntheticWfdb();
  const headerPath = path.join(dir, "synthetic.hea");
  const dataPath = path.join(dir, "synthetic.dat");
  const configPath = path.join(dir, "config.json");
  const outPath = path.join(dir, "measurement.json");
  fs.writeFileSync(headerPath, fx.header, "utf8");
  fs.writeFileSync(dataPath, fx.data);
  fs.writeFileSync(configPath, JSON.stringify(workflowConfig()), "utf8");
  const cli = spawnSync(process.execPath, [path.join(__dirname,"..","tools","measure_wfdb.js"),
    "--header",headerPath,"--data",dataPath,"--lead",fixture.lead,
    "--config",configPath,"--source-id","synthetic-workflow-001","--out",outPath], {encoding:"utf8"});
  assert.strictEqual(cli.status, 0, cli.stderr);
  const artifact = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.strictEqual(artifact.sourceFiles.headerSha256, sha256(Buffer.from(fx.header,"utf8")));
  assert.strictEqual(artifact.sourceFiles.dataSha256, sha256(fx.data));
  assert.strictEqual(artifact.sourceFiles.pathsEmbedded, false);
  assert.strictEqual(artifact.provenance.locator, "synthetic-workflow-001");
  const text = JSON.stringify(artifact);
  assert.strictEqual(text.includes(headerPath), false);
  assert.strictEqual(text.includes(dataPath), false);
});
test("workflow fails closed when no R-peak candidates are present", () => {
  const fx = syntheticWfdb();
  const config = workflowConfig();
  config.detector.minAbsoluteDeviation = 99;
  assert.throws(() => runWaveformMeasurementPipeline({
    headerText:fx.header,dataBuffer:fx.data,leadName:fixture.lead,config,provenance,
  }), /PIPELINE_NO_RPEAK_CANDIDATES/);
});

test("workflow fails closed for unknown lead", () => {
  const fx = syntheticWfdb();
  assert.throws(() => runWaveformMeasurementPipeline({
    headerText:fx.header,dataBuffer:fx.data,leadName:"V9",config:workflowConfig(),provenance,
  }), /MEASURE_LEAD_NOT_FOUND/);
});

test("CLI requires explicit source identity and configuration", () => {
  assert.throws(() => parseArgs(["--header","a.hea","--data","a.dat","--lead","II","--config","c.json"]), /source-id/);
  assert.throws(() => parseArgs(["--header","a.hea","--data","a.dat","--lead","II","--source-id","x"]), /config/);
});

test("workflow artifact cannot claim clinical authority", () => {
  const fx = syntheticWfdb();
  const out = runWaveformMeasurementPipeline({headerText:fx.header,dataBuffer:fx.data,leadName:fixture.lead,config:workflowConfig(),provenance});
  const text = JSON.stringify(out).toLowerCase();
  assert.strictEqual(text.includes('"diagnosis"'), false);
  assert.strictEqual(out.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(out.evidenceAdmission, "NOT_ADMITTED");
  assert.strictEqual(out.metrics, "NOT_REPORTABLE");
  assert.strictEqual(out.activation, "NOT_ELIGIBLE");
});
if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-signal-measurement-workflow-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  realWorkflowSurfaceTested: true,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  metrics: "NOT_REPORTABLE",
  clinicalAuthorityAdded: false,
}));
