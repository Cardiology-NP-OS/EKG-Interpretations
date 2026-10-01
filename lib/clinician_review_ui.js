"use strict";

const { buildEvidenceBackedInterpretation } = require("./evidence_backed_interpretation");

const AMP = String.fromCharCode(38);

function escapeHtml(value) {
  return String(value)
    .replaceAll(AMP, AMP + "amp;")
    .replaceAll("<", AMP + "lt;")
    .replaceAll(">", AMP + "gt;")
    .replaceAll("\"", AMP + "quot;")
    .replaceAll("'", AMP + "#39;");
}

function renderClinicianReviewUi(fileOrDir, analysisId, bundleId) {
  const interpretation = buildEvidenceBackedInterpretation(fileOrDir, analysisId, bundleId);
  const intervals = escapeHtml(JSON.stringify(interpretation.citedIntervals, null, 2));
  const html = [
    "<!DOCTYPE html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\"><title>ECG review</title></head><body>",
    "<h1>ECG clinician review</h1>",
    `<p>${escapeHtml(interpretation.notice)}</p>`,
    "<p>Evidence-backed interpretation: not available. Reason: NO_ADMITTED_CLINICAL_GOLD. Approved adjudicated gold count: 0.</p>",
    `<p>Session result: ${escapeHtml(interpretation.result)}. Critical error: ${interpretation.criticalError}. Averaged: false.</p>`,
    `<p>Analysis ${escapeHtml(interpretation.analysisId)}. Bundle ${escapeHtml(interpretation.bundleId)}.</p>`,
    `<pre>${intervals}</pre>`,
    "<p>Clinical release is not authorized. This page has no diagnosis and no release control.</p>",
    "</body></html>",
    "",
  ].join("\n");
  if (html.includes("<script") || html.includes("clinicalReleaseAuthorized: true") || html.includes("evidenceBacked: true")) {
    throw new Error("REVIEW_UI_AUTHORITY");
  }
  return Object.freeze({
    schema: "ekg-clinician-review-ui-v1",
    analysisId: interpretation.analysisId,
    bundleId: interpretation.bundleId,
    html,
    evidenceBacked: false,
    diagnosticInterpretationIncluded: false,
    clinicalReleaseAuthorized: false,
    result: interpretation.result,
    criticalError: interpretation.criticalError,
    notice: interpretation.notice,
  });
}

module.exports = { renderClinicianReviewUi };
