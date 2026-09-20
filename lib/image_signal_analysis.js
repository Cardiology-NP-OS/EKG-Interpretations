"use strict";

const { verifyExtractionIdentity, validateAnalysisPermissions } = require("./image_extraction_store");
const { runPhysicalLeadMeasurementPipeline } = require("./signal_measurement_pipeline");
const { extractRhythmFeatures } = require("./rhythm_feature_contract");
const { evaluateCandidatePhenotypes } = require("./candidate_phenotype_engine");
const { aggregateCandidateEvidence, summarizeMetric } = require("./multilead_signal_intelligence");

const STANDARD_LEADS = Object.freeze(["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]);
const ANALYSIS_GOVERNANCE = Object.freeze({
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

function validateConfig(config) {
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "IMAGE_ANALYSIS_CONFIG_REQUIRED");
  requireCondition(config.measurement && typeof config.measurement === "object", "IMAGE_ANALYSIS_MEASUREMENT_CONFIG");
  requireCondition(config.phenotypes && typeof config.phenotypes === "object", "IMAGE_ANALYSIS_PHENOTYPE_CONFIG");
  requireCondition(typeof config.thresholdAuthority === "string" && config.thresholdAuthority.trim().length > 0, "IMAGE_ANALYSIS_THRESHOLD_AUTHORITY");
  requireCondition(config.quality && typeof config.quality === "object", "IMAGE_ANALYSIS_QUALITY_CONFIG");
  requireCondition(Number.isInteger(config.quality.maxHeldGapColumns) && config.quality.maxHeldGapColumns >= 0 && config.quality.maxHeldGapColumns <= 8, "IMAGE_ANALYSIS_MAX_HELD_GAP");
  requireCondition(typeof config.quality.maxHeldFraction === "number" && Number.isFinite(config.quality.maxHeldFraction) && config.quality.maxHeldFraction >= 0 && config.quality.maxHeldFraction <= 1, "IMAGE_ANALYSIS_MAX_HELD_FRACTION");
  return config;
}

function reasonCode(error) {
  return String(error && error.message ? error.message : error).split(":")[0] || "IMAGE_ANALYSIS_UNKNOWN_FAILURE";
}

function selectCanonicalLeads(leads) {
  const selected = new Map();
  for (const lead of leads) {
    requireCondition(lead && typeof lead.lead === "string", "IMAGE_ANALYSIS_LEAD");
    const existing = selected.get(lead.lead);
    if (!existing || (lead.rhythmStrip === true && existing.rhythmStrip !== true)) selected.set(lead.lead, lead);
  }
  return [...selected.values()];
}

function qualityPass(lead, policy) {
  const quality = lead.quality;
  requireCondition(quality && typeof quality === "object", "IMAGE_ANALYSIS_QUALITY");
  requireCondition(Number.isInteger(quality.maxHeldGapColumns) && quality.maxHeldGapColumns >= 0, "IMAGE_ANALYSIS_QUALITY");
  requireCondition(Number.isInteger(quality.heldColumnCount) && quality.heldColumnCount >= 0, "IMAGE_ANALYSIS_QUALITY");
  requireCondition(Number.isInteger(lead.sampleCount) && lead.sampleCount === lead.samples.length && lead.sampleCount > 0, "IMAGE_ANALYSIS_SAMPLE_COUNT");
  return quality.maxHeldGapColumns <= policy.maxHeldGapColumns &&
    (quality.heldColumnCount / lead.sampleCount) <= policy.maxHeldFraction;
}

function analyzeImageLead(extraction, lead, config) {
  const measurement = runPhysicalLeadMeasurementPipeline({
    physicalLead: {
      record: extraction.caseId,
      leadName: lead.lead,
      sampleRateHz: lead.sampleRateHz,
      samples: lead.samples,
      unit: lead.unit,
      calibration: {
        ...extraction.calibration,
        baselineY: lead.baselineY,
        extractionId: extraction.extractionId,
      },
    },
    provenance: {
      sourceKind: "CALIBRATED_IMAGE_EXTRACTION",
      locator: `${extraction.caseId}/${extraction.extractionId}/${lead.lead}/${lead.rhythmStrip === true ? "rhythm" : "panel"}`,
      assetSha256: extraction.extractionId.slice("extract-".length),
      projectGold: false,
      runtimeAuthority: false,
    },
    config: config.measurement,
  });
  const features = extractRhythmFeatures(measurement);
  const candidatePhenotypes = evaluateCandidatePhenotypes(features, config.phenotypes);
  return {
    leadName: lead.lead,
    rhythmStrip: lead.rhythmStrip === true,
    paperWindow: lead.paperWindow || null,
    extractionQuality: lead.quality,
    measurement,
    features,
    candidatePhenotypes,
  };
}

function summarizeImageLeadAnalyses(rows) {
  requireCondition(Array.isArray(rows) && rows.length > 0, "IMAGE_ANALYSIS_SUMMARY_ROWS");
  const consistencyRows = rows.map(row => ({
    lead: row.leadName,
    features: {
      beatCount: row.features.beatCount,
      ventricularRateBpm: row.features.intervals.ventricularRateFromMedianRrBpm,
      prMedianMs: row.features.intervals.prMedianMs,
      qrsMedianMs: row.features.intervals.qrsMedianMs,
      qtMedianMs: row.features.intervals.qtMedianMs,
      qtcFridericiaMedianMs: row.features.intervals.qtcFridericiaMedianMs,
    },
  }));
  const successes = rows.map(row => ({
    lead: row.leadName,
    analysis: {
      candidatePhenotypes: row.candidatePhenotypes,
    },
  }));
  return {
    crossLeadConsistency: {
      beatCount: summarizeMetric(consistencyRows, "beatCount"),
      ventricularRateBpm: summarizeMetric(consistencyRows, "ventricularRateBpm"),
      prMedianMs: summarizeMetric(consistencyRows, "prMedianMs"),
      qrsMedianMs: summarizeMetric(consistencyRows, "qrsMedianMs"),
      qtMedianMs: summarizeMetric(consistencyRows, "qtMedianMs"),
      qtcFridericiaMedianMs: summarizeMetric(consistencyRows, "qtcFridericiaMedianMs"),
    },
    candidateEvidence: aggregateCandidateEvidence(successes),
  };
}

function buildSimultaneousPaperGroups(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const window = row.paperWindow;
    if (!window || window.rhythmStrip === true) continue;
    const key = `${window.startSeconds}:${window.durationSeconds}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  return [...grouped.values()]
    .filter(rowsInWindow => rowsInWindow.length >= 2)
    .sort((a,b) => a[0].paperWindow.startSeconds - b[0].paperWindow.startSeconds)
    .map(rowsInWindow => {
      const summary = summarizeImageLeadAnalyses(rowsInWindow);
      return {
        schema: "ekg-image-simultaneous-paper-group-v1",
        startSeconds: rowsInWindow[0].paperWindow.startSeconds,
        durationSeconds: rowsInWindow[0].paperWindow.durationSeconds,
        leads: rowsInWindow.map(row => row.leadName),
        leadCount: rowsInWindow.length,
        temporalAlignmentSource: "ROI_LAYOUT_METADATA",
        simultaneousWithinPaperWindow: true,
        crossLeadConsistency: summary.crossLeadConsistency,
        candidateEvidence: summary.candidateEvidence,
        diagnosticInterpretationIncluded: false,
        ...ANALYSIS_GOVERNANCE,
      };
    });
}

function runImageSignalAnalysis(extraction, config) {
  verifyExtractionIdentity(extraction);
  validateConfig(config);
  requireCondition(extraction.runtimeAuthority === false && extraction.projectGold === false, "IMAGE_ANALYSIS_EXTRACTION_AUTHORITY");
  const permissions = validateAnalysisPermissions(extraction.analysisPermissions);
  requireCondition(permissions.safePartialAnalysisAllowed === true, "IMAGE_ANALYSIS_PREFLIGHT_BLOCKED");
  requireCondition(
    permissions.exactTimeMeasurementAllowed === true &&
    permissions.exactVoltageMeasurementAllowed === true &&
    permissions.measurementsReliable === true,
    "IMAGE_ANALYSIS_MEASUREMENT_PERMISSION_REQUIRED",
  );
  requireCondition(permissions.specificLeadClaimsAllowed === true, "IMAGE_ANALYSIS_LEAD_IDENTITY_PERMISSION_REQUIRED");

  const canonicalLeads = selectCanonicalLeads(extraction.leads);
  requireCondition(canonicalLeads.length >= 1, "IMAGE_ANALYSIS_LEADS_REQUIRED");

  const leadAnalyses = [];
  const failures = [];
  for (const lead of canonicalLeads) {
    if (!qualityPass(lead, config.quality)) {
      failures.push({ leadName: lead.lead, reason: "IMAGE_ANALYSIS_QUALITY_GATE" });
      continue;
    }
    try {
      leadAnalyses.push(analyzeImageLead(extraction, lead, config));
    } catch (error) {
      failures.push({ leadName: lead.lead, reason: reasonCode(error) });
    }
  }

  const canonicalSet = new Set(canonicalLeads);
  const supplementalPaperWindowAnalyses = [];
  const supplementalPaperWindowFailures = [];
  for (const lead of extraction.leads) {
    if (canonicalSet.has(lead)) continue;
    if (!lead.paperWindow || lead.paperWindow.rhythmStrip === true) continue;
    if (!qualityPass(lead, config.quality)) {
      supplementalPaperWindowFailures.push({
        leadName: lead.lead,
        paperWindow: lead.paperWindow,
        reason: "IMAGE_ANALYSIS_QUALITY_GATE",
      });
      continue;
    }
    try {
      supplementalPaperWindowAnalyses.push(analyzeImageLead(extraction, lead, config));
    } catch (error) {
      supplementalPaperWindowFailures.push({
        leadName: lead.lead,
        paperWindow: lead.paperWindow,
        reason: reasonCode(error),
      });
    }
  }

  requireCondition(leadAnalyses.length > 0, "IMAGE_ANALYSIS_NO_USABLE_LEADS");
  const processed = new Set(leadAnalyses.map(x => x.leadName));
  const completeStandardTwelveLead =
    permissions.twelveLeadClaimsAllowed === true &&
    STANDARD_LEADS.every(lead => processed.has(lead));
  const crossLeadSummary = leadAnalyses.length >= 2
    ? summarizeImageLeadAnalyses(leadAnalyses)
    : { crossLeadConsistency: null, candidateEvidence: [] };
  const simultaneousPaperGroups = buildSimultaneousPaperGroups([
    ...leadAnalyses,
    ...supplementalPaperWindowAnalyses,
  ]);
  return {
    schema: "ekg-image-signal-analysis-v2",
    caseId: extraction.caseId,
    extractionId: extraction.extractionId,
    status: failures.length ? "PARTIAL" : "COMPLETE",
    attemptedLeadCount: canonicalLeads.length,
    processedLeadCount: leadAnalyses.length,
    completeStandardTwelveLead,
    duplicateLeadPolicy: "PREFER_RHYTHM_STRIP_THEN_FIRST",
    leadAnalyses,
    failures,
    supplementalPaperWindowAnalyses,
    supplementalPaperWindowFailures,
    thresholdAuthority: config.thresholdAuthority,
    qualityPolicy: config.quality,
    sourcePermissions: { ...permissions },
    crossLeadAggregationPerformed: leadAnalyses.length >= 2,
    crossLeadConsistency: crossLeadSummary.crossLeadConsistency,
    crossLeadCandidateEvidence: crossLeadSummary.candidateEvidence,
    simultaneousLeadComparisonPerformed: simultaneousPaperGroups.length > 0,
    simultaneousPaperGroups,
    temporalAlignmentPolicy: "STANDARD_3X4_PANEL_WINDOWS_WITH_SUPPLEMENTAL_NONCANONICAL_PANEL_DUPLICATES_RHYTHM_STRIP_EXCLUDED",
    diagnosticInterpretationIncluded: false,
    ...ANALYSIS_GOVERNANCE,
  };
}

module.exports = {
  ANALYSIS_GOVERNANCE,
  analyzeImageLead,
  STANDARD_LEADS,
  buildSimultaneousPaperGroups,
  runImageSignalAnalysis,
  selectCanonicalLeads,
  summarizeImageLeadAnalyses,
};
