"use strict";

const assert = require("assert");
const {
  GEOMETRY_GOVERNANCE,
  deskewImage,
  estimateDeskewAngle,
  rotateArbitraryExpandedNearest,
  rotateArbitraryNearest,
} = require("../lib/image_geometry_normalization");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function gridFixture(size = 240, period = 20) {
  return Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) =>
      (x % period <= 1 || y % period <= 1) ? 0 : 255
    )
  );
}

test("arbitrary rotation is deterministic bounded grayscale", () => {
  const image = [[0, 255, 255], [255, 0, 255], [255, 255, 0]];
  assert.deepStrictEqual(rotateArbitraryNearest(image, { degrees: 0 }), image);
  const rotated = rotateArbitraryNearest(image, { degrees: 3 });
  assert.strictEqual(rotated.length, 3);
  assert.strictEqual(rotated[0].length, 3);
  assert.ok(rotated.flat().every(v => Number.isInteger(v) && v >= 0 && v <= 255));
  assert.throws(() => rotateArbitraryNearest(image, { degrees: 16 }), /IMAGE_GEOMETRY_DEGREES_LIMIT/);
});

test("expanded arbitrary rotation preserves full source support", () => {
  const image = [[0,255,255],[255,0,255],[255,255,0]];
  const rotated = rotateArbitraryExpandedNearest(image, { degrees: 10 });
  assert.ok(rotated.length > image.length);
  assert.ok(rotated[0].length > image[0].length);
  assert.ok(rotated.flat().includes(0));
});

test("projection deskew recovers a synthetic three-degree grid rotation", () => {
  const source = gridFixture();
  const skewed = rotateArbitraryNearest(source, { degrees: 3 });
  const estimate = estimateDeskewAngle(skewed, {
    maxAbsDegrees: 5,
    stepDegrees: 0.5,
    darkThreshold: 64,
  });
  assert.ok(Math.abs(estimate.correctionDegrees + 3) <= 0.5, JSON.stringify(estimate));
  assert.ok(estimate.score > estimate.zeroScore);
  assert.strictEqual(estimate.runtimeAuthority, false);
});

test("deskew applies the estimated correction while preserving canvas dimensions", () => {
  const source = gridFixture();
  const skewed = rotateArbitraryNearest(source, { degrees: -2.5 });
  const out = deskewImage(skewed, {
    maxAbsDegrees: 5,
    stepDegrees: 0.5,
    darkThreshold: 64,
  });
  assert.ok(Math.abs(out.appliedDegrees - 2.5) <= 0.5, JSON.stringify(out.estimate));
  assert.strictEqual(out.image.length, skewed.length);
  assert.strictEqual(out.image[0].length, skewed[0].length);
  const residual = estimateDeskewAngle(out.image, {
    maxAbsDegrees: 2,
    stepDegrees: 0.5,
    darkThreshold: 64,
  });
  assert.ok(Math.abs(residual.correctionDegrees) <= 0.5, JSON.stringify(residual));
});

test("blank or unsafe deskew searches fail closed", () => {
  const blank = Array.from({ length: 100 }, () => Array(100).fill(255));
  assert.throws(() => estimateDeskewAngle(blank), /IMAGE_DESKEW_INSUFFICIENT_INK/);
  assert.throws(
    () => estimateDeskewAngle(gridFixture(), { maxAbsDegrees: 11 }),
    /IMAGE_DESKEW_MAX_DEGREES/,
  );
  assert.throws(
    () => estimateDeskewAngle(gridFixture(), { stepDegrees: 0.1 }),
    /IMAGE_DESKEW_STEP/,
  );
});

test("geometry normalization remains nonclinical engineering", () => {
  assert.strictEqual(GEOMETRY_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(GEOMETRY_GOVERNANCE.projectGold, false);
  assert.strictEqual(GEOMETRY_GOVERNANCE.metrics, "NOT_REPORTABLE");
  assert.strictEqual(GEOMETRY_GOVERNANCE.diagnosticInterpretationIncluded, false);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-geometry-normalization-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  clinicalAuthorityAdded: false,
}));
