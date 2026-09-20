"use strict";

const { cropImage, normalizeImage } = require("./image_robustness");

const GEOMETRY_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function rotateArbitraryNearest(image, options = {}) {
  const source = normalizeImage(image);
  const degrees = options.degrees;
  const fill = options.fill === undefined ? 255 : options.fill;
  requireCondition(typeof degrees === "number" && Number.isFinite(degrees), "IMAGE_GEOMETRY_DEGREES");
  requireCondition(Math.abs(degrees) <= 15, "IMAGE_GEOMETRY_DEGREES_LIMIT");
  requireCondition(Number.isInteger(fill) && fill >= 0 && fill <= 255, "IMAGE_GEOMETRY_FILL");

  const h = source.length;
  const w = source[0].length;
  if (degrees === 0) return source.map(row => row.slice());

  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const dx = x - cx;
      const dy = y - cy;
      const sx = c * dx + s * dy + cx;
      const sy = -s * dx + c * dy + cy;
      const ix = Math.round(sx);
      const iy = Math.round(sy);
      return ix >= 0 && ix < w && iy >= 0 && iy < h ? source[iy][ix] : fill;
    })
  );
}

function rotateArbitraryInkPreserving(image, options = {}) {
  const source = normalizeImage(image);
  const degrees = options.degrees;
  const fill = options.fill === undefined ? 255 : options.fill;
  requireCondition(typeof degrees === "number" && Number.isFinite(degrees), "IMAGE_GEOMETRY_DEGREES");
  requireCondition(Math.abs(degrees) <= 15, "IMAGE_GEOMETRY_DEGREES_LIMIT");
  requireCondition(Number.isInteger(fill) && fill >= 0 && fill <= 255, "IMAGE_GEOMETRY_FILL");

  const h = source.length;
  const w = source[0].length;
  if (degrees === 0) return source.map(row => row.slice());

  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      const dx = x - cx;
      const dy = y - cy;
      const sx = c * dx + s * dy + cx;
      const sy = -s * dx + c * dy + cy;
      const centerX = Math.round(sx);
      const centerY = Math.round(sy);
      let value = fill;
      let found = false;
      for (let iy = centerY - 1; iy <= centerY + 1; iy += 1) {
        for (let ix = centerX - 1; ix <= centerX + 1; ix += 1) {
          if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
          value = Math.min(value, source[iy][ix]);
          found = true;
        }
      }
      return found ? value : fill;
    })
  );
}

function rotateArbitraryExpandedNearest(image, options = {}) {
  const source = normalizeImage(image);
  const degrees = options.degrees;
  const fill = options.fill === undefined ? 255 : options.fill;
  requireCondition(typeof degrees === "number" && Number.isFinite(degrees), "IMAGE_GEOMETRY_DEGREES");
  requireCondition(Math.abs(degrees) <= 15, "IMAGE_GEOMETRY_DEGREES_LIMIT");
  requireCondition(Number.isInteger(fill) && fill >= 0 && fill <= 255, "IMAGE_GEOMETRY_FILL");

  const srcH = source.length;
  const srcW = source[0].length;
  if (degrees === 0) return source.map(row => row.slice());

  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const width = Math.ceil(Math.abs(srcW * c) + Math.abs(srcH * s));
  const height = Math.ceil(Math.abs(srcH * c) + Math.abs(srcW * s));
  requireCondition(width <= 5000 && height <= 5000, "IMAGE_GEOMETRY_EXPANDED_DIMENSIONS");

  const srcCx = (srcW - 1) / 2;
  const srcCy = (srcH - 1) / 2;
  const dstCx = (width - 1) / 2;
  const dstCy = (height - 1) / 2;

  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const dx = x - dstCx;
      const dy = y - dstCy;
      const sx = c * dx + s * dy + srcCx;
      const sy = -s * dx + c * dy + srcCy;
      const ix = Math.round(sx);
      const iy = Math.round(sy);
      return ix >= 0 && ix < srcW && iy >= 0 && iy < srcH ? source[iy][ix] : fill;
    })
  );
}

function rotateArbitraryExpandedInkPreserving(image, options = {}) {
  const source = normalizeImage(image);
  const degrees = options.degrees;
  const fill = options.fill === undefined ? 255 : options.fill;
  requireCondition(typeof degrees === "number" && Number.isFinite(degrees), "IMAGE_GEOMETRY_DEGREES");
  requireCondition(Math.abs(degrees) <= 15, "IMAGE_GEOMETRY_DEGREES_LIMIT");
  requireCondition(Number.isInteger(fill) && fill >= 0 && fill <= 255, "IMAGE_GEOMETRY_FILL");

  const srcH = source.length;
  const srcW = source[0].length;
  if (degrees === 0) return source.map(row => row.slice());

  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const width = Math.ceil(Math.abs(srcW * c) + Math.abs(srcH * s));
  const height = Math.ceil(Math.abs(srcH * c) + Math.abs(srcW * s));
  requireCondition(width <= 5000 && height <= 5000, "IMAGE_GEOMETRY_EXPANDED_DIMENSIONS");

  const srcCx = (srcW - 1) / 2;
  const srcCy = (srcH - 1) / 2;
  const dstCx = (width - 1) / 2;
  const dstCy = (height - 1) / 2;

  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const dx = x - dstCx;
      const dy = y - dstCy;
      const sx = c * dx + s * dy + srcCx;
      const sy = -s * dx + c * dy + srcCy;
      const x0 = Math.floor(sx);
      const x1 = Math.ceil(sx);
      const y0 = Math.floor(sy);
      const y1 = Math.ceil(sy);
      let value = fill;
      let found = false;
      for (const iy of [y0, y1]) {
        for (const ix of [x0, x1]) {
          if (ix < 0 || ix >= srcW || iy < 0 || iy >= srcH) continue;
          value = Math.min(value, source[iy][ix]);
          found = true;
        }
      }
      return found ? value : fill;
    })
  );
}

function findContentBounds(image, threshold = 250) {
  const source = normalizeImage(image);
  requireCondition(Number.isInteger(threshold) && threshold >= 0 && threshold <= 254, "IMAGE_GEOMETRY_CROP_THRESHOLD");
  const h = source.length;
  const w = source[0].length;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (source[y][x] > threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  requireCondition(maxX >= minX && maxY >= minY, "IMAGE_GEOMETRY_CROP_NO_CONTENT");
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    threshold,
  };
}

function cropToContent(image, threshold = 250) {
  const bounds = findContentBounds(image, threshold);
  return {
    image: cropImage(image, bounds),
    bounds,
  };
}

function pointDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function normalizePerspectiveCorners(corners, width, height) {
  requireCondition(
    corners && typeof corners === "object" && !Array.isArray(corners),
    "IMAGE_PERSPECTIVE_CORNERS",
  );
  const ordered = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ].map((point) => {
    requireCondition(
      point && typeof point === "object" &&
      typeof point.x === "number" && Number.isFinite(point.x) &&
      typeof point.y === "number" && Number.isFinite(point.y),
      "IMAGE_PERSPECTIVE_POINT",
    );
    requireCondition(
      point.x >= 0 && point.x <= width - 1 &&
      point.y >= 0 && point.y <= height - 1,
      "IMAGE_PERSPECTIVE_POINT_BOUNDS",
    );
    return { x: point.x, y: point.y };
  });

  let sign = 0;
  let twiceArea = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[(i + 1) % ordered.length];
    const c = ordered[(i + 2) % ordered.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    requireCondition(Math.abs(cross) > 1e-6, "IMAGE_PERSPECTIVE_DEGENERATE");
    const currentSign = Math.sign(cross);
    if (sign === 0) sign = currentSign;
    requireCondition(currentSign === sign, "IMAGE_PERSPECTIVE_NONCONVEX");
    twiceArea += a.x * b.y - b.x * a.y;
  }
  requireCondition(Math.abs(twiceArea) >= 200, "IMAGE_PERSPECTIVE_AREA");
  return ordered;
}

function solveLinearSystem(matrix, vector) {
  requireCondition(
    Array.isArray(matrix) && matrix.length === 8 &&
    matrix.every(row => Array.isArray(row) && row.length === 8) &&
    Array.isArray(vector) && vector.length === 8,
    "IMAGE_PERSPECTIVE_SYSTEM",
  );
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < 8; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 8; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    requireCondition(Math.abs(augmented[pivot][col]) > 1e-10, "IMAGE_PERSPECTIVE_SINGULAR");
    if (pivot !== col) [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];
    const divisor = augmented[col][col];
    for (let j = col; j <= 8; j += 1) augmented[col][j] /= divisor;
    for (let row = 0; row < 8; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (Math.abs(factor) <= 1e-14) continue;
      for (let j = col; j <= 8; j += 1) augmented[row][j] -= factor * augmented[col][j];
    }
  }
  return augmented.map(row => row[8]);
}

function homographyFromPairs(destinationPoints, sourcePoints) {
  requireCondition(
    Array.isArray(destinationPoints) && destinationPoints.length === 4 &&
    Array.isArray(sourcePoints) && sourcePoints.length === 4,
    "IMAGE_PERSPECTIVE_PAIR_COUNT",
  );
  const matrix = [];
  const vector = [];
  for (let i = 0; i < 4; i += 1) {
    const u = destinationPoints[i].x;
    const v = destinationPoints[i].y;
    const x = sourcePoints[i].x;
    const y = sourcePoints[i].y;
    matrix.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    vector.push(x);
    matrix.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    vector.push(y);
  }
  const [a,b,c,d,e,f,g,h] = solveLinearSystem(matrix, vector);
  return { a,b,c,d,e,f,g,h };
}

function applyHomography(h, x, y) {
  const denominator = h.g * x + h.h * y + 1;
  requireCondition(Math.abs(denominator) > 1e-10, "IMAGE_PERSPECTIVE_DENOMINATOR");
  return {
    x: (h.a * x + h.b * y + h.c) / denominator,
    y: (h.d * x + h.e * y + h.f) / denominator,
  };
}

function sampleDarkSupport3x3(source, x, y, fill) {
  const h = source.length;
  const w = source[0].length;
  const cx = Math.round(x);
  const cy = Math.round(y);
  let value = fill;
  let found = false;
  for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
      if (ix < 0 || ix >= w || iy < 0 || iy >= h) continue;
      value = Math.min(value, source[iy][ix]);
      found = true;
    }
  }
  return found ? value : fill;
}

function pointInConvexQuad(point, quad) {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) <= 1e-9) continue;
    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }
  return true;
}

function polygonArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function edgeSupportFraction(source, a, b, darkThreshold, tolerancePx, samples) {
  let supported = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = samples === 1 ? 0 : i / (samples - 1);
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const cx = Math.round(x);
    const cy = Math.round(y);
    let found = false;
    for (let dy = -tolerancePx; dy <= tolerancePx && !found; dy += 1) {
      for (let dx = -tolerancePx; dx <= tolerancePx; dx += 1) {
        const px = cx + dx;
        const py = cy + dy;
        if (py < 0 || py >= source.length || px < 0 || px >= source[0].length) continue;
        if (source[py][px] <= darkThreshold) {
          found = true;
          break;
        }
      }
    }
    if (found) supported += 1;
  }
  return supported / samples;
}

function detectPerspectiveCorners(image, options = {}) {
  const source = normalizeImage(image);
  const h = source.length;
  const w = source[0].length;
  const darkThreshold = options.darkThreshold === undefined ? 245 : options.darkThreshold;
  const maxSamples = options.maxSamples === undefined ? 200000 : options.maxSamples;
  const minAreaFraction = options.minAreaFraction === undefined ? 0.15 : options.minAreaFraction;
  const minEdgeSupportFraction =
    options.minEdgeSupportFraction === undefined ? 0.2 : options.minEdgeSupportFraction;
  const edgeTolerancePx = options.edgeTolerancePx === undefined ? 4 : options.edgeTolerancePx;
  const edgeSamples = options.edgeSamples === undefined ? 64 : options.edgeSamples;

  requireCondition(
    Number.isInteger(darkThreshold) && darkThreshold >= 0 && darkThreshold <= 254,
    "IMAGE_PERSPECTIVE_DETECT_THRESHOLD",
  );
  requireCondition(
    Number.isInteger(maxSamples) && maxSamples >= 1000 && maxSamples <= 500000,
    "IMAGE_PERSPECTIVE_DETECT_SAMPLE_BUDGET",
  );
  requireCondition(
    typeof minAreaFraction === "number" && Number.isFinite(minAreaFraction) &&
    minAreaFraction >= 0.05 && minAreaFraction <= 0.95,
    "IMAGE_PERSPECTIVE_DETECT_AREA_FRACTION",
  );
  requireCondition(
    typeof minEdgeSupportFraction === "number" && Number.isFinite(minEdgeSupportFraction) &&
    minEdgeSupportFraction >= 0 && minEdgeSupportFraction <= 1,
    "IMAGE_PERSPECTIVE_DETECT_EDGE_SUPPORT",
  );
  requireCondition(
    Number.isInteger(edgeTolerancePx) && edgeTolerancePx >= 1 && edgeTolerancePx <= 12 &&
    Number.isInteger(edgeSamples) && edgeSamples >= 16 && edgeSamples <= 256,
    "IMAGE_PERSPECTIVE_DETECT_EDGE_SAMPLING",
  );

  let darkPixelCount = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (source[y][x] <= darkThreshold) darkPixelCount += 1;
    }
  }
  requireCondition(darkPixelCount >= 200, "IMAGE_PERSPECTIVE_DETECT_INSUFFICIENT_SUPPORT");

  const stride = Math.max(1, Math.ceil(darkPixelCount / maxSamples));
  const points = [];
  let seen = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (source[y][x] > darkThreshold) continue;
      if (seen % stride === 0) points.push({ x, y });
      seen += 1;
    }
  }
  requireCondition(points.length >= 200, "IMAGE_PERSPECTIVE_DETECT_INSUFFICIENT_SUPPORT");

  let topLeft = points[0];
  let topRight = points[0];
  let bottomRight = points[0];
  let bottomLeft = points[0];
  for (const point of points) {
    if (point.x + point.y < topLeft.x + topLeft.y) topLeft = point;
    if (point.x - point.y > topRight.x - topRight.y) topRight = point;
    if (point.x + point.y > bottomRight.x + bottomRight.y) bottomRight = point;
    if (point.x - point.y < bottomLeft.x - bottomLeft.y) bottomLeft = point;
  }

  const unique = new Set(
    [topLeft, topRight, bottomRight, bottomLeft].map(p => `${p.x},${p.y}`)
  );
  requireCondition(unique.size === 4, "IMAGE_PERSPECTIVE_DETECT_AMBIGUOUS_CORNERS");

  const corners = {
    topLeft: { ...topLeft },
    topRight: { ...topRight },
    bottomRight: { ...bottomRight },
    bottomLeft: { ...bottomLeft },
  };
  const ordered = normalizePerspectiveCorners(corners, w, h);
  const area = polygonArea(ordered);
  const areaFraction = area / (w * h);
  requireCondition(
    areaFraction >= minAreaFraction,
    "IMAGE_PERSPECTIVE_DETECT_AREA_TOO_SMALL",
  );

  const edgeSupport = [];
  for (let i = 0; i < ordered.length; i += 1) {
    edgeSupport.push(edgeSupportFraction(
      source,
      ordered[i],
      ordered[(i + 1) % ordered.length],
      darkThreshold,
      edgeTolerancePx,
      edgeSamples,
    ));
  }
  requireCondition(
    edgeSupport.every(value => value >= minEdgeSupportFraction),
    "IMAGE_PERSPECTIVE_DETECT_EDGE_SUPPORT_LOW",
  );

  return {
    schema: "ekg-image-perspective-detection-v1",
    corners,
    darkThreshold,
    darkPixelCount,
    sampledSupportPoints: points.length,
    sampleEveryDarkPixel: stride,
    area,
    areaFraction,
    edgeSupport,
    minEdgeSupportFraction,
    edgeTolerancePx,
    method: "DIRECTIONAL_EXTREMA_WITH_CONVEX_AREA_AND_EDGE_SUPPORT_GATES",
    ...GEOMETRY_GOVERNANCE,
  };
}

function rectifyPerspective(image, options = {}) {
  const source = normalizeImage(image);
  const srcH = source.length;
  const srcW = source[0].length;
  const corners = normalizePerspectiveCorners(options.corners, srcW, srcH);
  const inferredWidth = Math.round(
    (pointDistance(corners[0], corners[1]) + pointDistance(corners[3], corners[2])) / 2,
  );
  const inferredHeight = Math.round(
    (pointDistance(corners[0], corners[3]) + pointDistance(corners[1], corners[2])) / 2,
  );
  const outputWidth = options.outputWidth === undefined ? inferredWidth : options.outputWidth;
  const outputHeight = options.outputHeight === undefined ? inferredHeight : options.outputHeight;
  const fill = options.fill === undefined ? 255 : options.fill;
  requireCondition(
    Number.isInteger(outputWidth) && outputWidth >= 40 && outputWidth <= 4000 &&
    Number.isInteger(outputHeight) && outputHeight >= 40 && outputHeight <= 4000 &&
    outputWidth * outputHeight <= 4_000_000,
    "IMAGE_PERSPECTIVE_OUTPUT_DIMENSIONS",
  );
  requireCondition(Number.isInteger(fill) && fill >= 0 && fill <= 255, "IMAGE_GEOMETRY_FILL");

  const destination = [
    { x: 0, y: 0 },
    { x: outputWidth - 1, y: 0 },
    { x: outputWidth - 1, y: outputHeight - 1 },
    { x: 0, y: outputHeight - 1 },
  ];
  const homography = homographyFromPairs(destination, corners);
  const rectified = Array.from({ length: outputHeight }, (_, y) =>
    Array.from({ length: outputWidth }, (_, x) => {
      const sourcePoint = applyHomography(homography, x, y);
      return sampleDarkSupport3x3(source, sourcePoint.x, sourcePoint.y, fill);
    })
  );
  return {
    schema: "ekg-image-perspective-rectification-v1",
    image: rectified,
    corners: {
      topLeft: corners[0],
      topRight: corners[1],
      bottomRight: corners[2],
      bottomLeft: corners[3],
    },
    outputWidth,
    outputHeight,
    method: "EXPLICIT_QUADRILATERAL_HOMOGRAPHY_DARK_SUPPORT_3X3",
    ...GEOMETRY_GOVERNANCE,
  };
}

function projectRectangleToQuadrilateral(image, options = {}) {
  const source = normalizeImage(image);
  const srcH = source.length;
  const srcW = source[0].length;
  const canvasWidth = options.canvasWidth;
  const canvasHeight = options.canvasHeight;
  requireCondition(
    Number.isInteger(canvasWidth) && canvasWidth >= srcW && canvasWidth <= 4000 &&
    Number.isInteger(canvasHeight) && canvasHeight >= srcH && canvasHeight <= 4000 &&
    canvasWidth * canvasHeight <= 4_000_000,
    "IMAGE_PERSPECTIVE_CANVAS_DIMENSIONS",
  );
  const fill = options.fill === undefined ? 255 : options.fill;
  requireCondition(Number.isInteger(fill) && fill >= 0 && fill <= 255, "IMAGE_GEOMETRY_FILL");
  const quad = normalizePerspectiveCorners(options.destinationCorners, canvasWidth, canvasHeight);
  const sourceRectangle = [
    { x: 0, y: 0 },
    { x: srcW - 1, y: 0 },
    { x: srcW - 1, y: srcH - 1 },
    { x: 0, y: srcH - 1 },
  ];
  const homography = homographyFromPairs(quad, sourceRectangle);
  const output = Array.from({ length: canvasHeight }, () => Array(canvasWidth).fill(fill));
  for (let y = 0; y < canvasHeight; y += 1) {
    for (let x = 0; x < canvasWidth; x += 1) {
      if (!pointInConvexQuad({ x, y }, quad)) continue;
      const sourcePoint = applyHomography(homography, x, y);
      output[y][x] = sampleDarkSupport3x3(source, sourcePoint.x, sourcePoint.y, fill);
    }
  }
  return output;
}

function projectionScore(points, width, height, degrees) {
  const radians = degrees * Math.PI / 180;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rows = new Int32Array(height);
  const cols = new Int32Array(width);
  let retained = 0;

  for (const [x, y] of points) {
    const dx = x - cx;
    const dy = y - cy;
    const tx = Math.round(c * dx - s * dy + cx);
    const ty = Math.round(s * dx + c * dy + cy);
    if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
    cols[tx] += 1;
    rows[ty] += 1;
    retained += 1;
  }
  requireCondition(retained > 0, "IMAGE_DESKEW_NO_RETAINED_INK");

  let sumSquares = 0;
  for (const value of rows) sumSquares += value * value;
  for (const value of cols) sumSquares += value * value;
  return { score: sumSquares / retained, retained };
}

function estimateDeskewAngle(image, options = {}) {
  const source = normalizeImage(image);
  const h = source.length;
  const w = source[0].length;
  const maxAbsDegrees = options.maxAbsDegrees === undefined ? 5 : options.maxAbsDegrees;
  const stepDegrees = options.stepDegrees === undefined ? 0.5 : options.stepDegrees;
  const darkThreshold = options.darkThreshold === undefined ? 220 : options.darkThreshold;
  const maxSamples = options.maxSamples === undefined ? 120000 : options.maxSamples;

  requireCondition(
    typeof maxAbsDegrees === "number" && Number.isFinite(maxAbsDegrees) &&
    maxAbsDegrees > 0 && maxAbsDegrees <= 10,
    "IMAGE_DESKEW_MAX_DEGREES",
  );
  requireCondition(
    typeof stepDegrees === "number" && Number.isFinite(stepDegrees) &&
    stepDegrees >= 0.25 && stepDegrees <= 2 &&
    Math.round((maxAbsDegrees * 2) / stepDegrees) <= 80,
    "IMAGE_DESKEW_STEP",
  );
  requireCondition(
    Number.isInteger(darkThreshold) && darkThreshold >= 0 && darkThreshold <= 254,
    "IMAGE_DESKEW_THRESHOLD",
  );
  requireCondition(
    Number.isInteger(maxSamples) && maxSamples >= 1000 && maxSamples <= 250000,
    "IMAGE_DESKEW_SAMPLE_BUDGET",
  );

  let darkPixelCount = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (source[y][x] <= darkThreshold) darkPixelCount += 1;
    }
  }
  requireCondition(darkPixelCount >= 100, "IMAGE_DESKEW_INSUFFICIENT_INK");

  const sampleEveryDarkPixel = Math.max(1, Math.ceil(darkPixelCount / maxSamples));
  const points = [];
  let seenDark = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (source[y][x] > darkThreshold) continue;
      if (seenDark % sampleEveryDarkPixel === 0) points.push([x, y]);
      seenDark += 1;
    }
  }
  requireCondition(points.length >= 100 && points.length <= maxSamples, "IMAGE_DESKEW_SAMPLE_BUDGET");

  let best = null;
  const steps = Math.round((maxAbsDegrees * 2) / stepDegrees);
  for (let i = 0; i <= steps; i += 1) {
    const degrees = -maxAbsDegrees + i * stepDegrees;
    const evaluated = projectionScore(points, w, h, degrees);
    const candidate = { degrees, ...evaluated };
    if (
      !best ||
      candidate.score > best.score + 1e-12 ||
      (Math.abs(candidate.score - best.score) <= 1e-12 &&
        Math.abs(candidate.degrees) < Math.abs(best.degrees))
    ) {
      best = candidate;
    }
  }

  const zero = projectionScore(points, w, h, 0);
  return {
    schema: "ekg-image-deskew-estimate-v1",
    correctionDegrees: Number(best.degrees.toFixed(6)),
    score: best.score,
    zeroScore: zero.score,
    scoreGain: best.score - zero.score,
    darkPixelCount,
    sampledInkPoints: points.length,
    sampleEveryDarkPixel,
    maxAbsDegrees,
    stepDegrees,
    darkThreshold,
    ...GEOMETRY_GOVERNANCE,
  };
}

function deskewImage(image, options = {}) {
  const source = normalizeImage(image);
  const estimate = estimateDeskewAngle(source, options);
  const minimumCorrectionDegrees =
    options.minimumCorrectionDegrees === undefined ? estimate.stepDegrees / 2 : options.minimumCorrectionDegrees;
  requireCondition(
    typeof minimumCorrectionDegrees === "number" &&
    Number.isFinite(minimumCorrectionDegrees) &&
    minimumCorrectionDegrees >= 0 &&
    minimumCorrectionDegrees <= estimate.maxAbsDegrees,
    "IMAGE_DESKEW_MINIMUM_CORRECTION",
  );
  const appliedDegrees =
    Math.abs(estimate.correctionDegrees) >= minimumCorrectionDegrees
      ? estimate.correctionDegrees
      : 0;
  const rotated = appliedDegrees === 0
    ? source.map(row => row.slice())
    : rotateArbitraryInkPreserving(source, { degrees: appliedDegrees });
  const trimWhiteBorder = options.trimWhiteBorder === true;
  const cropThreshold = options.cropThreshold === undefined ? 250 : options.cropThreshold;
  const cropped = trimWhiteBorder ? cropToContent(rotated, cropThreshold) : null;
  return {
    schema: "ekg-image-deskew-result-v1",
    image: cropped ? cropped.image : rotated,
    estimate,
    appliedDegrees,
    crop: cropped ? cropped.bounds : null,
    method: "BOUNDED_PROJECTION_SHARPNESS_DARK_SUPPORT_3X3_ROTATION",
    ...GEOMETRY_GOVERNANCE,
  };
}

module.exports = {
  GEOMETRY_GOVERNANCE,
  cropToContent,
  deskewImage,
  detectPerspectiveCorners,
  estimateDeskewAngle,
  findContentBounds,
  edgeSupportFraction,
  homographyFromPairs,
  pointInConvexQuad,
  polygonArea,
  projectionScore,
  projectRectangleToQuadrilateral,
  rectifyPerspective,
  rotateArbitraryExpandedInkPreserving,
  rotateArbitraryExpandedNearest,
  rotateArbitraryInkPreserving,
  rotateArbitraryNearest,
};
