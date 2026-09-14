const { parseHeaderDetailed, decodeInt16Interleaved } = require("./wfdb_signal");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function rounded(value) {
  return Number(value.toFixed(12));
}

function longestConstantRun(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "QC_VALUES");
  let longest = 1;
  let current = 1;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] === values[i - 1]) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

function analyzeRawLead(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "QC_VALUES");
  let min = Infinity;
  let max = -Infinity;
  let zeroCount = 0;
  let railHitCount = 0;
  const distinct = new Set();
  for (const value of values) {
    requireCondition(Number.isInteger(value), "QC_RAW_SAMPLE");
    requireCondition(value >= -32768 && value <= 32767, "QC_INT16_RANGE");
    min = Math.min(min, value);
    max = Math.max(max, value);
    if (value === 0) zeroCount += 1;
    if (value === -32768 || value === 32767) railHitCount += 1;
    distinct.add(value);
  }

  const longestRun = longestConstantRun(values);
  const flags = [];
  if (distinct.size === 1) flags.push("ALL_SAMPLES_IDENTICAL");
  if (railHitCount > 0) flags.push("ADC_RAIL_HIT");

  return {
    count: values.length,
    rawMin: min,
    rawMax: max,
    rawSpan: max - min,
    distinctSampleCount: distinct.size,
    zeroFraction: rounded(zeroCount / values.length),
    longestConstantRun: longestRun,
    longestConstantRunFraction: rounded(longestRun / values.length),
    adcRailHitCount: railHitCount,
    flags,
    usableForEngineeringInspection: flags.length === 0,
  };
}

function inspectSignalQuality(headerText, dataBuffer) {
  const header = parseHeaderDetailed(headerText);
  const rawLeads = decodeInt16Interleaved(
    dataBuffer, header.leadCount, header.sampleCount
  );
  const leads = header.signals.map((signal, index) => ({
    leadName: signal.leadName,
    ...analyzeRawLead(rawLeads[index]),
  }));
  const unusable = leads.filter(lead => !lead.usableForEngineeringInspection);
  return {
    schema: "ekg-signal-quality-v1",
    record: header.record,
    leadCount: header.leadCount,
    sampleRate: header.sampleRate,
    sampleCount: header.sampleCount,
    durationSeconds: header.durationSeconds,
    diagnosticInterpretationIncluded: false,
    clinicalAccuracyClaimed: false,
    leads,
    unusableLeadCount: unusable.length,
    usableForEngineeringInspection: unusable.length === 0,
  };
}

module.exports = {
  analyzeRawLead,
  inspectSignalQuality,
  longestConstantRun,
};
