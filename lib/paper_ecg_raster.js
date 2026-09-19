"use strict";

const IMAGE_RASTER_GOVERNANCE = Object.freeze({
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

const STANDARD_LEADS = Object.freeze([
  "I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6",
]);
const LAYOUT_3X4_RHYTHM = Object.freeze([
  ["I", "aVR", "V1", "V4"],
  ["II", "aVL", "V2", "V5"],
  ["III", "aVF", "V3", "V6"],
  ["II"],
]);
const MAX_WIDTH = 4000;
const MAX_HEIGHT = 4000;
const MAX_SAMPLES = 20000;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}
function requireFinite(value, code) {
  requireCondition(typeof value === "number" && Number.isFinite(value), code);
  return value;
}

function defaultGeometry() {
  return {
    pxPerMm: 5,
    paperSpeedMmPerS: 25,
    gainMmPerMv: 10,
    panelDurationS: 2.5,
    rhythmDurationS: 10,
    marginMm: 8,
    rowHeightMm: 40,
    minorMm: 1,
    majorMm: 5,
    background: 255,
    minorGrid: 228,
    majorGrid: 196,
    trace: 16,
  };
}

function normalizeGeometry(input) {
  const g = { ...defaultGeometry(), ...(input || {}) };
  requireCondition(Number.isInteger(g.pxPerMm) && g.pxPerMm >= 2 && g.pxPerMm <= 12, "RASTER_PX_PER_MM");
  requireCondition(g.paperSpeedMmPerS === 25 || g.paperSpeedMmPerS === 50, "RASTER_PAPER_SPEED");
  requireCondition(g.gainMmPerMv === 5 || g.gainMmPerMv === 10 || g.gainMmPerMv === 20, "RASTER_GAIN");
  requireFinite(g.panelDurationS, "RASTER_PANEL_DURATION");
  requireCondition(g.panelDurationS > 0 && g.panelDurationS <= 10, "RASTER_PANEL_DURATION");
  return g;
}

function finiteSamples(values) {
  requireCondition(Array.isArray(values) && values.length > 0 && values.length <= MAX_SAMPLES, "RASTER_SAMPLES_REQUIRED");
  return values.map(value => requireFinite(value, "RASTER_NONFINITE_SAMPLE"));
}

function setPixel(image, x, y, value) {
  if (y < 0 || y >= image.length || x < 0 || x >= image[0].length) return;
  if (value < image[y][x]) image[y][x] = value;
}

function drawLine(image, x0, y0, x1, y1, value) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xEnd = Math.round(x1);
  const yEnd = Math.round(y1);
  const dx = Math.abs(xEnd - x);
  const dy = Math.abs(yEnd - y);
  const sx = x < xEnd ? 1 : -1;
  const sy = y < yEnd ? 1 : -1;
  let err = dx - dy;
  while (true) {
    setPixel(image, x, y, value);
    if (x === xEnd && y === yEnd) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function createCanvas(width, height, fill) {
  requireCondition(Number.isInteger(width) && width >= 40 && width <= MAX_WIDTH, "RASTER_WIDTH");
  requireCondition(Number.isInteger(height) && height >= 40 && height <= MAX_HEIGHT, "RASTER_HEIGHT");
  return Array.from({ length: height }, () => Array(width).fill(fill));
}

function drawGrid(image, g) {
  const h = image.length;
  const w = image[0].length;
  const minor = g.pxPerMm * g.minorMm;
  const major = g.pxPerMm * g.majorMm;
  for (let x = 0; x < w; x += 1) {
    const v = x % major === 0 ? g.majorGrid : (x % minor === 0 ? g.minorGrid : null);
    if (v === null) continue;
    for (let y = 0; y < h; y += 1) image[y][x] = Math.min(image[y][x], v);
  }
  for (let y = 0; y < h; y += 1) {
    const v = y % major === 0 ? g.majorGrid : (y % minor === 0 ? g.minorGrid : null);
    if (v === null) continue;
    for (let x = 0; x < w; x += 1) image[y][x] = Math.min(image[y][x], v);
  }
}

function panelBox(g, row, col, cols) {
  const px = g.pxPerMm;
  const margin = g.marginMm * px;
  const rowH = g.rowHeightMm * px;
  const duration = row === 3 ? g.rhythmDurationS : g.panelDurationS;
  const pxPerSecond = g.paperSpeedMmPerS * px;
  const fullW = Math.round(g.rhythmDurationS * pxPerSecond);
  const panelStart = row === 3 ? 0 : Math.round(col * g.panelDurationS * pxPerSecond);
  const panelEnd = row === 3
    ? fullW
    : Math.round((col + 1) * g.panelDurationS * pxPerSecond);
  const x = margin + panelStart;
  const y = margin + row * rowH;
  const width = panelEnd - panelStart;
  requireCondition(width > 0, "RASTER_PANEL_WIDTH");
  return { x, y, width, height: rowH, durationS: duration };
}

function drawTrace(image, samples, box, sampleRateHz, g) {
  const pxPerSec = g.paperSpeedMmPerS * g.pxPerMm;
  const pxPerMv = g.gainMmPerMv * g.pxPerMm;
  const baselineY = box.y + Math.floor(box.height * 0.55);
  const usable = Math.min(samples.length, Math.max(2, Math.floor(box.durationS * sampleRateHz)));
  let prevX = box.x;
  let prevY = baselineY - samples[0] * pxPerMv;
  for (let i = 1; i < usable; i += 1) {
    const t = i / sampleRateHz;
    const x = box.x + t * pxPerSec;
    if (x >= box.x + box.width) break;
    const y = baselineY - samples[i] * pxPerMv;
    drawLine(image, prevX, prevY, x, y, g.trace);
    prevX = x;
    prevY = y;
  }
  return { baselineY, usable };
}

function normalizeLeadMap(leads) {
  requireCondition(leads && typeof leads === "object" && !Array.isArray(leads), "RASTER_LEAD_MAP_REQUIRED");
  const out = {};
  for (const name of STANDARD_LEADS) {
    requireCondition(Array.isArray(leads[name]), `RASTER_LEAD_MISSING:${name}`);
    out[name] = finiteSamples(leads[name]);
  }
  return out;
}

function renderPaperEcgRaster(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "RASTER_INPUT_REQUIRED");
  const g = normalizeGeometry(input.geometry);
  const sampleRateHz = requireFinite(input.sampleRateHz, "RASTER_SAMPLE_RATE");
  requireCondition(sampleRateHz >= 50 && sampleRateHz <= 1000, "RASTER_SAMPLE_RATE");
  const leadMap = normalizeLeadMap(input.leads);
  const layout = input.layout || LAYOUT_3X4_RHYTHM;
  requireCondition(Array.isArray(layout) && layout.length === 4, "RASTER_LAYOUT");
  const margin = g.marginMm * g.pxPerMm;
  const width = margin * 2 + Math.round(g.rhythmDurationS * g.paperSpeedMmPerS * g.pxPerMm);
  const height = margin * 2 + 4 * g.rowHeightMm * g.pxPerMm;
  const image = createCanvas(width, height, g.background);
  drawGrid(image, g);
  const rois = [];
  for (let row = 0; row < layout.length; row += 1) {
    const cols = layout[row];
    requireCondition(Array.isArray(cols) && cols.length > 0, "RASTER_LAYOUT_ROW");
    for (let col = 0; col < cols.length; col += 1) {
      const lead = cols[col];
      requireCondition(typeof lead === "string" && leadMap[lead], `RASTER_LAYOUT_LEAD:${lead}`);
      const box = panelBox(g, row, col, cols.length);
      const drawn = drawTrace(image, leadMap[lead], box, sampleRateHz, g);
      rois.push({
        lead,
        row,
        col,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        baselineY: drawn.baselineY,
        durationS: box.durationS,
        rhythmStrip: row === 3,
      });
    }
  }
  return {
    schema: "ekg-paper-ecg-raster-v1",
    image,
    width,
    height,
    sampleRateHz,
    geometry: {
      pxPerMm: g.pxPerMm,
      paperSpeedMmPerS: g.paperSpeedMmPerS,
      gainMmPerMv: g.gainMmPerMv,
      panelDurationS: g.panelDurationS,
      rhythmDurationS: g.rhythmDurationS,
    },
    rois,
    layoutName: "3x4-plus-rhythm-v1",
    ...IMAGE_RASTER_GOVERNANCE,
  };
}

function syntheticQrsLead(sampleRateHz, seconds, amplitudeMv, qrsAtS) {
  requireFinite(sampleRateHz, "RASTER_SAMPLE_RATE");
  requireFinite(seconds, "RASTER_DURATION");
  requireFinite(amplitudeMv, "RASTER_AMPLITUDE");
  const n = Math.round(seconds * sampleRateHz);
  requireCondition(n >= 8 && n <= MAX_SAMPLES, "RASTER_DURATION");
  const samples = Array(n).fill(0);
  const centers = Array.isArray(qrsAtS) ? qrsAtS : [1.0, 1.8, 2.6, 3.4, 4.2, 5.0, 5.8, 6.6, 7.4, 8.2, 9.0];
  for (const t0 of centers) {
    const i = Math.round(t0 * sampleRateHz);
    if (i < 2 || i >= n - 2) continue;
    samples[i - 2] += -0.15 * amplitudeMv;
    samples[i] += amplitudeMv;
    samples[i + 1] += -0.25 * amplitudeMv;
  }
  return samples;
}

function syntheticLeadMap(sampleRateHz = 250, seconds = 10) {
  const map = {};
  STANDARD_LEADS.forEach((lead, index) => {
    map[lead] = syntheticQrsLead(sampleRateHz, seconds, 0.8 + index * 0.05, undefined);
  });
  return map;
}

module.exports = {
  IMAGE_RASTER_GOVERNANCE,
  LAYOUT_3X4_RHYTHM,
  STANDARD_LEADS,
  createCanvas,
  defaultGeometry,
  renderPaperEcgRaster,
  syntheticLeadMap,
  syntheticQrsLead,
};
