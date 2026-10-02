"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { readImageCase, readStoreFile, parseStoreJson, requireStoreDirectory } = require("./image_case_store");
const { readImageExtraction } = require("./image_extraction_store");
const { readImageAnalysis } = require("./image_analysis_store");
const { readClinicianCorrection } = require("./clinician_correction_store");

const ANALYSIS_ID_RE = /^analysis-[a-f0-9]{64}$/;
const CORRECTION_ID_RE = /^correction-[a-f0-9]{64}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_CORRECTIONS = 128;
const MAX_PREVIEW_POINTS = 512;
const MAX_READER_BYTES = 4 * 1024 * 1024;

const READER_GOVERNANCE = Object.freeze({
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
  diagnosticInterpretationIncluded: false,
  clinicalReleaseAuthorized: false,
  runtimeAuthority: false,
  projectGold: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}
function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
function copy(value) {
  return JSON.parse(JSON.stringify(value));
}
function caseDirectory(fileOrDir) {
  requireCondition(typeof fileOrDir === "string" && fileOrDir.length > 0, "READER_CASE_PATH_REQUIRED");
  const resolved = path.resolve(fileOrDir);
  const directory = fs.existsSync(resolved) && fs.lstatSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  readImageCase(directory);
  return directory;
}
function boundJson(file, hashFile, maxBytes, codes) {
  const body = readStoreFile(file, maxBytes, codes.file);
  const expected = readStoreFile(hashFile, 65, codes.hashFile).toString("ascii").trim();
  requireCondition(HASH_RE.test(expected) && sha256(body) === expected, codes.hash);
  return Object.freeze({ record: parseStoreJson(body, codes.json), sha256: expected, bytes: body.length });
}
function waveformPreview(samples) {
  requireCondition(Array.isArray(samples) && samples.length > 0, "READER_WAVEFORM_REQUIRED");
  const target = Math.min(MAX_PREVIEW_POINTS, samples.length);
  const points = [];
  let lastIndex = -1;
  for (let i = 0; i < target; i += 1) {
    const index = target === 1 ? 0 : Math.round(i * (samples.length - 1) / (target - 1));
    if (index === lastIndex) continue;
    const value = samples[index];
    requireCondition(typeof value === "number" && Number.isFinite(value), "READER_WAVEFORM_NONFINITE");
    points.push(Object.freeze({ index, value }));
    lastIndex = index;
  }
  requireCondition(points[0].index === 0 && points[points.length - 1].index === samples.length - 1, "READER_WAVEFORM_BOUNDS");
  return Object.freeze({
    schema: "ekg-clinician-waveform-preview-v1",
    policy: "EVEN_INDEX_BOUNDED_PRESERVE_ENDPOINTS",
    originalSampleCount: samples.length,
    returnedPointCount: points.length,
    maxPointCount: MAX_PREVIEW_POINTS,
    points: Object.freeze(points),
  });
}
function matchingExtractionLead(extraction, row) {
  const matches = extraction.leads.filter(lead =>
    lead.lead === row.leadName &&
    (lead.rhythmStrip === true) === (row.rhythmStrip === true) &&
    JSON.stringify(lead.paperWindow || null) === JSON.stringify(row.paperWindow || null)
  );
  requireCondition(matches.length === 1, matches.length ? "READER_LEAD_SOURCE_AMBIGUOUS" : "READER_LEAD_SOURCE_MISSING");
  return matches[0];
}
function readerLead(extraction, row) {
  requireCondition(row && typeof row === "object", "READER_ANALYSIS_ROW_REQUIRED");
  const lead = matchingExtractionLead(extraction, row);
  requireCondition(row.measurement && row.measurement.schema === "ekg-waveform-measurement-pipeline-v1", "READER_MEASUREMENT_REQUIRED");
  requireCondition(JSON.stringify(lead.quality) === JSON.stringify(row.extractionQuality), "READER_QUALITY_BINDING");
  return Object.freeze({
    leadName: row.leadName,
    rhythmStrip: row.rhythmStrip === true,
    paperWindow: copy(row.paperWindow || null),
    waveform: Object.freeze({
      sampleRateHz: lead.sampleRateHz,
      unit: lead.unit,
      sampleCount: lead.sampleCount,
      preview: waveformPreview(lead.samples),
    }),
    quality: copy(row.extractionQuality),
    measurement: Object.freeze({
      schema: row.measurement.schema,
      sampleRateHz: row.measurement.sampleRateHz,
      sampleCount: row.measurement.sampleCount,
      intervalMeasurements: copy(row.measurement.intervalMeasurements),
      amplitudeMeasurements: copy(row.measurement.amplitudeMeasurements),
      coverage: copy(row.measurement.coverage),
      provenance: copy(row.measurement.provenance),
      diagnosticInterpretationIncluded: false,
    }),
    features: copy(row.features),
    candidatePhenotypes: copy(row.candidatePhenotypes),
    diagnosticInterpretationIncluded: false,
    clinicalValidityInferred: false,
  });
}
function listCorrections(caseDir, caseId, analysisId, analysisSha256) {
  const parent = path.join(caseDir, "analyses", analysisId, "corrections");
  if (!fs.existsSync(parent)) return Object.freeze({ items: Object.freeze([]), rootIds: Object.freeze([]), activeHeadIds: Object.freeze([]) });
  requireStoreDirectory(parent);
  const entries = fs.readdirSync(parent, { withFileTypes: true });
  requireCondition(entries.length <= MAX_CORRECTIONS, "READER_CORRECTION_LIMIT");
  const items = [];
  for (const entry of entries) {
    requireCondition(entry.isDirectory() && !entry.isSymbolicLink() && CORRECTION_ID_RE.test(entry.name), "READER_CORRECTION_STORE_UNCLEAN");
    const correction = readClinicianCorrection(caseDir, analysisId, entry.name);
    requireCondition(correction.caseId === caseId, "READER_CORRECTION_CASE_BINDING");
    requireCondition(correction.analysisId === analysisId, "READER_CORRECTION_ANALYSIS_BINDING");
    requireCondition(correction.analysisSha256 === analysisSha256, "READER_CORRECTION_ANALYSIS_HASH");
    items.push(Object.freeze({
      correctionId: correction.correctionId,
      reviewerId: correction.reviewerId,
      statement: correction.statement,
      origin: correction.origin,
      supersedes: correction.supersedes,
      clinicalValidityInferred: false,
      clinicalReleaseAuthorized: false,
      diagnosticInterpretationIncluded: false,
      runtimeAuthority: false,
    }));
  }
  items.sort((a, b) => a.correctionId.localeCompare(b.correctionId));
  const ids = new Set(items.map(item => item.correctionId));
  requireCondition(ids.size === items.length, "READER_CORRECTION_DUPLICATE");
  for (const item of items) {
    requireCondition(item.supersedes === null || ids.has(item.supersedes), "READER_CORRECTION_CHAIN");
    const seen = new Set([item.correctionId]);
    let cursor = item;
    while (cursor.supersedes !== null) {
      requireCondition(!seen.has(cursor.supersedes), "READER_CORRECTION_CYCLE");
      seen.add(cursor.supersedes);
      cursor = items.find(candidate => candidate.correctionId === cursor.supersedes);
      requireCondition(cursor, "READER_CORRECTION_CHAIN");
    }
  }
  const superseded = new Set(items.map(item => item.supersedes).filter(Boolean));
  return Object.freeze({
    items: Object.freeze(items),
    rootIds: Object.freeze(items.filter(item => item.supersedes === null).map(item => item.correctionId)),
    activeHeadIds: Object.freeze(items.filter(item => !superseded.has(item.correctionId)).map(item => item.correctionId)),
  });
}
function buildClinicianReaderModel(fileOrDir, analysisId) {
  requireCondition(typeof analysisId === "string" && ANALYSIS_ID_RE.test(analysisId), "READER_ANALYSIS_ID");
  const caseDir = caseDirectory(fileOrDir);
  const caseRecord = readImageCase(caseDir);
  const analysis = readImageAnalysis(caseDir, analysisId);
  const extraction = readImageExtraction(caseDir, analysis.extractionId);
  requireCondition(analysis.caseId === caseRecord.caseId && extraction.caseId === caseRecord.caseId, "READER_CASE_BINDING");
  requireCondition(analysis.extractionId === extraction.extractionId, "READER_EXTRACTION_BINDING");

  const caseBound = boundJson(path.join(caseDir, "manifest.json"), path.join(caseDir, "manifest.sha256"), MAX_ARTIFACT_BYTES,
    { file: "READER_CASE_FILE", hashFile: "READER_CASE_HASH_FILE", hash: "READER_CASE_HASH", json: "READER_CASE_JSON" });
  const extractionDir = path.join(caseDir, "extractions", extraction.extractionId);
  const extractionBound = boundJson(path.join(extractionDir, "extraction.json"), path.join(extractionDir, "extraction.sha256"), MAX_ARTIFACT_BYTES,
    { file: "READER_EXTRACTION_FILE", hashFile: "READER_EXTRACTION_HASH_FILE", hash: "READER_EXTRACTION_HASH", json: "READER_EXTRACTION_JSON" });
  const analysisDir = path.join(caseDir, "analyses", analysis.analysisId);
  const analysisBound = boundJson(path.join(analysisDir, "analysis.json"), path.join(analysisDir, "analysis.sha256"), MAX_ARTIFACT_BYTES,
    { file: "READER_ANALYSIS_FILE", hashFile: "READER_ANALYSIS_HASH_FILE", hash: "READER_ANALYSIS_HASH", json: "READER_ANALYSIS_JSON" });

  requireCondition(canonicalJson(caseBound.record) === canonicalJson(caseRecord), "READER_CASE_CHANGED");
  requireCondition(canonicalJson(extractionBound.record) === canonicalJson(extraction), "READER_EXTRACTION_CHANGED");
  requireCondition(canonicalJson(analysisBound.record) === canonicalJson(analysis), "READER_ANALYSIS_CHANGED");

  const model = {
    schema: "ekg-clinician-reader-model-v1",
    caseId: caseRecord.caseId,
    extractionId: extraction.extractionId,
    analysisId: analysis.analysisId,
    bindings: {
      caseManifestSha256: caseBound.sha256,
      extractionSha256: extractionBound.sha256,
      analysisSha256: analysisBound.sha256,
    },
    status: analysis.status,
    completeStandardTwelveLead: analysis.completeStandardTwelveLead === true,
    source: {
      source: copy(extraction.source),
      calibration: copy(extraction.calibration),
      analysisPermissions: copy(extraction.analysisPermissions),
      thresholdAuthority: analysis.thresholdAuthority,
      qualityPolicy: copy(analysis.qualityPolicy),
    },
    leads: analysis.leadAnalyses.map(row => readerLead(extraction, row)),
    failures: copy(analysis.failures),
    supplementalLeads: analysis.supplementalPaperWindowAnalyses.map(row => readerLead(extraction, row)),
    supplementalFailures: copy(analysis.supplementalPaperWindowFailures),
    crossLead: {
      aggregationPerformed: analysis.crossLeadAggregationPerformed === true,
      consistency: copy(analysis.crossLeadConsistency),
      candidateEvidence: copy(analysis.crossLeadCandidateEvidence),
      simultaneousLeadComparisonPerformed: analysis.simultaneousLeadComparisonPerformed === true,
      simultaneousPaperGroups: copy(analysis.simultaneousPaperGroups),
      temporalAlignmentPolicy: analysis.temporalAlignmentPolicy,
    },
    corrections: listCorrections(caseDir, caseRecord.caseId, analysis.analysisId, analysisBound.sha256),
    notice: "Engineering output - not clinically validated. Clinician review required.",
    ...READER_GOVERNANCE,
  };
  requireCondition(Buffer.byteLength(JSON.stringify(model), "utf8") <= MAX_READER_BYTES, "READER_OUTPUT_BYTES");
  return Object.freeze(model);
}
module.exports = { MAX_PREVIEW_POINTS, READER_GOVERNANCE, buildClinicianReaderModel };
