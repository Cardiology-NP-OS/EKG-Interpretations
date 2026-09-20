"use strict";

const BASELINE_GOVERNANCE = Object.freeze({
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

function median(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "BASELINE_VALUES_REQUIRED");
  const sorted = values.slice().sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function estimateTraceBaseline(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "BASELINE_INPUT_REQUIRED");
  requireCondition(Array.isArray(input.ys), "BASELINE_YS_REQUIRED");
  requireCondition(input.roi && typeof input.roi === "object", "BASELINE_ROI_REQUIRED");
  const roi = input.roi;
  requireCondition(
    Number.isInteger(roi.y) && Number.isInteger(roi.height) && roi.height >= 8,
    "BASELINE_ROI_GEOMETRY",
  );
  const pxPerMm = input.pxPerMm;
  requireCondition(typeof pxPerMm === "number" && Number.isFinite(pxPerMm) && pxPerMm >= 2 && pxPerMm <= 12, "BASELINE_PX_PER_MM");
  const minObservedColumns = input.minObservedColumns === undefined ? 64 : input.minObservedColumns;
  const tolerancePx = input.tolerancePx === undefined ? Math.max(1, Math.round(pxPerMm * 0.4)) : input.tolerancePx;
  const minInlierFraction = input.minInlierFraction === undefined ? 0.55 : input.minInlierFraction;
  const minDominantFraction = input.minDominantFraction === undefined ? 0.12 : input.minDominantFraction;

  requireCondition(Number.isInteger(minObservedColumns) && minObservedColumns >= 16 && minObservedColumns <= 10000, "BASELINE_MIN_OBSERVED");
  requireCondition(Number.isInteger(tolerancePx) && tolerancePx >= 1 && tolerancePx <= 12, "BASELINE_TOLERANCE");
  requireCondition(typeof minInlierFraction === "number" && Number.isFinite(minInlierFraction) && minInlierFraction >= 0.4 && minInlierFraction <= 0.95, "BASELINE_MIN_INLIER");
  requireCondition(typeof minDominantFraction === "number" && Number.isFinite(minDominantFraction) && minDominantFraction >= 0.05 && minDominantFraction <= 0.8, "BASELINE_MIN_DOMINANT");

  const lower = roi.y;
  const upper = roi.y + roi.height - 1;
  const ys = input.ys.filter(y => Number.isInteger(y) && y >= lower && y <= upper);
  requireCondition(ys.length >= minObservedColumns, "BASELINE_INSUFFICIENT_OBSERVED_COLUMNS");

  const counts = new Map();
  for (const y of ys) counts.set(y, (counts.get(y) || 0) + 1);
  const center = median(ys);
  let dominantY = null;
  let dominantCount = -1;
  for (const [y,count] of counts.entries()) {
    if (
      count > dominantCount ||
      (count === dominantCount && Math.abs(y - center) < Math.abs(dominantY - center)) ||
      (count === dominantCount && Math.abs(y - center) === Math.abs(dominantY - center) && y < dominantY)
    ) {
      dominantY = y;
      dominantCount = count;
    }
  }

  const inlierCount = ys.filter(y => Math.abs(y - dominantY) <= tolerancePx).length;
  const inlierFraction = inlierCount / ys.length;
  const dominantFraction = dominantCount / ys.length;
  const deviations = ys.map(y => Math.abs(y - dominantY));
  const medianAbsoluteDeviationPx = median(deviations);
  const edgeMarginPx = Math.min(dominantY - lower, upper - dominantY);
  const verified =
    inlierFraction >= minInlierFraction &&
    dominantFraction >= minDominantFraction &&
    edgeMarginPx >= tolerancePx;

  return {
    schema: "ekg-image-trace-baseline-estimate-v1",
    baselineY: dominantY,
    verified,
    method: "DOMINANT_TRACE_ROW_WITH_BOUNDED_INLIER_SUPPORT_V1",
    observedColumnCount: ys.length,
    dominantCount,
    dominantFraction,
    inlierCount,
    inlierFraction,
    tolerancePx,
    medianAbsoluteDeviationPx,
    edgeMarginPx,
    minObservedColumns,
    minInlierFraction,
    minDominantFraction,
    ...BASELINE_GOVERNANCE,
  };
}

module.exports = {
  BASELINE_GOVERNANCE,
  estimateTraceBaseline,
  median,
};
