"use strict";

const { parseHeaderDetailed } = require("./wfdb_signal");
const { runSignalIntelligenceWorkflow } = require("./signal_intelligence_workflow");

const MULTILEAD_GOVERNANCE = Object.freeze({
  authorityClass: "EVALUATION_NONRUNTIME",
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

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarizeMetric(rows, field) {
  const values = rows.map(row => finiteOrNull(row.features[field])).filter(v => v !== null);
  if (!values.length) return { count: 0, min: null, max: null, median: null, range: null };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    count: values.length,
    min,
    max,
    median: median(values),
    range: max - min,
  };
}

function reasonCode(error) {
  return String(error && error.message ? error.message : error).split(":")[0] || "MULTILEAD_UNKNOWN_FAILURE";
}

function validateRequestedLeads(header, leadNames) {
  const available = header.signals.map(signal => signal.leadName);
  const requested = leadNames === undefined ? available.slice() : leadNames;
  requireCondition(Array.isArray(requested) && requested.length > 0, "MULTILEAD_LEADS_REQUIRED");
  requireCondition(new Set(requested).size === requested.length, "MULTILEAD_DUPLICATE_LEAD");
  for (const lead of requested) requireCondition(available.includes(lead), `MULTILEAD_LEAD_NOT_FOUND:${lead}`);
  return requested;
}

function aggregateCandidateEvidence(successes) {
  const byCode = new Map();
  for (const row of successes) {
    for (const candidate of row.analysis.candidatePhenotypes.candidates) {
      if (!byCode.has(candidate.phenotypeCode)) byCode.set(candidate.phenotypeCode, []);
      byCode.get(candidate.phenotypeCode).push({ lead: row.lead, ...candidate });
    }
  }
  return [...byCode.entries()].map(([candidateCode, evidence]) => {
    const supportingLeads = evidence.filter(x => x.state === "CANDIDATE_DETECTED").map(x => x.lead);
    const counterEvidenceLeads = evidence.filter(x => x.state === "CANDIDATE_NOT_DETECTED").map(x => x.lead);
    const insufficientLeads = evidence.filter(x => x.state === "INSUFFICIENT_DATA").map(x => x.lead);
    const state = supportingLeads.length
      ? "MULTILEAD_CANDIDATE_EVIDENCE_PRESENT"
      : counterEvidenceLeads.length
        ? "MULTILEAD_CANDIDATE_EVIDENCE_NOT_OBSERVED"
        : "MULTILEAD_INSUFFICIENT_DATA";
    return {
      candidateCode,
      state,
      supportingLeads,
      counterEvidenceLeads,
      insufficientLeads,
      evidence: evidence.map(x => ({
        lead: x.lead,
        state: x.state,
        observed: x.observed,
        configuredThreshold: x.configuredThreshold,
        reason: x.reason,
      })),
    };
  });
}

function runMultiLeadSignalIntelligence(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "MULTILEAD_INPUT_REQUIRED");
  requireCondition(typeof input.headerText === "string" && input.headerText.length > 0, "MULTILEAD_HEADER_REQUIRED");
  requireCondition(Buffer.isBuffer(input.dataBuffer), "MULTILEAD_DATA_REQUIRED");
  requireCondition(input.measurementConfig && typeof input.measurementConfig === "object", "MULTILEAD_MEASUREMENT_CONFIG_REQUIRED");
  requireCondition(input.phenotypeConfig && typeof input.phenotypeConfig === "object", "MULTILEAD_PHENOTYPE_CONFIG_REQUIRED");
  requireCondition(typeof input.thresholdAuthority === "string" && input.thresholdAuthority.trim(), "MULTILEAD_THRESHOLD_AUTHORITY_REQUIRED");
  requireCondition(input.provenance && typeof input.provenance === "object", "MULTILEAD_PROVENANCE_REQUIRED");

  const header = parseHeaderDetailed(input.headerText);
  const requestedLeads = validateRequestedLeads(header, input.leadNames);
  const successes = [];
  const failures = [];
  const skipReasons = {};
  for (const lead of requestedLeads) {
    try {
      const analysis = runSignalIntelligenceWorkflow({
        headerText: input.headerText,
        dataBuffer: input.dataBuffer,
        leadName: lead,
        measurementConfig: input.measurementConfig,
        phenotypeConfig: input.phenotypeConfig,
        provenance: input.provenance,
      });
      successes.push({ lead, analysis });
    } catch (error) {
      const reason = reasonCode(error);
      failures.push({ lead, reason });
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    }
  }
  requireCondition(successes.length > 0, "MULTILEAD_NO_USABLE_LEADS");

  const consistencyRows = successes.map(row => ({
    lead: row.lead,
    features: {
      beatCount: row.analysis.features.beatCount,
      ventricularRateBpm: row.analysis.features.intervals.ventricularRateFromMedianRrBpm,
      prMedianMs: row.analysis.features.intervals.prMedianMs,
      qrsMedianMs: row.analysis.features.intervals.qrsMedianMs,
      qtMedianMs: row.analysis.features.intervals.qtMedianMs,
      qtcFridericiaMedianMs: row.analysis.features.intervals.qtcFridericiaMedianMs,
    },
  }));
  const candidateEvidence = aggregateCandidateEvidence(successes);
  return {
    schema: "ekg-multilead-signal-intelligence-v1",
    record: header.record,
    requestedLeads,
    processedLeads: successes.map(row => row.lead),
    leadAnalyses: successes,
    failures,
    failureAccounting: {
      attempted: requestedLeads.length,
      processed: successes.length,
      skipped: failures.length,
      exceptionPolicy: "fail-lead-and-categorize",
      skipReasons,
    },
    crossLeadConsistency: {
      beatCount: summarizeMetric(consistencyRows, "beatCount"),
      ventricularRateBpm: summarizeMetric(consistencyRows, "ventricularRateBpm"),
      prMedianMs: summarizeMetric(consistencyRows, "prMedianMs"),
      qrsMedianMs: summarizeMetric(consistencyRows, "qrsMedianMs"),
      qtMedianMs: summarizeMetric(consistencyRows, "qtMedianMs"),
      qtcFridericiaMedianMs: summarizeMetric(consistencyRows, "qtcFridericiaMedianMs"),
    },
    candidateEvidence,
    thresholdAuthority: input.thresholdAuthority,
    provenance: { ...input.provenance, projectGold: false, runtimeAuthority: false },
    diagnosticInterpretationIncluded: false,
    ...MULTILEAD_GOVERNANCE,
  };
}

module.exports = {
  MULTILEAD_GOVERNANCE,
  aggregateCandidateEvidence,
  runMultiLeadSignalIntelligence,
  summarizeMetric,
};
