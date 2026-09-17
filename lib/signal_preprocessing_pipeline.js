"use strict";

const {
  parseHeaderDetailed,
  decodeInt16Interleaved,
  toPhysical,
} = require("./wfdb_signal");
const {
  buildSignalPreprocessingContract,
  validateFailureAccounting,
  validatePreprocessingExecutionProvenance,
} = require("./signal_preprocessing_contract");

const PIPELINE_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  sourceLabelsAreProjectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}
function finiteArray(values, code = "PREPROCESS_NONFINITE_SAMPLE") {
  requireCondition(Array.isArray(values) && values.length > 0, "PREPROCESS_SAMPLES_REQUIRED");
  return values.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), code);
    return value;
  });
}

function decodePhysicalLeads(headerText, dataBuffer) {
  const header = parseHeaderDetailed(headerText);
  const raw = decodeInt16Interleaved(dataBuffer, header.leadCount, header.sampleCount);
  return {
    header,
    leads: header.signals.map((signal, index) => ({
      leadName: signal.leadName,
      unit: signal.unit,
      gain: signal.gain,
      baseline: signal.baseline,
      samples: raw[index].map(value => toPhysical(value, signal.gain, signal.baseline)),
    })),
  };
}

function linearResample(values, sourceRateHz, targetRateHz) {
  const source = finiteArray(values);
  requireCondition(Number.isFinite(sourceRateHz) && sourceRateHz > 0, "PREPROCESS_SOURCE_RATE");
  requireCondition(Number.isFinite(targetRateHz) && targetRateHz > 0, "PREPROCESS_TARGET_RATE");
  if (sourceRateHz === targetRateHz) return source.slice();
  const targetCount = Math.max(1, Math.round(source.length * targetRateHz / sourceRateHz));
  if (source.length === 1) return Array(targetCount).fill(source[0]);
  const out = new Array(targetCount);
  for (let i = 0; i < targetCount; i += 1) {
    const position = i * sourceRateHz / targetRateHz;
    const left = Math.min(source.length - 1, Math.floor(position));
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    out[i] = source[left] + (source[right] - source[left]) * fraction;
  }
  return out;
}
const resampleLinear = linearResample;

function sliceSegment(values, startSample, segmentSamples) {
  const source = finiteArray(values);
  requireCondition(Number.isInteger(startSample) && startSample >= 0, "PREPROCESS_SEGMENT_START");
  requireCondition(Number.isInteger(segmentSamples) && segmentSamples > 0, "PREPROCESS_SEGMENT_SAMPLES");
  requireCondition(startSample + segmentSamples <= source.length, "PREPROCESS_SEGMENT_BOUNDS");
  return source.slice(startSample, startSample + segmentSamples);
}

function supportedResamplingMethod(contract) {
  if (!contract.requiresResampling) return null;
  requireCondition(
    ["linear-interpolation-v1", "linear-v1"].includes(contract.resamplingMethod),
    "PREPROCESS_RESAMPLING_METHOD_UNIMPLEMENTED"
  );
  return contract.resamplingMethod;
}
function buildContract(decoded, input) {
  const contract = buildSignalPreprocessingContract({
    sourceLeadLabels: decoded.header.signals.map(signal => signal.leadName),
    requireCompleteTwelveLead: input.requireCompleteTwelveLead !== false,
    sourceSamplingRateHz: decoded.header.sampleRate,
    targetSamplingRateHz: input.targetSamplingRateHz,
    segmentSamples: input.segmentSamples,
    resamplingMethod: input.resamplingMethod,
    sourceDatasetId: input.sourceDatasetId,
    sourceAdapterId: input.sourceAdapterId,
    upstreamCommit: input.upstreamCommit,
  });
  requireCondition(contract.pass, `PREPROCESS_CONTRACT:${(contract.errors || []).join(",")}`);
  supportedResamplingMethod(contract);
  return contract;
}

function normalizeImplementationProvenance(value) {
  const validation = validatePreprocessingExecutionProvenance({
    implementationProvenance: value,
    groupKeySemantics: "record",
    failureAccounting: {
      attempted: 1, processed: 1, skipped: 0,
      exceptionPolicy: "fail-closed", skipReasons: {},
    },
    projectGold: false,
    sourceLabelsAreProjectGold: false,
    runtimeAuthority: false,
    clinicalValidityInferred: false,
  });
  requireCondition(validation.pass,
    `PREPROCESS_IMPLEMENTATION_PROVENANCE:${validation.errors.join(",")}`);
  return { ...value };
}

function executeWaveformPreprocessing(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "PREPROCESS_INPUT_REQUIRED");
  requireCondition(typeof input.headerText === "string" && input.headerText.length > 0, "PREPROCESS_HEADER_REQUIRED");
  requireCondition(Buffer.isBuffer(input.dataBuffer), "PREPROCESS_DATA_REQUIRED");
  const decoded = decodePhysicalLeads(input.headerText, input.dataBuffer);
  const contract = buildContract(decoded, input);
  const implementationProvenance = normalizeImplementationProvenance(input.implementationProvenance);
  const startSample = input.segmentStartSample === undefined ? 0 : input.segmentStartSample;
  const leads = contract.reorderIndices.map((sourceIndex, canonicalIndex) => {
    const source = decoded.leads[sourceIndex];
    const values = contract.requiresResampling
      ? linearResample(source.samples, contract.sourceSamplingRateHz, contract.targetSamplingRateHz)
      : source.samples.slice();
    return {
      leadName: contract.canonicalLeadOrder[canonicalIndex],
      unit: source.unit,
      sourceLeadName: source.leadName,
      sourceIndex,
      samples: sliceSegment(values, startSample, contract.segmentSamples),
    };
  });
  return {
    schema: "ekg-executable-preprocessing-v1",
    record: decoded.header.record,
    contract,
    segmentStartSample: startSample,
    leads,
    implementationProvenance,
    failureAccounting: {
      attempted: 1,
      processed: 1,
      skipped: 0,
      exceptionPolicy: "fail-closed",
      skipReasons: {},
    },
    diagnosticInterpretationIncluded: false,
    ...PIPELINE_GOVERNANCE,
  };
}

function reasonCode(error) {
  const text = String(error && error.message ? error.message : error);
  return text.split(":")[0] || "PREPROCESS_UNKNOWN_FAILURE";
}

function executeWaveformPreprocessingBatch(records) {
  requireCondition(Array.isArray(records) && records.length > 0, "PREPROCESS_BATCH_REQUIRED");
  const results = [], failures = [], skipReasons = {};
  records.forEach((record, index) => {
    try { results.push({ index, result: executeWaveformPreprocessing(record) }); }
    catch (error) {
      const reason = reasonCode(error);
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      failures.push({ index, reason });
    }
  });
  const failureAccounting = {
    attempted: records.length,
    processed: results.length,
    skipped: failures.length,
    exceptionPolicy: "categorized",
    skipReasons,
  };
  const validation = validateFailureAccounting(failureAccounting);
  requireCondition(validation.pass, `PREPROCESS_ACCOUNTING_INVALID:${validation.errors.join(",")}`);
  return {
    schema: "ekg-executable-preprocessing-batch-v1",
    results,
    failures,
    failureAccounting,
    diagnosticInterpretationIncluded: false,
    ...PIPELINE_GOVERNANCE,
  };
}

function segmentLeads(leads, segmentSamples, remainderPolicy = "drop") {
  requireCondition(Array.isArray(leads) && leads.length > 0, "PREPROCESS_LEADS_REQUIRED");
  requireCondition(Number.isInteger(segmentSamples) && segmentSamples > 0, "PREPROCESS_SEGMENT_SAMPLES");
  requireCondition(["drop", "zero-pad"].includes(remainderPolicy), "PREPROCESS_REMAINDER_POLICY");
  const normalized = leads.map(lead => finiteArray(lead));
  const sampleCount = normalized[0].length;
  normalized.forEach(lead => requireCondition(lead.length === sampleCount, "PREPROCESS_LEAD_LENGTH_MISMATCH"));
  const segments = [];
  for (let start = 0; start + segmentSamples <= sampleCount; start += segmentSamples) {
    segments.push({
      startSample: start,
      endSampleExclusive: start + segmentSamples,
      paddedSamples: 0,
      leads: normalized.map(lead => lead.slice(start, start + segmentSamples)),
    });
  }
  const used = segments.length * segmentSamples;
  const remainder = sampleCount - used;
  if (remainder > 0 && remainderPolicy === "zero-pad") {
    const padded = segmentSamples - remainder;
    segments.push({
      startSample: used,
      endSampleExclusive: sampleCount,
      paddedSamples: padded,
      leads: normalized.map(lead => lead.slice(used).concat(Array(padded).fill(0))),
    });
  }
  return {
    segments,
    inputSamples: sampleCount,
    segmentSamples,
    remainderSamples: remainder,
    remainderPolicy,
    droppedSamples: remainderPolicy === "drop" ? remainder : 0,
    paddedSamples: remainderPolicy === "zero-pad" && remainder > 0 ? segmentSamples - remainder : 0,
  };
}

function runSignalPreprocessingPipeline(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "PREPROCESS_PIPELINE_INPUT_REQUIRED");
  requireCondition(typeof input.headerText === "string" && input.headerText.length > 0, "PREPROCESS_PIPELINE_HEADER_REQUIRED");
  requireCondition(Buffer.isBuffer(input.dataBuffer), "PREPROCESS_PIPELINE_DATA_REQUIRED");
  requireCondition(input.config && typeof input.config === "object", "PREPROCESS_PIPELINE_CONFIG_REQUIRED");
  requireCondition(input.provenance && typeof input.provenance === "object", "PREPROCESS_PIPELINE_PROVENANCE_REQUIRED");
  const decoded = decodePhysicalLeads(input.headerText, input.dataBuffer);
  const config = input.config;
  const contract = buildContract(decoded, {
    ...config,
    sourceDatasetId: input.provenance.sourceDatasetId,
    sourceAdapterId: input.provenance.sourceAdapterId,
    upstreamCommit: input.provenance.upstreamCommit,
  });
  const ordered = contract.reorderIndices.map(sourceIndex => decoded.leads[sourceIndex]);
  const resampled = ordered.map(lead => ({
    ...lead,
    samples: contract.requiresResampling
      ? linearResample(lead.samples, contract.sourceSamplingRateHz, contract.targetSamplingRateHz)
      : lead.samples.slice(),
  }));
  const segmented = segmentLeads(
    resampled.map(lead => lead.samples),
    contract.segmentSamples,
    config.remainderPolicy || "drop"
  );
  return {
    schema: "ekg-signal-preprocessing-pipeline-v1",
    record: decoded.header.record,
    sourceLeadOrder: contract.sourceLeadOrder,
    canonicalLeadOrder: contract.canonicalLeadOrder,
    sourceSamplingRateHz: contract.sourceSamplingRateHz,
    targetSamplingRateHz: contract.targetSamplingRateHz,
    resampling: {
      required: contract.requiresResampling,
      method: contract.requiresResampling ? contract.resamplingMethod : "identity",
      sourceSamples: decoded.header.sampleCount,
      targetSamples: resampled[0].samples.length,
    },
    segmentation: {
      inputSamples: segmented.inputSamples,
      segmentSamples: segmented.segmentSamples,
      remainderSamples: segmented.remainderSamples,
      remainderPolicy: segmented.remainderPolicy,
      droppedSamples: segmented.droppedSamples,
      paddedSamples: segmented.paddedSamples,
    },
    segments: segmented.segments.map((segment, segmentIndex) => ({
      segmentIndex,
      startSample: segment.startSample,
      endSampleExclusive: segment.endSampleExclusive,
      paddedSamples: segment.paddedSamples,
      leads: contract.canonicalLeadOrder.map((leadName, leadIndex) => ({
        leadName,
        unit: resampled[leadIndex].unit,
        samples: segment.leads[leadIndex],
      })),
    })),
    provenance: {
      sourceKind: input.provenance.sourceKind || "LOCAL_WFDB_PREPROCESSING_INPUT",
      locator: input.provenance.locator || null,
      assetSha256: input.provenance.assetSha256 || null,
      projectGold: false,
      runtimeAuthority: false,
    },
    diagnosticInterpretationIncluded: false,
    ...PIPELINE_GOVERNANCE,
  };
}

function preprocessBatch(records, processor = runSignalPreprocessingPipeline) {
  requireCondition(Array.isArray(records), "PREPROCESS_BATCH_RECORDS_REQUIRED");
  requireCondition(typeof processor === "function", "PREPROCESS_BATCH_PROCESSOR_REQUIRED");
  const outputs = [], failures = [], skipReasons = {};
  records.forEach((record, index) => {
    try { outputs.push({ index, result: processor(record) }); }
    catch (error) {
      const reason = reasonCode(error);
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
      failures.push({ index, reason });
    }
  });
  const failureAccounting = {
    attempted: records.length,
    processed: outputs.length,
    skipped: failures.length,
    exceptionPolicy: "fail-record-and-categorize",
    skipReasons,
  };
  const validation = validateFailureAccounting(failureAccounting);
  requireCondition(validation.pass,
    `PREPROCESS_ACCOUNTING_INVALID:${validation.errors.join(",")}`);
  return {
    schema: "ekg-preprocessing-batch-result-v1",
    outputs,
    failures,
    failureAccounting,
    diagnosticInterpretationIncluded: false,
    ...PIPELINE_GOVERNANCE,
  };
}

module.exports = {
  PIPELINE_GOVERNANCE,
  decodePhysicalLeads,
  executeWaveformPreprocessing,
  executeWaveformPreprocessingBatch,
  linearResample,
  preprocessBatch,
  resampleLinear,
  runSignalPreprocessingPipeline,
  segmentLeads,
  sliceSegment,
};
