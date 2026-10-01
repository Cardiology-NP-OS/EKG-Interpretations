"use strict";

const { readClinicianReviewBundle } = require("../lib/clinician_review_bundle");

const caseDir = process.argv[2];
const analysisId = process.argv[3];
const bundleId = process.argv[4];

if (!caseDir || !analysisId || !bundleId) {
  console.error("print-review-bundle: case directory, analysisId, and bundleId are required");
  process.exit(2);
}

const stored = readClinicianReviewBundle(caseDir, analysisId, bundleId);
process.stdout.write(`${JSON.stringify({
  result: stored.result,
  averaged: false,
  clinicalReleaseAuthorized: false,
})}\n`);
