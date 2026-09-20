"use strict";

const assert = require("assert");
const { estimateTraceBaseline, BASELINE_GOVERNANCE } = require("../lib/image_baseline_estimation");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

test("dominant trace row verifies a stable synthetic baseline", () => {
  const ys = [];
  for (let i = 0; i < 200; i += 1) ys.push(100);
  for (let i = 0; i < 20; i += 1) ys.push(94 + (i % 13));
  const out = estimateTraceBaseline({
    ys,
    roi: { y: 60, height: 80 },
    pxPerMm: 5,
  });
  assert.strictEqual(out.baselineY, 100);
  assert.strictEqual(out.verified, true);
  assert.ok(out.inlierFraction > 0.8);
  assert.ok(out.dominantFraction > 0.8);
  assert.strictEqual(out.runtimeAuthority, false);
});

test("bimodal trace rows do not qualify as a verified baseline", () => {
  const ys = [];
  for (let i = 0; i < 80; i += 1) ys.push(85);
  for (let i = 0; i < 80; i += 1) ys.push(115);
  const out = estimateTraceBaseline({
    ys,
    roi: { y: 60, height: 80 },
    pxPerMm: 5,
  });
  assert.strictEqual(out.verified, false);
  assert.ok(out.inlierFraction < 0.55);
});

test("insufficient observed columns fail closed", () => {
  assert.throws(() => estimateTraceBaseline({
    ys: Array(20).fill(100),
    roi: { y: 60, height: 80 },
    pxPerMm: 5,
  }), /BASELINE_INSUFFICIENT_OBSERVED_COLUMNS/);
});

test("baseline estimator remains governed inactive", () => {
  assert.strictEqual(BASELINE_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(BASELINE_GOVERNANCE.projectGold, false);
  assert.strictEqual(BASELINE_GOVERNANCE.metrics, "NOT_REPORTABLE");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-baseline-estimation-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  clinicalAuthorityAdded: false,
}));
