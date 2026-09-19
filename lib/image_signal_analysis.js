"use strict";

const { verifyExtractionIdentity, validateAnalysisPermissions } = require("./image_extraction_store");
const { runPhysicalLeadMeasurementPipeline } = require("./signal_measurement_pipeline");
const { extractRhythmFeatures } = require("./rhythm_feature_contract");
const { evaluateCandidatePhenotypes } = require("./candidate_phenotype_engine");

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
          locator: `${extraction.caseId}/${extraction.extractionId}/${lead.lead}`,
          assetSha256: extraction.extractionId.slice("extract-".length),
          projectGold: false,
          runtimeAuthority: false,
        },
        config: config.measurement,
      });
      const features = extractRhythmFeatures(measurement);
      const candidatePhenotypes = evaluateCandidatePhenotypes(features, config.phenotypes);
      leadAnalyses.push({
        leadName: lead.lead,
        rhythmStrip: lead.rhythmStrip === true,
        extractionQuality: lead.quality,
        measurement,
        features,
        candidatePhenotypes,
      });
    } catch (error) {
      failures.push({ leadName: lead.lead, reason: reasonCode(error) });
    }
  }

  requireCondition(leadAnalyses.length > 0, "IMAGE_ANALYSIS_NO_USABLE_LEADS");
  const processed = new Set(leadAnalyses.map(x => x.leadName));
  const completeStandardTwelveLead =
    permissions.twelveLeadClaimsAllowed === true &&
    STANDARD_LEADS.every(lead => processed.has(lead));
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
    thresholdAuthority: config.thresholdAuthority,
    qualityPolicy: config.quality,
    sourcePermissions: { ...permissions },
    simultaneousLeadComparisonPerformed: false,
    diagnosticInterpretationIncluded: false,
    ...ANALYSIS_GOVERNANCE,
  };
}

module.exports = {
  ANALYSIS_GOVERNANCE,
  STANDARD_LEADS,
  runImageSignalAnalysis,
  selectCanonicalLeads,
};
