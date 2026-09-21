"use strict";

const { STANDARD_LEADS } = require("./paper_ecg_raster");
const { normalizeImage } = require("./image_robustness");

const ROI_GOVERNANCE = Object.freeze({
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

function inkScore(image, box, inkCeiling) {
  let ink = 0;
  let n = 0;
  const y1 = box.y + box.height;
  const x1 = box.x + box.width;
  for (let y = box.y; y < y1; y += 1) {
    const row = image[y];
    for (let x = box.x; x < x1; x += 1) {
      n += 1;
      if (row[x] <= inkCeiling) ink += 1;
    }
  }
  requireCondition(n > 0, "ROI_EMPTY_BOX");
  return ink / n;
}

function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function localizeLeadRois(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "ROI_INPUT_REQUIRED");
  const image = normalizeImage(input.image);
  const h = image.length;
  const w = image[0].length;
  requireCondition(Array.isArray(input.expectedRois) && input.expectedRois.length > 0, "ROI_EXPECTED_REQUIRED");
  requireCondition(input.expectedRois.length <= 16, "ROI_COUNT_LIMIT");
  const inkCeiling = input.inkCeiling === undefined ? 40 : input.inkCeiling;
  requireCondition(Number.isInteger(inkCeiling) && inkCeiling >= 0 && inkCeiling <= 128, "ROI_INK_CEILING");
  const minInkFraction = input.minInkFraction === undefined ? 0.001 : input.minInkFraction;
  const seen = new Set();
  const rois = input.expectedRois.map((box, index) => {
    requireCondition(box && typeof box === "object" && !Array.isArray(box), "ROI_BOX_OBJECT");
    const lead = box.lead;
    requireCondition(typeof lead === "string" && lead.length > 0 && lead.length <= 8, "ROI_LEAD_LABEL");
    requireCondition(STANDARD_LEADS.includes(lead) || lead === "II", `ROI_LEAD_UNKNOWN:${lead}`);
    requireCondition(!seen.has(`${lead}:${box.rhythmStrip === true ? "rhythm" : "panel"}`), `ROI_DUPLICATE_LEAD:${lead}`);
    seen.add(`${lead}:${box.rhythmStrip === true ? "rhythm" : "panel"}`);
    ["x", "y", "width", "height"].forEach(key => {
      requireCondition(Number.isInteger(box[key]) && box[key] >= 0, `ROI_BOX_${key.toUpperCase()}`);
    });
    requireCondition(box.width >= 8 && box.height >= 8, "ROI_BOX_TOO_SMALL");
    requireCondition(box.x + box.width <= w && box.y + box.height <= h, "ROI_BOX_BOUNDS");
    const fraction = inkScore(image, box, inkCeiling);
    requireCondition(fraction >= minInkFraction, `ROI_NO_INK:${lead}`);
    return {
      lead,
      index,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rhythmStrip: box.rhythmStrip === true,
      inkFraction: Number(fraction.toFixed(6)),
    };
  });
  for (let i = 0; i < rois.length; i += 1) {
    for (let j = i + 1; j < rois.length; j += 1) {
      requireCondition(!boxesOverlap(rois[i], rois[j]), `ROI_OVERLAP:${rois[i].lead}:${rois[j].lead}`);
    }
  }
  const panelLeads = rois.filter(r => !r.rhythmStrip).map(r => r.lead);
  const missing = STANDARD_LEADS.filter(lead => !panelLeads.includes(lead));
  return {
    schema: "ekg-image-roi-localization-v1",
    width: w,
    height: h,
    roiCount: rois.length,
    rois,
    missingStandardLeads: missing,
    completeTwelveLeadPanels: missing.length === 0,
    ...ROI_GOVERNANCE,
  };
}

module.exports = { ROI_GOVERNANCE, localizeLeadRois };
