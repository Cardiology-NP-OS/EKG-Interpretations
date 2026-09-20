"use strict";

const assert = require("assert");
const { renderPaperEcgRaster, syntheticLeadMap } = require("../lib/paper_ecg_raster");
const {
  LEAD_IDENTITY_GOVERNANCE,
  renderLeadLabel,
  verifyLeadLabelsFromRaster,
} = require("../lib/image_lead_identity");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function labeledFixture() {
  const paper = renderPaperEcgRaster({
    leads: syntheticLeadMap(250, 10),
    sampleRateHz: 250,
    geometry: { pxPerMm: 5 },
  });
  const image = paper.image.map(row => row.slice());
  for (const roi of paper.rois) {
    renderLeadLabel(image, roi.lead, roi.x + 4, roi.y - 18, { scale: 2, value: 8 });
  }
  return { paper, image };
}

test("strict raster labels verify all synthetic 12-lead identities", () => {
  const { paper, image } = labeledFixture();
  const result = verifyLeadLabelsFromRaster({
    image,
    rois: paper.rois,
    scale: 2,
    darkThreshold: 80,
    searchRadius: 3,
    minScore: 0.9,
  });
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.totalLeadCount, 13);
  assert.strictEqual(result.verifiedLeadCount, 13);
  assert.deepStrictEqual(result.failedLabels, []);
  assert.deepStrictEqual(result.missingStandardLeads, []);
  assert.ok(result.results.every(row => row.score >= 0.9));
  assert.strictEqual(result.runtimeAuthority, false);
});

test("wrong positional lead hypothesis fails label verification", () => {
  const { paper, image } = labeledFixture();
  const rois = paper.rois.map(roi => ({ ...roi }));
  const leadI = rois.find(roi => roi.lead === "I" && !roi.rhythmStrip);
  leadI.lead = "V1";
  const result = verifyLeadLabelsFromRaster({
    image,
    rois,
    scale: 2,
    darkThreshold: 80,
    searchRadius: 3,
    minScore: 0.9,
  });
  assert.strictEqual(result.verified, false);
  assert.ok(result.failedLabels.includes("V1"));
});

test("missing printed label fails closed", () => {
  const { paper, image } = labeledFixture();
  const target = paper.rois.find(roi => roi.lead === "V6");
  for (let y = target.y - 20; y < target.y; y += 1) {
    for (let x = target.x; x < target.x + 50; x += 1) image[y][x] = 255;
  }
  const result = verifyLeadLabelsFromRaster({
    image,
    rois: paper.rois,
    scale: 2,
    darkThreshold: 80,
    searchRadius: 3,
    minScore: 0.9,
  });
  assert.strictEqual(result.verified, false);
  assert.ok(result.failedLabels.includes("V6"));
});

test("lead identity verifier remains governed inactive", () => {
  assert.strictEqual(LEAD_IDENTITY_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(LEAD_IDENTITY_GOVERNANCE.projectGold, false);
  assert.strictEqual(LEAD_IDENTITY_GOVERNANCE.metrics, "NOT_REPORTABLE");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-image-lead-identity-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  clinicalAuthorityAdded: false,
}));
