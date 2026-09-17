"use strict";
const assert = require("assert");
const {
  TRANSFORM_GOVERNANCE,
  applyFilter,
  assessArtifacts,
  movingAverage,
  normalizeAmplitude,
  removeBaseline,
  transformLeadForEngineering,
} = require("../lib/signal_transformations");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
function closeArray(actual, expected, tolerance = 1e-12) {
  assert.strictEqual(actual.length, expected.length);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance, `${index}:${value}`));
}

test("transform governance remains nonclinical engineering", () => {
  assert.strictEqual(TRANSFORM_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(TRANSFORM_GOVERNANCE.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(TRANSFORM_GOVERNANCE.metrics, "NOT_REPORTABLE");
});
test("mean and median baseline removal are deterministic", () => {
  closeArray(removeBaseline([1,2,3,4], {method:"subtract-mean-v1"}).samples, [-1.5,-0.5,0.5,1.5]);
  closeArray(removeBaseline([1,2,100], {method:"subtract-median-v1"}).samples, [-1,0,98]);
});
test("moving-average baseline subtraction is explicit", () => {
  const out = removeBaseline([0,1,2,3,4], {method:"moving-average-subtraction-v1",windowSamples:3});
  closeArray(out.samples, [-0.5,0,0,0,0.5]);
});
test("moving-average filtering executes with bounded edges", () => {
  closeArray(movingAverage([0,3,6], 3), [1.5,3,4.5]);
  closeArray(applyFilter([0,3,6], {method:"moving-average-v1",windowSamples:3}).samples, [1.5,3,4.5]);
});
test("z-score normalization is real and unitless", () => {
  const out = normalizeAmplitude([1,2,3], {method:"zscore-v1"});
  assert.strictEqual(out.outputUnit, "standardized");
  assert.ok(Math.abs(out.samples.reduce((a,b)=>a+b,0)) < 1e-12);
});
test("median MAD normalization is robust to a large outlier", () => {
  const out = normalizeAmplitude([1,2,3,100], {method:"median-mad-v1"});
  assert.strictEqual(out.outputUnit, "mad-normalized");
  assert.strictEqual(out.center, 2.5);
  assert.strictEqual(out.scale, 1);
});
test("artifact assessment reports without silent repair", () => {
  const out = assessArtifacts([0,1,5,1,0], {maxStep:2,clipMin:-10,clipMax:4});
  assert.strictEqual(out.stepViolations, 2);
  assert.strictEqual(out.aboveClip, 1);
  assert.strictEqual(out.repairApplied, false);
  assert.strictEqual(out.artifactObserved, true);
});
test("invalid artifact bounds fail closed", () => {
  assert.throws(() => assessArtifacts([1,2], {clipMin:3,clipMax:2}), /TRANSFORM_CLIP_RANGE_INVALID/);
});
test("zero-scale normalization fails closed", () => {
  assert.throws(() => normalizeAmplitude([2,2,2], {method:"zscore-v1"}), /TRANSFORM_NORMALIZATION_ZERO_SCALE/);
  assert.throws(() => normalizeAmplitude([2,2,2], {method:"median-mad-v1"}), /TRANSFORM_NORMALIZATION_ZERO_SCALE/);
});
test("nonfinite samples fail closed before any transform", () => {
  assert.throws(() => transformLeadForEngineering([1,NaN,2], {}), /TRANSFORM_NONFINITE_SAMPLE/);
});
test("unknown transform methods fail closed", () => {
  assert.throws(() => removeBaseline([1,2,3], {method:"magic"}), /TRANSFORM_BASELINE_METHOD_UNIMPLEMENTED/);
  assert.throws(() => applyFilter([1,2,3], {method:"magic"}), /TRANSFORM_FILTER_METHOD_UNIMPLEMENTED/);
  assert.throws(() => normalizeAmplitude([1,2,3], {method:"magic"}), /TRANSFORM_NORMALIZATION_METHOD_UNIMPLEMENTED/);
});
test("composed engineering transform is deterministic and provenance-neutral", () => {
  const config = {
    inputUnit:"mV",
    artifacts:{maxStep:10},
    baseline:{method:"subtract-median-v1"},
    filter:{method:"moving-average-v1",windowSamples:3},
    normalization:{method:"zscore-v1"},
  };
  const one = transformLeadForEngineering([0,1,2,1,0], config);
  const two = transformLeadForEngineering([0,1,2,1,0], config);
  assert.deepStrictEqual(one, two);
  assert.strictEqual(one.outputUnit, "standardized");
  assert.strictEqual(one.originalSamplesPreservedExternally, true);
  assert.strictEqual(one.runtimeAuthority, false);
  assert.strictEqual(JSON.stringify(one).toLowerCase().includes('"diagnosis"'), false);
});
test("identity transform preserves calibrated values and unit", () => {
  const out = transformLeadForEngineering([0.1,-0.2,0.3], {inputUnit:"mV"});
  closeArray(out.samples,[0.1,-0.2,0.3]);
  assert.strictEqual(out.outputUnit,"mV");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-signal-transformations-tests-v1",
  pass:true, passed, total:passed,
  syntheticOnly:true,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  clinicalAuthorityAdded:false,
}));
