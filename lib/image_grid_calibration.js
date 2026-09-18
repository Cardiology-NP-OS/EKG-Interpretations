"use strict";

const { normalizeImage } = require("./image_robustness");

const GRID_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function columnProjection(image) {
  const h = image.length;
  const w = image[0].length;
  const out = Array(w).fill(0);
  for (let y = 0; y < h; y += 1) {
    const row = image[y];
    for (let x = 0; x < w; x += 1) out[x] += 255 - row[x];
  }
  return out;
}

function rowProjection(image) {
  const h = image.length;
  const w = image[0].length;
  const out = Array(h).fill(0);
  for (let y = 0; y < h; y += 1) {
    const row = image[y];
    let sum = 0;
    for (let x = 0; x < w; x += 1) sum += 255 - row[x];
    out[y] = sum;
  }
  return out;
}

function bestPeriod(series, minLag, maxLag) {
  requireCondition(Array.isArray(series) && series.length >= maxLag * 3, "GRID_PROJECTION_SHORT");
  requireCondition(Number.isInteger(minLag) && Number.isInteger(maxLag) && minLag >= 2 && maxLag > minLag, "GRID_LAG_RANGE");
  let bestLag = minLag;
  let bestScore = -Infinity;
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acc = 0;
    let n = 0;
    for (let i = 0; i + lag < series.length; i += 1) {
      acc += (series[i] - mean) * (series[i + lag] - mean);
      n += 1;
    }
    const score = acc / n;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return { periodPx: bestLag, score: bestScore };
}

function estimateGridCalibration(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "GRID_INPUT_REQUIRED");
  const image = normalizeImage(input.image);
  const minorMm = input.minorMm === undefined ? 1 : input.minorMm;
  requireCondition(minorMm === 1, "GRID_MINOR_MM");
  const paperSpeedMmPerS = input.paperSpeedMmPerS === undefined ? 25 : input.paperSpeedMmPerS;
  const gainMmPerMv = input.gainMmPerMv === undefined ? 10 : input.gainMmPerMv;
  requireCondition(paperSpeedMmPerS === 25 || paperSpeedMmPerS === 50, "GRID_PAPER_SPEED");
  requireCondition(gainMmPerMv === 5 || gainMmPerMv === 10 || gainMmPerMv === 20, "GRID_GAIN");
  const minLag = input.minLag === undefined ? 10 : input.minLag;
  const maxLag = input.maxLag === undefined ? 40 : input.maxLag;
  const xFit = bestPeriod(columnProjection(image), minLag, maxLag);
  const yFit = bestPeriod(rowProjection(image), minLag, maxLag);
  requireCondition(Math.abs(xFit.periodPx - yFit.periodPx) <= 5, "GRID_AXIS_DISAGREEMENT");
  const majorPx = Math.round((xFit.periodPx + yFit.periodPx) / 2);
  requireCondition(majorPx >= 10 && majorPx <= 40, "GRID_PERIOD_IMPLAUSIBLE");
  requireCondition(majorPx % 5 === 0, "GRID_MAJOR_NOT_ALIGNED");
  const periodPx = majorPx / 5;
  requireCondition(periodPx >= 2 && periodPx <= 12, "GRID_MINOR_IMPLAUSIBLE");
  const pxPerMm = periodPx / minorMm;
  return {
    schema: "ekg-image-grid-calibration-v1",
    pxPerMm,
    periodPxX: xFit.periodPx,
    periodPxY: yFit.periodPx,
    paperSpeedMmPerS,
    gainMmPerMv,
    pxPerSecond: pxPerMm * paperSpeedMmPerS,
    pxPerMv: pxPerMm * gainMmPerMv,
    mmPerPx: 1 / pxPerMm,
    assumedMinorMm: minorMm,
    speedSource: input.paperSpeedMmPerS === undefined ? "STANDARD_ASSUMPTION_25" : "EXPLICIT",
    gainSource: input.gainMmPerMv === undefined ? "STANDARD_ASSUMPTION_10" : "EXPLICIT",
    localScaleTrustworthy: Math.abs(xFit.periodPx - yFit.periodPx) <= 1,
    ...GRID_GOVERNANCE,
  };
}

module.exports = { GRID_GOVERNANCE, estimateGridCalibration };
