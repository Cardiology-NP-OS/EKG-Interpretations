"use strict";

const { normalizeImage } = require("./image_robustness");

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
  return {
    schema: "ekg-image-deskew-result-v1",
    image: appliedDegrees === 0
      ? source.map(row => row.slice())
      : rotateArbitraryInkPreserving(source, { degrees: appliedDegrees }),
    estimate,
    appliedDegrees,
    method: "BOUNDED_PROJECTION_SHARPNESS_DARK_SUPPORT_3X3_ROTATION",
    ...GEOMETRY_GOVERNANCE,
  };
}

module.exports = {
  GEOMETRY_GOVERNANCE,
  deskewImage,
  estimateDeskewAngle,
  projectionScore,
  rotateArbitraryExpandedInkPreserving,
  rotateArbitraryExpandedNearest,
  rotateArbitraryInkPreserving,
  rotateArbitraryNearest,
};
