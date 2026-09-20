"use strict";

const assert = require("assert");
const {
  GEOMETRY_GOVERNANCE,
  cropToContent,
  deskewImage,
  detectPerspectiveQuadrilateral,
  detectPerspectiveCorners,
  estimateDeskewAngle,
  projectRectangleToQuadrilateral,
  rectifyPerspective,
  rotateArbitraryExpandedInkPreserving,
  rotateArbitraryExpandedNearest,
  rotateArbitraryInkPreserving,
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

test("ink-preserving expanded rotation avoids long holes in a one-pixel trace", () => {
  const image = Array.from({ length: 80 }, () => Array(240).fill(255));
  for (let x = 10; x < 230; x += 1) image[40][x] = 0;
  const rotated = rotateArbitraryExpandedInkPreserving(image, { degrees: 3 });
  let maxMissingRun = 0;
  let current = 0;
  for (let x = 0; x < rotated[0].length; x += 1) {
    let hasInk = false;
    for (let y = 0; y < rotated.length; y += 1) {
      if (rotated[y][x] <= 80) { hasInk = true; break; }
    }
    if (hasInk) current = 0;
    else {
      current += 1;
      maxMissingRun = Math.max(maxMissingRun, current);
    }
  }
  // Outer white margins are expected; continuity is evaluated only between ink-bearing columns.
  const inkColumns = [];
  for (let x = 0; x < rotated[0].length; x += 1) {
    if (rotated.some(row => row[x] <= 80)) inkColumns.push(x);
  }
  assert.ok(inkColumns.length > 0);
  for (let x = inkColumns[0]; x <= inkColumns[inkColumns.length - 1]; x += 1) {
    assert.ok(rotated.some(row => row[x] <= 80), `missing ink column ${x}`);
  }
});

test("deskew resampling does not manufacture a three-column gap in a one-pixel trace", () => {
  const image = Array.from({ length: 120 }, () => Array(360).fill(255));
  for (let x = 20; x < 340; x += 1) image[60][x] = 0;
  const skewed = rotateArbitraryExpandedInkPreserving(image, { degrees: 3 });
  const recovered = rotateArbitraryInkPreserving(skewed, { degrees: -3 });
  const inkColumns = [];
  for (let x = 0; x < recovered[0].length; x += 1) {
    if (recovered.some(row => row[x] <= 80)) inkColumns.push(x);
  }
  assert.ok(inkColumns.length > 0);
  let gap = 0;
  let maxGap = 0;
  for (let x = inkColumns[0]; x <= inkColumns[inkColumns.length - 1]; x += 1) {
    if (recovered.some(row => row[x] <= 80)) gap = 0;
    else {
      gap += 1;
      maxGap = Math.max(maxGap, gap);
    }
  }
  assert.ok(maxGap <= 2, `max missing run ${maxGap}`);
});

test("content crop removes only deterministic white rotation padding", () => {
  const image = Array.from({ length: 10 }, () => Array(14).fill(255));
  for (let y = 2; y <= 7; y += 1) {
    for (let x = 3; x <= 10; x += 1) image[y][x] = 200;
  }
  const out = cropToContent(image, 250);
  assert.deepStrictEqual(out.bounds, { x: 3, y: 2, width: 8, height: 6, threshold: 250 });
  assert.strictEqual(out.image.length, 6);
  assert.strictEqual(out.image[0].length, 8);
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

test("deskew applies the estimated correction within the acquisition canvas", () => {
  const source = gridFixture();
  const skewed = rotateArbitraryExpandedInkPreserving(source, { degrees: -2.5 });
  const out = deskewImage(skewed, {
    maxAbsDegrees: 5,
    stepDegrees: 0.5,
    darkThreshold: 64,
  });
  assert.ok(Math.abs(out.appliedDegrees - 2.5) <= 0.5, JSON.stringify(out.estimate));
  assert.strictEqual(out.image.length, skewed.length);
  assert.strictEqual(out.image[0].length, skewed[0].length);
  assert.ok(out.image.flat().includes(0));
  const residual = estimateDeskewAngle(out.image, {
    maxAbsDegrees: 2,
    stepDegrees: 0.5,
    darkThreshold: 64,
  });
  assert.ok(Math.abs(residual.correctionDegrees) <= 0.5, JSON.stringify(residual));
});

test("automatic perspective detection recovers a synthetic trapezoid envelope", () => {
  const source = gridFixture(200, 20);
  const corners = {
    topLeft: { x: 28, y: 18 },
    topRight: { x: 286, y: 8 },
    bottomRight: { x: 304, y: 246 },
    bottomLeft: { x: 12, y: 236 },
  };
  const distorted = projectRectangleToQuadrilateral(source, {
    destinationCorners: corners,
    canvasWidth: 320,
    canvasHeight: 260,
  });
  const detected = detectPerspectiveCorners(distorted, {
    darkThreshold: 245,
    minAreaFraction: 0.2,
    minEdgeSupportFraction: 0.2,
    edgeTolerancePx: 5,
  });
  for (const key of ["topLeft","topRight","bottomRight","bottomLeft"]) {
    assert.ok(
      Math.hypot(
        detected.corners[key].x - corners[key].x,
        detected.corners[key].y - corners[key].y,
      ) <= 6,
      `${key}: ${JSON.stringify(detected.corners[key])}`,
    );
  }
  assert.ok(detected.areaFraction > 0.5);
  assert.ok(detected.edgeSupport.every(value => value >= 0.2));
  assert.strictEqual(detected.runtimeAuthority, false);
});

test("automatic perspective detection fails closed on blank or tiny support", () => {
  const blank = Array.from({ length: 120 }, () => Array(160).fill(255));
  assert.throws(
    () => detectPerspectiveCorners(blank),
    /IMAGE_PERSPECTIVE_DETECT_INSUFFICIENT_SUPPORT/,
  );

  const tiny = Array.from({ length: 120 }, () => Array(160).fill(255));
  for (let y = 50; y < 60; y += 1) {
    for (let x = 70; x < 90; x += 1) tiny[y][x] = 0;
  }
  assert.throws(
    () => detectPerspectiveCorners(tiny, { minAreaFraction: 0.2 }),
    /IMAGE_PERSPECTIVE_DETECT_AREA_TOO_SMALL|IMAGE_PERSPECTIVE_DETECT_AMBIGUOUS_CORNERS/,
  );
});

test("automatic perspective detector recovers a known synthetic trapezoid", () => {
  const source = gridFixture(200, 20);
  const corners = {
    topLeft: { x: 28, y: 18 },
    topRight: { x: 286, y: 8 },
    bottomRight: { x: 304, y: 246 },
    bottomLeft: { x: 12, y: 236 },
  };
  const distorted = projectRectangleToQuadrilateral(source, {
    destinationCorners: corners,
    canvasWidth: 320,
    canvasHeight: 260,
  });
  const detected = detectPerspectiveQuadrilateral(distorted, {
    darkThreshold: 245,
    minAreaFraction: 0.4,
  });
  for (const key of ["topLeft","topRight","bottomRight","bottomLeft"]) {
    const dx = detected.corners[key].x - corners[key].x;
    const dy = detected.corners[key].y - corners[key].y;
    assert.ok(Math.hypot(dx, dy) <= 8, `${key} error ${Math.hypot(dx,dy)}`);
  }
  assert.ok(detected.quadrilateralAreaFraction > 0.5);
  assert.ok(detected.sampledSupportPoints >= 500);
  assert.strictEqual(detected.automatic, true);
  assert.strictEqual(detected.runtimeAuthority, false);
});

test("automatic perspective detector fails closed on sparse or implausible support", () => {
  const blank = Array.from({ length: 120 }, () => Array(160).fill(255));
  blank[60][80] = 0;
  assert.throws(
    () => detectPerspectiveQuadrilateral(blank),
    /IMAGE_PERSPECTIVE_DETECT_INSUFFICIENT_SUPPORT/,
  );

  const stripe = Array.from({ length: 120 }, () => Array(160).fill(255));
  for (let y = 10; y < 110; y += 1) {
    for (let x = 78; x <= 82; x += 1) stripe[y][x] = 0;
  }
  assert.throws(
    () => detectPerspectiveQuadrilateral(stripe, { minSupportPixels: 300 }),
    /IMAGE_PERSPECTIVE_DEGENERATE|IMAGE_PERSPECTIVE_NONCONVEX|IMAGE_PERSPECTIVE_DETECT_IMPLAUSIBLE_AREA/,
  );
});

test("explicit quadrilateral rectification recovers a synthetic trapezoid", () => {
  const source = gridFixture(200, 20);
  const corners = {
    topLeft: { x: 28, y: 18 },
    topRight: { x: 286, y: 8 },
    bottomRight: { x: 304, y: 246 },
    bottomLeft: { x: 12, y: 236 },
  };
  const distorted = projectRectangleToQuadrilateral(source, {
    destinationCorners: corners,
    canvasWidth: 320,
    canvasHeight: 260,
  });
  const rectified = rectifyPerspective(distorted, {
    corners,
    outputWidth: 200,
    outputHeight: 200,
  });
  assert.strictEqual(rectified.image.length, 200);
  assert.strictEqual(rectified.image[0].length, 200);
  assert.strictEqual(rectified.method, "EXPLICIT_QUADRILATERAL_HOMOGRAPHY_DARK_SUPPORT_3X3");
  const residual = estimateDeskewAngle(rectified.image, {
    maxAbsDegrees: 2,
    stepDegrees: 0.5,
    darkThreshold: 64,
  });
  assert.ok(Math.abs(residual.correctionDegrees) <= 0.5, JSON.stringify(residual));
  assert.strictEqual(rectified.runtimeAuthority, false);
});

test("perspective rectification rejects degenerate or out-of-bounds quadrilaterals", () => {
  const source = gridFixture(100, 20);
  assert.throws(() => rectifyPerspective(source, {
    corners: {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 99, y: 0 },
      bottomRight: { x: 99, y: 0 },
      bottomLeft: { x: 0, y: 99 },
    },
    outputWidth: 100,
    outputHeight: 100,
  }), /IMAGE_PERSPECTIVE_DEGENERATE|IMAGE_PERSPECTIVE_NONCONVEX/);
  assert.throws(() => rectifyPerspective(source, {
    corners: {
      topLeft: { x: -1, y: 0 },
      topRight: { x: 99, y: 0 },
      bottomRight: { x: 99, y: 99 },
      bottomLeft: { x: 0, y: 99 },
    },
    outputWidth: 100,
    outputHeight: 100,
  }), /IMAGE_PERSPECTIVE_POINT_BOUNDS/);
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
