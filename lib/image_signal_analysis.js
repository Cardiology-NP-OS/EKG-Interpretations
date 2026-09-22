"use strict";

if (!module.imageAnalysisArtifact) {
  module.exports = require("./image_analysis_execution").loadImageAnalysis();
  return;
}

const { types: { isProxy } } = require("util");
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

function validateConfigData(value, depth = 0, budget = { nodes: 0 }) {
  requireCondition(depth <= 32 && ++budget.nodes <= 100000, "IMAGE_ANALYSIS_CONFIG_DATA");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    requireCondition(Number.isFinite(value), "IMAGE_ANALYSIS_CONFIG_DATA");
    return;
  }
  requireCondition(typeof value === "object" && !isProxy(value), "IMAGE_ANALYSIS_CONFIG_DATA");
  const array = Array.isArray(value);
  requireCondition(Object.getPrototypeOf(value) === (array ? Array.prototype : Object.prototype), "IMAGE_ANALYSIS_CONFIG_DATA");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  for (const key of keys) {
    if (array && key === "length") continue;
    const descriptor = descriptors[key];
    requireCondition(typeof key === "string" && Object.hasOwn(descriptor, "value") && descriptor.enumerable, "IMAGE_ANALYSIS_CONFIG_DATA");
    if (array) requireCondition(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length, "IMAGE_ANALYSIS_CONFIG_DATA");
    if (key !== "authorityClass" && Object.hasOwn(ANALYSIS_GOVERNANCE, key)) {
      requireCondition(descriptor.value === ANALYSIS_GOVERNANCE[key], "IMAGE_ANALYSIS_CONFIG_GOVERNANCE");
    }
    if (key === "diagnosticInterpretationIncluded") requireCondition(descriptor.value === false, "IMAGE_ANALYSIS_CONFIG_GOVERNANCE");
    validateConfigData(descriptor.value, depth + 1, budget);
  }
  if (array) requireCondition(keys.length === value.length + 1, "IMAGE_ANALYSIS_CONFIG_DATA");
}

function validateConfig(config) {
  validateConfigData(config);
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "IMAGE_ANALYSIS_CONFIG_REQUIRED");
  const keys = ["measurement", "phenotypes", "thresholdAuthority", "quality"];
  requireCondition(Object.keys(config).length === keys.length && keys.every(key => Object.hasOwn(config, key)), "IMAGE_ANALYSIS_CONFIG_FIELDS");
  requireCondition(config.measurement && typeof config.measurement === "object", "IMAGE_ANALYSIS_MEASUREMENT_CONFIG");
  requireCondition(config.phenotypes && typeof config.phenotypes === "object", "IMAGE_ANALYSIS_PHENOTYPE_CONFIG");
  requireCondition(typeof config.thresholdAuthority === "string" && config.thresholdAuthority.trim().length > 0, "IMAGE_ANALYSIS_THRESHOLD_AUTHORITY");
  requireCondition(config.quality && typeof config.quality === "object", "IMAGE_ANALYSIS_QUALITY_CONFIG");
  requireCondition(Number.isInteger(config.quality.maxHeldGapColumns) && config.quality.maxHeldGapColumns >= 0 && config.quality.maxHeldGapColumns <= 8, "IMAGE_ANALYSIS_MAX_HELD_GAP");
  requireCondition(typeof config.quality.maxHeldFraction === "number" && Number.isFinite(config.quality.maxHeldFraction) && config.quality.maxHeldFraction >= 0 && config.quality.maxHeldFraction <= 1, "IMAGE_ANALYSIS_MAX_HELD_FRACTION");
  const pixelLimits = ["maxAmplitudeUncertaintyMv", "maxTimePixelUncertaintyMs"];
  if (pixelLimits.some(key => Object.hasOwn(config.quality, key))) {
    requireCondition(pixelLimits.every(key => Number.isFinite(config.quality[key]) && config.quality[key] > 0), "IMAGE_ANALYSIS_PIXEL_UNCERTAINTY_POLICY");
  }
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

function qualityPass(lead, policy, calibration) {
  const quality = lead.quality;
  requireCondition(quality && typeof quality === "object", "IMAGE_ANALYSIS_QUALITY");
  requireCondition(Number.isInteger(quality.maxHeldGapColumns) && quality.maxHeldGapColumns >= 0, "IMAGE_ANALYSIS_QUALITY");
  requireCondition(Number.isInteger(quality.heldColumnCount) && quality.heldColumnCount >= 0, "IMAGE_ANALYSIS_QUALITY");
  requireCondition(Number.isInteger(lead.sampleCount) && lead.sampleCount === lead.samples.length && lead.sampleCount > 0, "IMAGE_ANALYSIS_SAMPLE_COUNT");
  const heldPass = quality.maxHeldGapColumns <= policy.maxHeldGapColumns &&
    (quality.heldColumnCount / lead.sampleCount) <= policy.maxHeldFraction;
  const pixelPolicy = Object.hasOwn(policy, "maxAmplitudeUncertaintyMv");
  if (!pixelPolicy && quality.tracePolicy === undefined) return heldPass;
  if (!pixelPolicy || quality.tracePolicy !== "SINGLE_CONTIGUOUS_DARK_TRACE") return false;
  const pxPerMv = calibration && calibration.pxPerMm * calibration.gainMmPerMv;
  const pxPerSecond = calibration && calibration.pxPerMm * calibration.paperSpeedMmPerS;
  const region = quality.sourceRegion;
  return heldPass && lead.unit === "mV" &&
    region && Number.isInteger(region.x) && region.x >= 0 && Number.isInteger(region.y) && region.y >= 0 &&
    region.width === lead.sampleCount && Number.isInteger(region.height) && region.height >= 3 &&
    Number.isInteger(lead.baselineY) && lead.baselineY >= region.y && lead.baselineY < region.y + region.height &&
    Number.isInteger(quality.inkCeiling) && quality.inkCeiling >= 0 && quality.inkCeiling <= 200 &&
    Number.isFinite(pxPerMv) && pxPerMv > 0 && Number.isFinite(pxPerSecond) && pxPerSecond > 0 &&
    lead.sampleRateHz === pxPerSecond &&
    Number.isInteger(quality.strictTraceMaxThicknessPx) && quality.strictTraceMaxThicknessPx >= 1 && quality.strictTraceMaxThicknessPx <= Math.min(100, region.height - 2) &&
    Number.isInteger(quality.maxStrokeThicknessPx) && quality.maxStrokeThicknessPx >= 1 && quality.maxStrokeThicknessPx <= quality.strictTraceMaxThicknessPx &&
    quality.coverage === 1 && quality.observedInkColumns === lead.sampleCount &&
    quality.heldColumnCount === 0 && quality.maxHeldGapColumns === 0 && quality.maxHeldColumns === 0 &&
    quality.calibrationUncertaintyQuantified === false &&
    Number.isFinite(quality.maxAmplitudeUncertaintyMv) && quality.maxAmplitudeUncertaintyMv > 0 &&
    Number.isFinite(quality.timePixelUncertaintyMs) && quality.timePixelUncertaintyMs > 0 &&
    quality.maxAmplitudeUncertaintyMv === quality.maxStrokeThicknessPx / 2 / pxPerMv &&
    quality.timePixelUncertaintyMs === 500 / lead.sampleRateHz &&
    quality.maxAmplitudeUncertaintyMv <= policy.maxAmplitudeUncertaintyMv &&
    quality.timePixelUncertaintyMs <= policy.maxTimePixelUncertaintyMs;
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
      const orderedRows = rowsInWindow.slice().sort((a,b) =>
        a.paperWindow.row - b.paperWindow.row ||
        a.paperWindow.col - b.paperWindow.col ||
        a.leadName.localeCompare(b.leadName)
      );
      const summary = summarizeImageLeadAnalyses(orderedRows);
      return {
        schema: "ekg-image-simultaneous-paper-group-v1",
        startSeconds: orderedRows[0].paperWindow.startSeconds,
        durationSeconds: orderedRows[0].paperWindow.durationSeconds,
        leads: orderedRows.map(row => row.leadName),
        leadCount: orderedRows.length,
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
  const strict = extraction && Array.isArray(extraction.leads) &&
    extraction.leads.some(lead => lead.quality && lead.quality.tracePolicy === "SINGLE_CONTIGUOUS_DARK_TRACE");
  if (strict) module.imageAnalysisArtifact.snapshot();
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
    if (!qualityPass(lead, config.quality, extraction.calibration)) {
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
    if (!qualityPass(lead, config.quality, extraction.calibration)) {
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
    ...(strict ? {
      configuration: JSON.parse(JSON.stringify(config)),
      ...module.imageAnalysisArtifact.snapshot(),
    } : {}),
    ...ANALYSIS_GOVERNANCE,
  };
}

module.exports = {
  ANALYSIS_GOVERNANCE,
  validateConfig,
  qualityPass,
  analyzeImageLead,
  STANDARD_LEADS,
  buildSimultaneousPaperGroups,
  runImageSignalAnalysis,
  selectCanonicalLeads,
  summarizeImageLeadAnalyses,
  verifyAnalysisImplementation: module.imageAnalysisArtifact.verify,
};
