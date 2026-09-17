"use strict";

const crypto = require("crypto");

const RENDER_GOVERNANCE = Object.freeze({
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
function finiteSamples(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "RENDER_SAMPLES_REQUIRED");
  requireCondition(values.length <= 1000000, "RENDER_SAMPLE_LIMIT");
  return values.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), "RENDER_NONFINITE_SAMPLE");
    return value;
  });
}
function escapeXml(value) {
  requireCondition(typeof value === "string" && value.length > 0 && value.length <= 64, "RENDER_LABEL_INVALID");
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function waveformPath(values, x, y, width, height) {
  const samples = finiteSamples(values);
  let maxAbs = 1;
  for (const value of samples) maxAbs = Math.max(maxAbs, Math.abs(value));
  const mid = y + height / 2;
  return samples.map((value, index) => {
    const px = x + (index / Math.max(1, samples.length - 1)) * width;
    const py = mid - (value / maxAbs) * (height * 0.42);
    return `${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
  }).join(" ");
}

function normalizeLeads(leads) {
  requireCondition(Array.isArray(leads) && leads.length > 0 && leads.length <= 64, "RENDER_LEADS_REQUIRED");
  return leads.map((lead, index) => {
    requireCondition(lead && typeof lead === "object" && !Array.isArray(lead), "RENDER_LEAD_OBJECT");
    const label = escapeXml(lead.label || lead.leadName || `lead-${index + 1}`);
    return { label, samples: finiteSamples(lead.samples) };
  });
}

function renderWaveformSvg(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "RENDER_INPUT_REQUIRED");
  const leads = normalizeLeads(input.leads);
  const width = input.width === undefined ? 1200 : input.width;
  const rowHeight = input.rowHeight === undefined ? 110 : input.rowHeight;
  requireCondition(Number.isInteger(width) && width >= 200 && width <= 10000, "RENDER_WIDTH_INVALID");
  requireCondition(Number.isInteger(rowHeight) && rowHeight >= 40 && rowHeight <= 1000, "RENDER_ROW_HEIGHT_INVALID");
  const height = rowHeight * leads.length;
  const rows = leads.map((lead, index) => {
    const y = index * rowHeight;
    const d = waveformPath(lead.samples, 70, y + 8, width - 90, rowHeight - 16);
    return [
      `<text x="8" y="${y + 24}" font-size="14">${lead.label}</text>`,
      `<path d="${d}" fill="none" stroke="black" stroke-width="1"/>`,
    ].join("");
  }).join("");
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`,
    ` viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="white"/>`,
    rows,
    `</svg>\n`,
  ].join("");
  return {
    schema: "ekg-waveform-render-v1",
    svg,
    svgSha256: crypto.createHash("sha256").update(svg).digest("hex"),
    leadCount: leads.length,
    normalization: "per-lead-maxabs-display-only",
    diagnosticInterpretationIncluded: false,
    ...RENDER_GOVERNANCE,
  };
}

module.exports = { RENDER_GOVERNANCE, escapeXml, renderWaveformSvg, waveformPath };
