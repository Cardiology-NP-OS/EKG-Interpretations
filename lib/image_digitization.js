"use strict";

const { normalizeImage } = require("./image_robustness");
const { estimateTraceBaseline } = require("./image_baseline_estimation");

const DIGITIZATION_GOVERNANCE = Object.freeze({
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

function columnTraceY(rowSlice, inkCeiling) {
  let bestY = -1;
  let best = inkCeiling;
  for (let y = 0; y < rowSlice.length; y += 1) {
    const v = rowSlice[y];
    if (v < best) {
      best = v;
      bestY = y;
    }
  }
  return bestY;
}

function traceRowsForRoi(image, roi, inkCeiling, maxHeldColumns, strictTraceMaxThicknessPx) {
  requireCondition(roi && Number.isInteger(roi.x), "DIGITIZATION_ROI");
  const strict = strictTraceMaxThicknessPx !== undefined;
  if (strict) {
    requireCondition(
      Number.isInteger(roi.y) && Number.isInteger(roi.width) && Number.isInteger(roi.height) &&
      roi.x >= 0 && roi.y >= 0 && roi.width >= 1 && roi.height >= 3 &&
      roi.y + roi.height <= image.length && roi.x + roi.width <= image[0].length,
      "DIGITIZATION_ROI",
    );
    requireCondition(
      Number.isInteger(strictTraceMaxThicknessPx) && strictTraceMaxThicknessPx >= 1 &&
      strictTraceMaxThicknessPx <= Math.min(100, roi.height - 2),
      "DIGITIZATION_STRICT_THICKNESS_LIMIT",
    );
    requireCondition(maxHeldColumns === undefined || maxHeldColumns === 0, "DIGITIZATION_STRICT_HOLD_FORBIDDEN");
    requireCondition(Number.isInteger(inkCeiling) && inkCeiling >= 0 && inkCeiling <= 200, "DIGITIZATION_INK_CEILING");
    maxHeldColumns = 0;
  }
  let maxStrokeThicknessPx = 0;
  const ys = [];
  const observedYs = [];
  const x1 = roi.x + roi.width;
  let lastLocal = -1;
  let inkColumns = 0;
  let heldColumnCount = 0;
  let currentHeldGap = 0;
  let maxHeldGapColumns = 0;
  for (let x = roi.x; x < x1; x += 1) {
    const column = [];
    for (let y = roi.y; y < roi.y + roi.height; y += 1) column.push(image[y][x]);
    let local = columnTraceY(column, inkCeiling);
    if (strict) {
      const dark = [];
      for (let y = 0; y < column.length; y += 1) if (column[y] < inkCeiling) dark.push(y);
      requireCondition(dark.length > 0, `DIGITIZATION_TRACE_MISSING:${roi.lead}:${x}`);
      const first = dark[0];
      const last = dark[dark.length - 1];
      requireCondition(first > 0 && last < roi.height - 1, `DIGITIZATION_TRACE_CLIPPED:${roi.lead}:${x}`);
      requireCondition(last - first + 1 === dark.length, `DIGITIZATION_TRACE_AMBIGUOUS:${roi.lead}:${x}`);
      requireCondition(dark.length <= strictTraceMaxThicknessPx, `DIGITIZATION_TRACE_THICKNESS:${roi.lead}:${x}`);
      maxStrokeThicknessPx = Math.max(maxStrokeThicknessPx, dark.length);
      local = (first + last) / 2;
    }
    if (local >= 0) {
      lastLocal = local;
      inkColumns += 1;
      currentHeldGap = 0;
      observedYs.push(roi.y + local);
    } else {
      requireCondition(lastLocal >= 0, `DIGITIZATION_NO_INK_COLUMN:${roi.lead}:${x}`);
      currentHeldGap += 1;
      heldColumnCount += 1;
      maxHeldGapColumns = Math.max(maxHeldGapColumns, currentHeldGap);
      requireCondition(
        currentHeldGap <= maxHeldColumns,
        `DIGITIZATION_MISSING_RUN_EXCEEDED:${roi.lead}:${x}:${currentHeldGap}`,
      );
    }
    ys.push(roi.y + lastLocal);
  }
  requireCondition(inkColumns >= 8, `DIGITIZATION_TRACE_TOO_SPARSE:${roi.lead}`);
  return {
    ys,
    observedYs,
    quality: {
      observedInkColumns: inkColumns,
      heldColumnCount,
      maxHeldGapColumns,
      maxHeldColumns,
      holdPolicy: "BOUNDED_LAST_OBSERVATION_CARRY_FORWARD",
      ...(strict ? {
        tracePolicy: "SINGLE_CONTIGUOUS_DARK_TRACE",
        strictTraceMaxThicknessPx,
        maxStrokeThicknessPx,
        inkCeiling,
        coverage: 1,
        sourceRegion: { x: roi.x, y: roi.y, width: roi.width, height: roi.height },
      } : {}),
    },
  };
}

function addPixelUncertainty(quality, calibration) {
  if (quality.tracePolicy !== "SINGLE_CONTIGUOUS_DARK_TRACE") return quality;
  const maxAmplitudeUncertaintyMv = quality.maxStrokeThicknessPx / 2 / calibration.pxPerMv;
  const timePixelUncertaintyMs = 500 / calibration.pxPerSecond;
  requireCondition(
    Number.isFinite(maxAmplitudeUncertaintyMv) && maxAmplitudeUncertaintyMv > 0 &&
    Number.isFinite(timePixelUncertaintyMs) && timePixelUncertaintyMs > 0,
    "DIGITIZATION_PIXEL_UNCERTAINTY",
  );
  return { ...quality, maxAmplitudeUncertaintyMv, timePixelUncertaintyMs, calibrationUncertaintyQuantified: false };
}

function digitizeRoi(image, roi, calibration, inkCeiling, maxHeldColumns, strictTraceMaxThicknessPx) {
  if (strictTraceMaxThicknessPx !== undefined) {
    requireCondition(Number.isInteger(calibration.baselineY) && calibration.baselineY >= roi.y && calibration.baselineY < roi.y + roi.height, "DIGITIZATION_BASELINE");
  }
  const traced = traceRowsForRoi(image, roi, inkCeiling, maxHeldColumns, strictTraceMaxThicknessPx);
  const samples = traced.ys.map(absY => {
    const mv = (calibration.baselineY - absY) / calibration.pxPerMv;
    requireCondition(Number.isFinite(mv), "DIGITIZATION_NONFINITE");
    return mv;
  });
  return { samples, ys: traced.ys, observedYs: traced.observedYs, quality: addPixelUncertainty(traced.quality, calibration) };
}

function digitizeLeadRois(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "DIGITIZATION_INPUT_REQUIRED");
  const image = normalizeImage(input.image);
  requireCondition(Array.isArray(input.rois) && input.rois.length > 0, "DIGITIZATION_ROIS_REQUIRED");
  requireCondition(input.calibration && typeof input.calibration === "object", "DIGITIZATION_CALIBRATION_REQUIRED");
  const cal = input.calibration;
  requireCondition(Number.isFinite(cal.pxPerSecond) && cal.pxPerSecond > 0, "DIGITIZATION_PX_PER_SECOND");
  requireCondition(Number.isFinite(cal.pxPerMv) && cal.pxPerMv > 0, "DIGITIZATION_PX_PER_MV");
  const inkCeiling = input.inkCeiling === undefined ? 80 : input.inkCeiling;
  requireCondition(Number.isInteger(inkCeiling) && inkCeiling >= 0 && inkCeiling <= 200, "DIGITIZATION_INK_CEILING");
  const maxHeldColumns = input.maxHeldColumns === undefined
    ? (input.strictTraceMaxThicknessPx === undefined ? 2 : 0)
    : input.maxHeldColumns;
  requireCondition(
    Number.isInteger(maxHeldColumns) && maxHeldColumns >= 0 && maxHeldColumns <= 8,
    "DIGITIZATION_MAX_HELD_COLUMNS",
  );
  const sampleRateHz = cal.pxPerSecond;
  const leads = input.rois.map(roi => {
    requireCondition(typeof roi.lead === "string" && roi.lead.length > 0, "DIGITIZATION_LEAD_LABEL");
    const declaredAssumption = roi.baselineSource === "ROI_GEOMETRY_ASSUMPTION_55_PERCENT";
    const baselineExplicit = Number.isInteger(roi.baselineY) && !declaredAssumption;
    if (input.strictTraceMaxThicknessPx !== undefined && roi.baselineY !== undefined) {
      requireCondition(Number.isInteger(roi.baselineY) && roi.baselineY >= roi.y && roi.baselineY < roi.y + roi.height, "DIGITIZATION_BASELINE");
    }
    const traced = traceRowsForRoi(image, roi, inkCeiling, maxHeldColumns, input.strictTraceMaxThicknessPx);

    let baselineY = baselineExplicit
      ? roi.baselineY
      : (Number.isInteger(roi.baselineY) ? roi.baselineY : roi.y + Math.floor(roi.height * 0.55));
    let baselineSource = baselineExplicit ? "EXPLICIT_ROI" : "ROI_GEOMETRY_ASSUMPTION_55_PERCENT";
    let baselineEvidence = null;

    if (!baselineExplicit && input.allowTraceBaselineEstimation === true) {
      baselineEvidence = estimateTraceBaseline({
        ys: traced.observedYs,
        roi,
        pxPerMm: cal.pxPerMm,
        minObservedColumns: input.baselineMinObservedColumns,
        tolerancePx: input.baselineTolerancePx,
        minInlierFraction: input.baselineMinInlierFraction,
        minDominantFraction: input.baselineMinDominantFraction,
      });
      if (baselineEvidence.verified === true) {
        baselineY = baselineEvidence.baselineY;
        baselineSource = "TRACE_BASELINE_VERIFIED";
      }
    }

    const samples = traced.ys.map(absY => {
      const mv = (baselineY - absY) / cal.pxPerMv;
      requireCondition(Number.isFinite(mv), "DIGITIZATION_NONFINITE");
      return mv;
    });

    const hasPaperWindow =
      Number.isInteger(roi.row) &&
      Number.isInteger(roi.col) &&
      typeof roi.durationS === "number" &&
      Number.isFinite(roi.durationS) &&
      roi.durationS > 0;
    const paperWindow = hasPaperWindow ? {
      row: roi.row,
      col: roi.col,
      startSeconds: roi.rhythmStrip === true ? 0 : roi.col * roi.durationS,
      durationSeconds: roi.durationS,
      rhythmStrip: roi.rhythmStrip === true,
      source: "ROI_LAYOUT_METADATA",
    } : null;
    return {
      lead: roi.lead,
      rhythmStrip: roi.rhythmStrip === true,
      sampleRateHz,
      unit: "mV",
      samples,
      sampleCount: samples.length,
      baselineY,
      paperWindow,
      quality: {
        ...addPixelUncertainty(traced.quality, cal),
        baselineSource,
        baselineEvidence,
      },
    };
  });
  return {
    schema: "ekg-image-digitization-v1",
    leadCount: leads.length,
    sampleRateHz,
    unit: "mV",
    paperSpeedMmPerS: cal.paperSpeedMmPerS || null,
    gainMmPerMv: cal.gainMmPerMv || null,
    leads,
    ...DIGITIZATION_GOVERNANCE,
  };
}

function peakAmplitude(samples) {
  let peak = 0;
  for (const v of samples) if (Math.abs(v) > Math.abs(peak)) peak = v;
  return peak;
}

function pearson(a, b) {
  requireCondition(Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.length > 2, "DIGITIZATION_COMPARE_SHAPE");
  const n = a.length;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  requireCondition(da > 0 && db > 0, "DIGITIZATION_COMPARE_FLAT");
  return num / Math.sqrt(da * db);
}

module.exports = {
  DIGITIZATION_GOVERNANCE,
  digitizeLeadRois,
  digitizeRoi,
  traceRowsForRoi,
  peakAmplitude,
  pearson,
};
