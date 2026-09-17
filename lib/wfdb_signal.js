function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function parseGainToken(token) {
  const match = /^([0-9]+(?:\.[0-9]+)?)(?:\((-?[0-9]+(?:\.[0-9]+)?)\))?\/(\S+)$/.exec(token);
  requireCondition(match, "WFDB_GAIN_TOKEN");
  const gain = Number(match[1]);
  const baseline = match[2] === undefined ? 0 : Number(match[2]);
  requireCondition(Number.isFinite(gain) && gain > 0, "WFDB_GAIN");
  requireCondition(Number.isFinite(baseline), "WFDB_BASELINE");
  return { gain, baseline, unit: match[3] };
}

function parseSignalLine(line) {
  const parts = line.trim().split(/\s+/);
  requireCondition(parts.length >= 9, "WFDB_SIGNAL_LINE");
  requireCondition(parts[1] === "16", "WFDB_FORMAT");
  const calibration = parseGainToken(parts[2]);
  return {
    dataFile: parts[0],
    format: 16,
    gain: calibration.gain,
    baseline: calibration.baseline,
    unit: calibration.unit,
    leadName: parts.at(-1),
  };
}

function validateNarrowHeaderBoundary(record, signals) {
  requireCondition(
    typeof record === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(record),
    "WFDB_RECORD_ID"
  );
  const dataFiles = new Set();
  const leads = new Set();
  for (const signal of signals) {
    requireCondition(
      typeof signal.dataFile === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.dat$/.test(signal.dataFile),
      "WFDB_DATA_FILE"
    );
    dataFiles.add(signal.dataFile);
    requireCondition(
      typeof signal.leadName === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(signal.leadName),
      "WFDB_LEAD_NAME"
    );
    requireCondition(!leads.has(signal.leadName), "WFDB_DUPLICATE_LEAD");
    leads.add(signal.leadName);
  }
  requireCondition(dataFiles.size === 1, "WFDB_DATA_FILE_MULTIPLE");
  requireCondition(
    [...dataFiles][0] === `${record}.dat`,
    "WFDB_DATA_FILE_RECORD_MISMATCH"
  );
}

function parseHeaderDetailed(text) {
  const lines = text.trim().split(/\r?\n/);
  requireCondition(lines.length >= 2, "WFDB_HEADER_LINES");
  const first = lines[0].trim().split(/\s+/);
  requireCondition(first.length >= 4, "WFDB_HEADER_FIRST_LINE");
  const record = first[0];
  const leadCount = Number(first[1]);
  const sampleRate = Number(first[2]);
  const sampleCount = Number(first[3]);
  requireCondition(Number.isInteger(leadCount) && leadCount > 0, "WFDB_LEAD_COUNT");
  requireCondition(Number.isFinite(sampleRate) && sampleRate > 0, "WFDB_SAMPLE_RATE");
  requireCondition(Number.isInteger(sampleCount) && sampleCount > 0, "WFDB_SAMPLE_COUNT");
  requireCondition(lines.length >= leadCount + 1, "WFDB_SIGNAL_LINES_MISSING");
  const signals = lines.slice(1, leadCount + 1).map(parseSignalLine);
  validateNarrowHeaderBoundary(record, signals);
  return {
    record,
    leadCount,
    sampleRate,
    sampleCount,
    durationSeconds: sampleCount / sampleRate,
    signals,
  };
}

function decodeInt16Interleaved(buffer, leadCount, sampleCount) {
  const expectedBytes = leadCount * sampleCount * 2;
  requireCondition(buffer.length === expectedBytes, "WFDB_DATA_SIZE");
  const leads = Array.from({ length: leadCount }, () => new Array(sampleCount));
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let lead = 0; lead < leadCount; lead += 1) {
      const offset = (sample * leadCount + lead) * 2;
      leads[lead][sample] = buffer.readInt16LE(offset);
    }
  }
  return leads;
}

function toPhysical(raw, gain, baseline = 0) {
  requireCondition(Number.isFinite(raw), "WFDB_RAW_SAMPLE");
  requireCondition(Number.isFinite(gain) && gain > 0, "WFDB_GAIN");
  requireCondition(Number.isFinite(baseline), "WFDB_BASELINE");
  return (raw - baseline) / gain;
}

function rounded(value) {
  return Number(value.toFixed(12));
}

function summarize(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "WFDB_VALUES");
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sumSquares = 0;
  for (const value of values) {
    requireCondition(Number.isFinite(value), "WFDB_NONFINITE_SAMPLE");
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    sumSquares += value * value;
  }
  return {
    count: values.length,
    min: rounded(min),
    max: rounded(max),
    mean: rounded(sum / values.length),
    rms: rounded(Math.sqrt(sumSquares / values.length)),
    dynamicRange: rounded(max - min),
    finite: true,
  };
}

function uniformPreview(values, points = 25) {
  requireCondition(Number.isInteger(points) && points >= 2, "WFDB_PREVIEW_POINTS");
  if (values.length <= points) return values.slice();
  const out = [];
  for (let i = 0; i < points; i += 1) {
    const index = Math.round((i * (values.length - 1)) / (points - 1));
    out.push(values[index]);
  }
  return out;
}

function inspectRecord(headerText, dataBuffer, previewPoints = 25) {
  const header = parseHeaderDetailed(headerText);
  const rawLeads = decodeInt16Interleaved(
    dataBuffer, header.leadCount, header.sampleCount
  );
  const leads = header.signals.map((signal, index) => {
    const physical = rawLeads[index].map(value =>
      toPhysical(value, signal.gain, signal.baseline)
    );
    return {
      leadName: signal.leadName,
      unit: signal.unit,
      gain: signal.gain,
      baseline: signal.baseline,
      summary: summarize(physical),
      preview: uniformPreview(physical, previewPoints).map(rounded),
    };
  });
  return {
    schema: "ekg-wfdb-inspection-v1",
    record: header.record,
    leadCount: header.leadCount,
    sampleRate: header.sampleRate,
    sampleCount: header.sampleCount,
    durationSeconds: rounded(header.durationSeconds),
    diagnosticInterpretationIncluded: false,
    leads,
  };
}

function compareRecordShapes(a, b) {
  requireCondition(a.leadCount === b.leadCount, "WFDB_PAIR_LEAD_COUNT");
  requireCondition(
    JSON.stringify(a.leads.map(x => x.leadName)) ===
    JSON.stringify(b.leads.map(x => x.leadName)),
    "WFDB_PAIR_LEAD_ORDER"
  );
  requireCondition(a.durationSeconds === b.durationSeconds, "WFDB_PAIR_DURATION");
  return {
    leadCount: a.leadCount,
    durationSeconds: a.durationSeconds,
    sampleRateRatio: rounded(b.sampleRate / a.sampleRate),
    sameLeadOrder: true,
  };
}

module.exports = {
  compareRecordShapes,
  decodeInt16Interleaved,
  inspectRecord,
  parseGainToken,
  parseHeaderDetailed,
  summarize,
  toPhysical,
  validateNarrowHeaderBoundary,
  uniformPreview,
};
