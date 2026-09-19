"use strict";

const { STANDARD_LEADS, LAYOUT_3X4_RHYTHM } = require("./paper_ecg_raster");
const { normalizeImage } = require("./image_robustness");

const DISCOVERY_GOVERNANCE = Object.freeze({
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

function rowInkFractions(image, inkCeiling) {
  return image.map((row) => {
    let ink = 0;
    for (let x = 0; x < row.length; x += 1) if (row[x] <= inkCeiling) ink += 1;
    return ink / row.length;
  });
}

function contiguousBands(scores, minScore, minWidth) {
  const bands = [];
  let start = -1;
  for (let i = 0; i <= scores.length; i += 1) {
    const on = i < scores.length && scores[i] >= minScore;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - start >= minWidth) bands.push({ start, end: i });
      start = -1;
    }
  }
  return bands;
}

function mergeNearest(bands, targetCount) {
  const out = bands.map((b) => ({ ...b }));
  while (out.length > targetCount) {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < out.length - 1; i += 1) {
      const gap = out[i + 1].start - out[i].end;
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    out[best] = { start: out[best].start, end: out[best + 1].end };
    out.splice(best + 1, 1);
  }
  return out;
}

function discoverStandardLayoutRois(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "DISCOVERY_INPUT_REQUIRED");
  const image = normalizeImage(input.image);
  const h = image.length;
  const w = image[0].length;
  const pxPerMm = input.pxPerMm;
  requireCondition(Number.isFinite(pxPerMm) && pxPerMm >= 2 && pxPerMm <= 12, "DISCOVERY_PX_PER_MM");
  const paperSpeedMmPerS = input.paperSpeedMmPerS === undefined ? 25 : input.paperSpeedMmPerS;
  requireCondition(paperSpeedMmPerS === 25 || paperSpeedMmPerS === 50, "DISCOVERY_PAPER_SPEED");
  const inkCeiling = input.inkCeiling === undefined ? 40 : input.inkCeiling;
  const minRowInk = input.minRowInk === undefined ? 0.0004 : input.minRowInk;
  const panelDurationS = 2.5;
  const rhythmDurationS = 10;
  const panelW = Math.round(panelDurationS * paperSpeedMmPerS * pxPerMm);
  const rhythmW = Math.round(rhythmDurationS * paperSpeedMmPerS * pxPerMm);
  requireCondition(w >= rhythmW, "DISCOVERY_WIDTH_TOO_SMALL");

  let bands = contiguousBands(rowInkFractions(image, inkCeiling), minRowInk, Math.max(8, Math.floor(pxPerMm * 4)));
  requireCondition(bands.length >= 1, "DISCOVERY_NO_INK_BANDS");
  if (bands.length > 4) bands = mergeNearest(bands, 4);
  requireCondition(bands.length === 4, `DISCOVERY_ROW_COUNT:${bands.length}`);

  const layout = LAYOUT_3X4_RHYTHM;
  const rois = [];
  for (let row = 0; row < 4; row += 1) {
    const band = bands[row];
    const height = band.end - band.start;
    requireCondition(height >= 8, "DISCOVERY_ROW_TOO_SHORT");
    const leads = layout[row];
    const cols = leads.length;
    const usedW = row === 3 ? rhythmW : panelW * cols;
    let x0 = 0;
    let bestInk = -1;
    const maxOrigin = Math.max(0, w - usedW);
    const step = Math.max(1, Math.floor(pxPerMm));
    for (let x = 0; x <= maxOrigin; x += step) {
      let ink = 0;
      const x1 = x + usedW;
      for (let y = band.start; y < band.end; y += 1) {
        const line = image[y];
        for (let xi = x; xi < x1; xi += 1) if (line[xi] <= inkCeiling) ink += 1;
      }
      if (ink > bestInk) {
        bestInk = ink;
        x0 = x;
      }
    }
    requireCondition(bestInk > 0, `DISCOVERY_NO_TRACE:${row}`);
    for (let col = 0; col < cols; col += 1) {
      const width = row === 3 ? rhythmW : panelW;
      const x = x0 + col * (row === 3 ? 0 : panelW);
      requireCondition(x + width <= w, "DISCOVERY_BOX_BOUNDS");
      rois.push({
        lead: leads[col],
        row,
        col,
        x,
        y: band.start,
        width,
        height,
        baselineY: band.start + Math.floor(height * 0.55),
        durationS: row === 3 ? rhythmDurationS : panelDurationS,
        rhythmStrip: row === 3,
        discovered: true,
      });
    }
  }

  const panels = rois.filter((r) => !r.rhythmStrip).map((r) => r.lead);
  const missing = STANDARD_LEADS.filter((lead) => !panels.includes(lead));
  requireCondition(missing.length === 0, `DISCOVERY_INCOMPLETE:${missing.join(",")}`);

  return {
    schema: "ekg-image-roi-discovery-v1",
    layoutName: "3x4-plus-rhythm-v1",
    roiCount: rois.length,
    rois,
    missingStandardLeads: missing,
    completeTwelveLeadPanels: true,
    ...DISCOVERY_GOVERNANCE,
  };
}

module.exports = { DISCOVERY_GOVERNANCE, discoverStandardLayoutRois };
