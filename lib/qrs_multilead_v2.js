"use strict";

const { detectCandidateRPeaksV2 } = require("./qrs_detector_v2");
const { MEASUREMENT_GOVERNANCE } = require("./signal_measurement_contract");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function quantile(values, probability) {
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const left = Math.floor(position);
  const fraction = position - left;
  return sorted[left] + ((sorted[left + 1] === undefined ? sorted[left] : sorted[left + 1]) - sorted[left]) * fraction;
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function assessQrsLeadQuality(lead) {
  requireCondition(lead && typeof lead === "object" && !Array.isArray(lead), "QRS_V2_LEAD_REQUIRED");
  requireCondition(typeof lead.leadName === "string" && lead.leadName.length > 0, "QRS_V2_LEAD_NAME_REQUIRED");
  requireCondition(Array.isArray(lead.samples) && lead.samples.length >= 32, "QRS_V2_LEAD_SAMPLES_REQUIRED");
  const samples = lead.samples.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), "QRS_V2_LEAD_NONFINITE_SAMPLE");
    return value;
  });
  const sorted = samples.slice().sort((a, b) => a - b);
  const robustSpan = quantile(sorted, 0.99) - quantile(sorted, 0.01);
  const differences = [];
  let constantTransitions = 0;
  for (let i = 1; i < samples.length; i += 1) {
    differences.push(Math.abs(samples[i] - samples[i - 1]));
    if (samples[i] === samples[i - 1]) constantTransitions += 1;
  }
  const derivativeMedian = quantile(differences, 0.5);
  const derivativeTail = quantile(differences, 0.98);
  const flatFraction = constantTransitions / (samples.length - 1);
  const impulseToBackground = derivativeTail / (derivativeMedian + Math.max(1e-12, robustSpan * 1e-6));
  const usable = robustSpan > 1e-9 && flatFraction < 0.995;
  const score = usable ? Math.log1p(Math.max(0, robustSpan)) * Math.log1p(impulseToBackground) * (1 - flatFraction) : 0;
  return {
    leadName: lead.leadName,
    usable,
    qualityScore: round(score),
    robustSpan: round(robustSpan),
    derivativeMedian: round(derivativeMedian),
    derivativeTail: round(derivativeTail),
    flatFraction: round(flatFraction),
    method: "robust-span-impulse-to-background-flatline-v2",
  };
}

function detectCandidateRPeaksMultiLeadV2(leads, sampleRateHz, options = {}) {
  requireCondition(Array.isArray(leads) && leads.length > 0, "QRS_V2_MULTILEAD_REQUIRED");
  requireCondition(Number.isFinite(sampleRateHz) && sampleRateHz > 0, "QRS_V2_SAMPLE_RATE");
  requireCondition(options.provenance && typeof options.provenance === "object", "MEASURE_PROVENANCE_REQUIRED");
  const names = leads.map(lead => lead.leadName);
  requireCondition(new Set(names).size === names.length, "QRS_V2_DUPLICATE_LEAD_NAME");
  const length = leads[0].samples.length;
  leads.forEach(lead => requireCondition(lead.samples.length === length, "QRS_V2_LEAD_LENGTH_MISMATCH"));
  const quality = leads.map((lead, index) => ({ index, ...assessQrsLeadQuality(lead) }));
  const ranked = quality.filter(row => row.usable).sort((a, b) =>
    b.qualityScore - a.qualityScore || a.leadName.localeCompare(b.leadName) || a.index - b.index
  );
  requireCondition(ranked.length > 0, "QRS_V2_NO_USABLE_LEADS");
  const failures = [];
  let selected = null;
  for (const row of ranked) {
    try {
      const detection = detectCandidateRPeaksV2(leads[row.index].samples, sampleRateHz, options);
      if (detection.events.length > 0) {
        selected = { row, detection };
        break;
      }
      failures.push({ leadName: row.leadName, reason: "QRS_V2_NO_ACCEPTED_EVENTS" });
    } catch (error) {
      failures.push({ leadName: row.leadName, reason: String(error.message || error).split(":")[0] });
    }
  }
  requireCondition(selected, "QRS_V2_MULTILEAD_DETECTION_FAILED");
  return {
    schema: "ekg-multilead-rpeak-candidate-events-v2",
    algorithm: "target-owned-quality-ranked-best-lead-qrs-v2",
    selectedLeadName: selected.row.leadName,
    selectionMethod: "highest-deterministic-unsupervised-engineering-quality-score-with-failover",
    leadQuality: quality.map(row => {
      const { index, ...publicRow } = row;
      return publicRow;
    }),
    detection: selected.detection,
    failedLeadAttempts: failures,
    singleLeadFallbackSupported: true,
    provenance: { ...options.provenance, projectGold: false, runtimeAuthority: false },
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}

module.exports = {
  assessQrsLeadQuality,
  detectCandidateRPeaksMultiLeadV2,
};
