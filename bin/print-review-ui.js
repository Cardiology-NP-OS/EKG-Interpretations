"use strict";

const { renderClinicianReviewUi } = require("../lib/clinician_review_ui");

const [caseDirectory, analysisId, bundleId] = process.argv.slice(2);
if (!caseDirectory || !analysisId || !bundleId) {
  process.stderr.write("usage: node bin/print-review-ui.js <case-directory> <analysis-id> <bundle-id>\n");
  process.exit(2);
}

const page = renderClinicianReviewUi(caseDirectory, analysisId, bundleId);
process.stdout.write(page.html);
