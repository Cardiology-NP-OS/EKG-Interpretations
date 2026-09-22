"use strict";

const assert = require("assert");
const { detectPanTompkinsRPeaks } = require("../lib/pan_tompkins_detector");
const { matchEventsV2 } = require("../lib/event_matcher_v2");

function syntheticSignal(length, peaks) {
  const samples = Array.from({ length }, (_, index) => 0.015 * Math.sin(index * 0.03));
  for (const peak of peaks) {
    const shape = [-0.2, -0.5, 0.2, 1.5, 0.2, -0.5, -0.2];
    shape.forEach((value, offset) => { samples[peak + offset - 3] += value; });
  }
  return samples;
}

const reference = [250, 500, 750, 1000];
const input = syntheticSignal(1250, reference);
const first = detectPanTompkinsRPeaks(input, 250, { provenance: { sourceKind: "synthetic_fixture", locator: "tests/pan_tompkins_detector.test.js" } });
const second = detectPanTompkinsRPeaks(input, 250, { provenance: { sourceKind: "synthetic_fixture", locator: "tests/pan_tompkins_detector.test.js" } });
assert.deepEqual(first, second);
assert.equal(first.algorithm, "target-owned-pan-tompkins-classical-baseline-v1");
assert.equal(first.clinicalValidityInferred, false);
const matching = matchEventsV2(reference, first.events.map(row => row.sampleIndex), { toleranceSamples: 20 });
assert.equal(matching.matchedCount, reference.length);
assert.equal(matching.falsePositiveCount, 0);
assert.throws(() => detectPanTompkinsRPeaks([0, 1], 250, { provenance: { sourceKind: "synthetic", locator: "short" } }), /PAN_TOMPKINS_SAMPLES_REQUIRED/);
assert.throws(() => detectPanTompkinsRPeaks(input, 250, {}), /PAN_TOMPKINS_PROVENANCE_REQUIRED/);
console.log("pan-tompkins detector tests passed");
