"use strict";

const { normalizeImage } = require("./image_robustness");

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

function digitizeRoi(image, roi, calibration, inkCeiling) {
  requireCondition(roi && Number.isInteger(roi.x), "DIGITIZATION_ROI");
  const samples = [];
  const ys = [];
  const x1 = roi.x + roi.width;
  for (let x = roi.x; x < x1; x += 1) {
    const column = [];
    for (let y = roi.y; y < roi.y + roi.height; y += 1) column.push(image[y][x]);
    const local = columnTraceY(column, inkCeiling);
    requireCondition(local >= 0, `DIGITIZATION_NO_INK_COLUMN:${roi.lead}:${x}`);
    const absY = roi.y + local;
    ys.push(absY);
    const mv = (calibration.baselineY - absY) / calibration.pxPerMv;
    requireCondition(Number.isFinite(mv), "DIGITIZATION_NONFINITE");
    samples.push(mv);
  }
  return { samples, ys };
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
  const sampleRateHz = cal.pxPerSecond;
  const leads = input.rois.map(roi => {
    requireCondition(typeof roi.lead === "string" && roi.lead.length > 0, "DIGITIZATION_LEAD_LABEL");
    const baselineY = Number.isInteger(roi.baselineY)
      ? roi.baselineY
      : roi.y + Math.floor(roi.height * 0.55);
    const extracted = digitizeRoi(image, roi, {
      baselineY,
      pxPerMv: cal.pxPerMv,
    }, inkCeiling);
    return {
      lead: roi.lead,
      rhythmStrip: roi.rhythmStrip === true,
      sampleRateHz,
      unit: "mV",
      samples: extracted.samples,
      sampleCount: extracted.samples.length,
      baselineY,
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
  peakAmplitude,
  pearson,
};
