const crypto = require("crypto");

const HASH64 = /^[0-9a-f]{64}$/;
const GIT40 = /^[0-9a-f]{40}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$/;
const OUTPUT_DOMAINS = new Set([
  "wave_boundary",
  "beat_label",
  "rhythm_label",
  "measurement",
  "quality_flag",
  "embedding",
  "evaluation_other",
]);
const IMPLEMENTATION_KINDS = new Set([
  "MODEL_CHALLENGER",
  "ALGORITHM_CHALLENGER",
  "EVALUATION_ONLY",
]);
const EVENT_AGREEMENT_DOMAINS = new Set(["wave_boundary", "beat_label", "rhythm_label"]);
const MAX_EVENT_AGREEMENT_SOURCES = 8;
const MAX_EVENT_OUTPUTS = 512;
const MAX_EVENT_TOLERANCE_SAMPLES = 10000;

const GOVERNANCE = Object.freeze({
  completionState: "SPECIALIST_COMPLETE_INACTIVE",
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmissionState: "NOT_ADMITTED",
  approvedAdjudicatedGoldCount: 0,
  metricMaturity: "NOT_REPORTABLE",
  activationEligibility: "NOT_ELIGIBLE",
  clinicalValidity: "NOT_INFERRED",
  evidenceRuntimeAuthority: "NON_RUNTIME_AUTHORITY",
  decisionAuthority: "NONE",
  clinicalAuthorityTransfer: false,
  clinicalAccuracyClaimed: false,
});

function fail(condition, code) {
  if (!condition) throw new Error(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value, allowed, code) {
  fail(isPlainObject(value), `${code}_OBJECT_REQUIRED`);
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  fail(unknown.length === 0, `${code}_UNKNOWN_KEY:${unknown[0]}`);
}

function safeId(value, code) {
  fail(typeof value === "string" && SAFE_ID.test(value), code);
  return value;
}

function safeText(value, code, max = 160) {
  fail(typeof value === "string" && value.length > 0 && value.length <= max, code);
  fail(!/[\u0000-\u001f\u007f]/.test(value), code);
  return value;
}

function finiteNumber(value, code) {
  fail(typeof value === "number" && Number.isFinite(value), code);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  fail(
    value === null || ["string", "number", "boolean"].includes(typeof value),
    "CHALLENGER_NON_JSON_VALUE"
  );
  if (typeof value === "number") fail(Number.isFinite(value), "CHALLENGER_NONFINITE_VALUE");
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonical(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

function createEvaluationWindow(args) {
  exactKeys(
    args,
    ["sampleRateHz", "windowSamples", "leftContextSeconds", "rightContextSeconds"],
    "CHALLENGER_WINDOW"
  );
  const {
    sampleRateHz,
    windowSamples,
    leftContextSeconds = 0,
    rightContextSeconds = 0,
  } = args;
  fail(Number.isInteger(sampleRateHz) && sampleRateHz > 0, "CHALLENGER_WINDOW_SAMPLE_RATE");
  fail(Number.isInteger(windowSamples) && windowSamples > 0, "CHALLENGER_WINDOW_SAMPLES");
  finiteNumber(leftContextSeconds, "CHALLENGER_WINDOW_LEFT_CONTEXT");
  finiteNumber(rightContextSeconds, "CHALLENGER_WINDOW_RIGHT_CONTEXT");
  fail(leftContextSeconds >= 0 && rightContextSeconds >= 0, "CHALLENGER_WINDOW_NEGATIVE_CONTEXT");
  const leftContextSamples = Math.round(leftContextSeconds * sampleRateHz);
  const rightContextSamples = Math.round(rightContextSeconds * sampleRateHz);
  fail(leftContextSamples + rightContextSamples < windowSamples, "CHALLENGER_WINDOW_NO_VALID_BAND");
  return {
    schema: "ekg-challenger-evaluation-window-v1",
    sampleRateHz,
    windowSamples,
    leftContextSeconds,
    rightContextSeconds,
    leftContextSamples,
    rightContextSamples,
    validStartSample: leftContextSamples,
    validEndSampleExclusive: windowSamples - rightContextSamples,
    validSampleCount: windowSamples - leftContextSamples - rightContextSamples,
    contextGuardApplied: leftContextSamples > 0 || rightContextSamples > 0,
  };
}

function normalizeChallenger(challenger) {
  exactKeys(
    challenger,
    ["id", "version", "sourceRepository", "sourceCommit", "sourceTree", "implementationKind"],
    "CHALLENGER_DESCRIPTOR"
  );
  safeId(challenger.id, "CHALLENGER_ID");
  safeId(challenger.version, "CHALLENGER_VERSION");
  safeText(challenger.sourceRepository, "CHALLENGER_SOURCE_REPOSITORY");
  fail(GIT40.test(challenger.sourceCommit), "CHALLENGER_SOURCE_COMMIT");
  fail(GIT40.test(challenger.sourceTree), "CHALLENGER_SOURCE_TREE");
  fail(IMPLEMENTATION_KINDS.has(challenger.implementationKind), "CHALLENGER_IMPLEMENTATION_KIND");
  return { ...challenger };
}

function normalizeInput(input) {
  exactKeys(
    input,
    ["sha256", "sampleRateHz", "sampleCount", "leadIds", "sourceKind"],
    "CHALLENGER_INPUT"
  );
  fail(HASH64.test(input.sha256), "CHALLENGER_INPUT_HASH");
  fail(Number.isInteger(input.sampleRateHz) && input.sampleRateHz > 0, "CHALLENGER_INPUT_SAMPLE_RATE");
  fail(Number.isInteger(input.sampleCount) && input.sampleCount > 0, "CHALLENGER_INPUT_SAMPLE_COUNT");
  fail(Array.isArray(input.leadIds) && input.leadIds.length > 0 && input.leadIds.length <= 32, "CHALLENGER_INPUT_LEADS");
  const leadIds = input.leadIds.map((lead, index) => safeText(lead, `CHALLENGER_INPUT_LEAD_${index}`, 32));
  fail(new Set(leadIds).size === leadIds.length, "CHALLENGER_INPUT_DUPLICATE_LEAD");
  safeId(input.sourceKind, "CHALLENGER_INPUT_SOURCE_KIND");
  return { ...input, leadIds };
}

function normalizePreprocessing(preprocessing) {
  exactKeys(preprocessing, ["pipelineId", "sha256"], "CHALLENGER_PREPROCESSING");
  safeId(preprocessing.pipelineId, "CHALLENGER_PREPROCESSING_ID");
  fail(HASH64.test(preprocessing.sha256), "CHALLENGER_PREPROCESSING_HASH");
  return { ...preprocessing };
}

function normalizeOutput(output, index, validStart, validEnd) {
  exactKeys(
    output,
    ["id", "startSample", "endSampleExclusive", "label", "score", "abstained", "reasonCode"],
    `CHALLENGER_OUTPUT_${index}`
  );
  safeId(output.id, `CHALLENGER_OUTPUT_ID_${index}`);
  fail(Number.isInteger(output.startSample), `CHALLENGER_OUTPUT_START_${index}`);
  fail(Number.isInteger(output.endSampleExclusive), `CHALLENGER_OUTPUT_END_${index}`);
  fail(output.startSample >= validStart, `CHALLENGER_OUTPUT_BEFORE_VALID_BAND_${index}`);
  fail(output.endSampleExclusive <= validEnd, `CHALLENGER_OUTPUT_AFTER_VALID_BAND_${index}`);
  fail(output.endSampleExclusive > output.startSample, `CHALLENGER_OUTPUT_EMPTY_RANGE_${index}`);
  safeText(output.label, `CHALLENGER_OUTPUT_LABEL_${index}`, 120);
  if (output.score !== undefined) {
    finiteNumber(output.score, `CHALLENGER_OUTPUT_SCORE_${index}`);
    fail(output.score >= 0 && output.score <= 1, `CHALLENGER_OUTPUT_SCORE_RANGE_${index}`);
  }
  fail(typeof output.abstained === "boolean", `CHALLENGER_OUTPUT_ABSTAINED_${index}`);
  if (output.reasonCode !== undefined) safeId(output.reasonCode, `CHALLENGER_OUTPUT_REASON_${index}`);
  if (output.abstained) fail(output.reasonCode !== undefined, `CHALLENGER_OUTPUT_ABSTENTION_REASON_${index}`);
  return { ...output };
}

function createChallengerEnvelope(args) {
  exactKeys(
    args,
    ["challenger", "outputDomain", "input", "preprocessing", "window", "outputs", "abstained", "failureCodes"],
    "CHALLENGER_ENVELOPE"
  );
  const challenger = normalizeChallenger(args.challenger);
  fail(OUTPUT_DOMAINS.has(args.outputDomain), "CHALLENGER_OUTPUT_DOMAIN");
  const input = normalizeInput(args.input);
  const preprocessing = normalizePreprocessing(args.preprocessing);
  fail(isPlainObject(args.window), "CHALLENGER_WINDOW_REQUIRED");
  const window = createEvaluationWindow(args.window);
  fail(window.sampleRateHz === input.sampleRateHz, "CHALLENGER_WINDOW_RATE_MISMATCH");
  fail(window.windowSamples === input.sampleCount, "CHALLENGER_WINDOW_COUNT_MISMATCH");
  fail(Array.isArray(args.outputs) && args.outputs.length <= 10000, "CHALLENGER_OUTPUTS");
  const outputs = args.outputs.map((output, index) => normalizeOutput(
    output, index, window.validStartSample, window.validEndSampleExclusive
  ));
  const ids = outputs.map(output => output.id);
  fail(new Set(ids).size === ids.length, "CHALLENGER_DUPLICATE_OUTPUT_ID");
  fail(typeof args.abstained === "boolean", "CHALLENGER_ABSTAINED");
  fail(Array.isArray(args.failureCodes) && args.failureCodes.length <= 64, "CHALLENGER_FAILURE_CODES");
  const failureCodes = args.failureCodes.map((code, index) => safeId(code, `CHALLENGER_FAILURE_CODE_${index}`));
  fail(new Set(failureCodes).size === failureCodes.length, "CHALLENGER_DUPLICATE_FAILURE_CODE");
  if (args.abstained) fail(outputs.length === 0, "CHALLENGER_ABSTAINED_WITH_OUTPUTS");

  const body = {
    schema: "ekg-challenger-envelope-v1",
    challenger,
    outputDomain: args.outputDomain,
    input,
    preprocessing,
    window,
    outputs,
    abstained: args.abstained,
    failureCodes,
    governance: { ...GOVERNANCE },
    rawClinicalPayloadIncluded: false,
    phiIncluded: false,
  };
  return { ...body, envelopeSha256: digest(body) };
}

function validateChallengerEnvelope(value) {
  if (!isPlainObject(value) || !HASH64.test(value.envelopeSha256 || "")) return false;
  try {
    const rebuilt = createChallengerEnvelope({
      challenger: value.challenger,
      outputDomain: value.outputDomain,
      input: value.input,
      preprocessing: value.preprocessing,
      window: {
        sampleRateHz: value.window.sampleRateHz,
        windowSamples: value.window.windowSamples,
        leftContextSeconds: value.window.leftContextSeconds,
        rightContextSeconds: value.window.rightContextSeconds,
      },
      outputs: value.outputs,
      abstained: value.abstained,
      failureCodes: value.failureCodes,
    });
    return canonicalStringify(rebuilt) === canonicalStringify(value);
  } catch (_) {
    return false;
  }
}

function eventSortKey(output) {
  return [
    output.startSample,
    output.endSampleExclusive,
    output.label,
    output.abstained ? 1 : 0,
    output.reasonCode || "",
    output.id,
  ];
}

function compareTuple(a, b) {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

function sortedEventOutputs(outputs) {
  return [...outputs].sort((a, b) => compareTuple(eventSortKey(a), eventSortKey(b)));
}

function semanticEnvelopeSha256(envelope) {
  fail(validateChallengerEnvelope(envelope), "CHALLENGER_AGREEMENT_ENVELOPE_INVALID");
  return digest({
    schema: envelope.schema,
    challenger: envelope.challenger,
    outputDomain: envelope.outputDomain,
    input: envelope.input,
    preprocessing: envelope.preprocessing,
    window: envelope.window,
    outputs: sortedEventOutputs(envelope.outputs),
    abstained: envelope.abstained,
    failureCodes: [...envelope.failureCodes].sort(),
    governance: envelope.governance,
    rawClinicalPayloadIncluded: envelope.rawClinicalPayloadIncluded,
    phiIncluded: envelope.phiIncluded,
  });
}

function challengerIdentity(envelope) {
  return `${envelope.challenger.id}@${envelope.challenger.version}:${envelope.challenger.sourceCommit}`;
}

function agreementOptions(options, validSampleCount) {
  exactKeys(options, ["toleranceSamples"], "CHALLENGER_AGREEMENT_OPTIONS");
  fail(Number.isInteger(options.toleranceSamples), "CHALLENGER_AGREEMENT_TOLERANCE_INTEGER");
  fail(
    options.toleranceSamples >= 0 &&
      options.toleranceSamples <= MAX_EVENT_TOLERANCE_SAMPLES &&
      options.toleranceSamples < validSampleCount,
    "CHALLENGER_AGREEMENT_TOLERANCE_RANGE"
  );
  return { toleranceSamples: options.toleranceSamples };
}

function comparableEventSources(a, b) {
  fail(validateChallengerEnvelope(a), "CHALLENGER_AGREEMENT_A_INVALID");
  fail(validateChallengerEnvelope(b), "CHALLENGER_AGREEMENT_B_INVALID");
  fail(a.challenger.id !== b.challenger.id, "CHALLENGER_AGREEMENT_DUPLICATE_CHALLENGER");
  fail(a.input.sha256 === b.input.sha256, "CHALLENGER_AGREEMENT_INPUT_MISMATCH");
  fail(canonicalStringify(a.input) === canonicalStringify(b.input), "CHALLENGER_AGREEMENT_INPUT_METADATA_MISMATCH");
  fail(a.outputDomain === b.outputDomain, "CHALLENGER_AGREEMENT_DOMAIN_MISMATCH");
  fail(EVENT_AGREEMENT_DOMAINS.has(a.outputDomain), "CHALLENGER_AGREEMENT_DOMAIN_UNSUPPORTED");
  fail(
    canonicalStringify(a.preprocessing) === canonicalStringify(b.preprocessing),
    "CHALLENGER_AGREEMENT_PREPROCESSING_MISMATCH"
  );
  fail(canonicalStringify(a.window) === canonicalStringify(b.window), "CHALLENGER_AGREEMENT_WINDOW_MISMATCH");
  fail(a.outputs.length <= MAX_EVENT_OUTPUTS && b.outputs.length <= MAX_EVENT_OUTPUTS, "CHALLENGER_AGREEMENT_OUTPUT_LIMIT");
  return [a, b].sort((x, y) => challengerIdentity(x).localeCompare(challengerIdentity(y)));
}

function eventPairDistance(a, b) {
  if (a.label !== b.label || a.abstained !== b.abstained) return null;
  if (a.abstained && (a.reasonCode || "") !== (b.reasonCode || "")) return null;
  const startDeltaSamples = Math.abs(a.startSample - b.startSample);
  const endDeltaSamples = Math.abs(a.endSampleExclusive - b.endSampleExclusive);
  return {
    startDeltaSamples,
    endDeltaSamples,
    maxDeltaSamples: Math.max(startDeltaSamples, endDeltaSamples),
  };
}

function matchEventOutputs(sourceAOutputs, sourceBOutputs, toleranceSamples) {
  const a = sortedEventOutputs(sourceAOutputs);
  const b = sortedEventOutputs(sourceBOutputs);
  const candidates = a.map((eventA) => b
    .map((eventB, bIndex) => ({ bIndex, distance: eventPairDistance(eventA, eventB) }))
    .filter((edge) => edge.distance !== null && edge.distance.maxDeltaSamples <= toleranceSamples)
    .sort((x, y) => {
      if (x.distance.maxDeltaSamples !== y.distance.maxDeltaSamples) {
        return x.distance.maxDeltaSamples - y.distance.maxDeltaSamples;
      }
      return compareTuple(eventSortKey(b[x.bIndex]), eventSortKey(b[y.bIndex]));
    }));

  const bToA = new Map();
  function assign(aIndex, seenB) {
    for (const edge of candidates[aIndex]) {
      if (seenB.has(edge.bIndex)) continue;
      seenB.add(edge.bIndex);
      const priorA = bToA.get(edge.bIndex);
      if (priorA === undefined || assign(priorA, seenB)) {
        bToA.set(edge.bIndex, aIndex);
        return true;
      }
    }
    return false;
  }
  for (let aIndex = 0; aIndex < a.length; aIndex += 1) assign(aIndex, new Set());

  const matchedA = new Set(bToA.values());
  const matches = [...bToA.entries()].map(([bIndex, aIndex]) => {
    const distance = eventPairDistance(a[aIndex], b[bIndex]);
    return {
      sourceAOutputId: a[aIndex].id,
      sourceBOutputId: b[bIndex].id,
      label: a[aIndex].label,
      abstained: a[aIndex].abstained,
      startDeltaSamples: distance.startDeltaSamples,
      endDeltaSamples: distance.endDeltaSamples,
      maxDeltaSamples: distance.maxDeltaSamples,
    };
  }).sort((x, y) => {
    const ax = a.find((event) => event.id === x.sourceAOutputId);
    const ay = a.find((event) => event.id === y.sourceAOutputId);
    return compareTuple(eventSortKey(ax), eventSortKey(ay));
  });

  return {
    matches,
    unmatchedSourceAOutputIds: a.filter((_, index) => !matchedA.has(index)).map((event) => event.id),
    unmatchedSourceBOutputIds: b.filter((_, index) => !bToA.has(index)).map((event) => event.id),
  };
}

function compareChallengerEventsWithinTolerance(a, b, options) {
  const [sourceA, sourceB] = comparableEventSources(a, b);
  const { toleranceSamples } = agreementOptions(options, sourceA.window.validSampleCount);
  let status;
  let matched = { matches: [], unmatchedSourceAOutputIds: [], unmatchedSourceBOutputIds: [] };
  if (sourceA.abstained && sourceB.abstained) {
    status = "BOTH_ABSTAINED";
  } else if (sourceA.abstained) {
    status = "SOURCE_A_ABSTAINED";
    matched.unmatchedSourceBOutputIds = sortedEventOutputs(sourceB.outputs).map((event) => event.id);
  } else if (sourceB.abstained) {
    status = "SOURCE_B_ABSTAINED";
    matched.unmatchedSourceAOutputIds = sortedEventOutputs(sourceA.outputs).map((event) => event.id);
  } else {
    matched = matchEventOutputs(sourceA.outputs, sourceB.outputs, toleranceSamples);
    if (matched.unmatchedSourceAOutputIds.length === 0 && matched.unmatchedSourceBOutputIds.length === 0) {
      status = "AGREE";
    } else if (matched.matches.length > 0) {
      status = "PARTIAL_AGREEMENT";
    } else {
      status = "DISAGREE";
    }
  }

  const semanticBody = {
    schema: "ekg-challenger-event-agreement-v1",
    sourceA: {
      challengerId: sourceA.challenger.id,
      challengerVersion: sourceA.challenger.version,
      semanticEnvelopeSha256: semanticEnvelopeSha256(sourceA),
    },
    sourceB: {
      challengerId: sourceB.challenger.id,
      challengerVersion: sourceB.challenger.version,
      semanticEnvelopeSha256: semanticEnvelopeSha256(sourceB),
    },
    inputSha256: sourceA.input.sha256,
    preprocessingSha256: sourceA.preprocessing.sha256,
    outputDomain: sourceA.outputDomain,
    toleranceSamples,
    status,
    matchedCount: matched.matches.length,
    sourceAOutputCount: sourceA.outputs.length,
    sourceBOutputCount: sourceB.outputs.length,
    matches: matched.matches,
    unmatchedSourceAOutputIds: matched.unmatchedSourceAOutputIds,
    unmatchedSourceBOutputIds: matched.unmatchedSourceBOutputIds,
    decisionAuthority: "NONE",
    clinicalResolutionPerformed: false,
    evidenceAdmissionPerformed: false,
    runtimeActivationPerformed: false,
    rawClinicalPayloadIncluded: false,
    phiIncluded: false,
  };
  const agreementSha256 = digest(semanticBody);
  const observed = {
    sourceAObservedEnvelopeSha256: sourceA.envelopeSha256,
    sourceBObservedEnvelopeSha256: sourceB.envelopeSha256,
  };
  return {
    ...semanticBody,
    ...observed,
    agreementSha256,
    evidenceBindingSha256: digest({ ...semanticBody, ...observed, agreementSha256 }),
  };
}

function createChallengerEventAgreementMatrix(envelopes, options) {
  fail(Array.isArray(envelopes), "CHALLENGER_AGREEMENT_MATRIX_ARRAY");
  fail(
    envelopes.length >= 2 && envelopes.length <= MAX_EVENT_AGREEMENT_SOURCES,
    "CHALLENGER_AGREEMENT_MATRIX_SOURCE_COUNT"
  );
  for (const envelope of envelopes) {
    fail(validateChallengerEnvelope(envelope), "CHALLENGER_AGREEMENT_MATRIX_ENVELOPE_INVALID");
  }
  const ids = envelopes.map((envelope) => envelope.challenger.id);
  fail(new Set(ids).size === ids.length, "CHALLENGER_AGREEMENT_DUPLICATE_CHALLENGER");
  const sources = [...envelopes].sort((a, b) => challengerIdentity(a).localeCompare(challengerIdentity(b)));
  agreementOptions(options, sources[0].window.validSampleCount);
  const pairs = [];
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const pair = compareChallengerEventsWithinTolerance(sources[i], sources[j], options);
      pairs.push({
        sourceAChallengerId: pair.sourceA.challengerId,
        sourceBChallengerId: pair.sourceB.challengerId,
        status: pair.status,
        matchedCount: pair.matchedCount,
        sourceAOutputCount: pair.sourceAOutputCount,
        sourceBOutputCount: pair.sourceBOutputCount,
        agreementSha256: pair.agreementSha256,
      });
    }
  }
  const body = {
    schema: "ekg-challenger-event-agreement-matrix-v1",
    sources: sources.map((source) => ({
      challengerId: source.challenger.id,
      challengerVersion: source.challenger.version,
      semanticEnvelopeSha256: semanticEnvelopeSha256(source),
    })),
    inputSha256: sources[0].input.sha256,
    outputDomain: sources[0].outputDomain,
    toleranceSamples: options.toleranceSamples,
    pairCount: pairs.length,
    pairs,
    decisionAuthority: "NONE",
    clinicalConsensusComputed: false,
    clinicalResolutionPerformed: false,
    evidenceAdmissionPerformed: false,
    runtimeActivationPerformed: false,
    rawClinicalPayloadIncluded: false,
    phiIncluded: false,
  };
  return { ...body, matrixSha256: digest(body) };
}

function compareChallengerEnvelopes(a, b) {
  fail(validateChallengerEnvelope(a), "CHALLENGER_COMPARE_A_INVALID");
  fail(validateChallengerEnvelope(b), "CHALLENGER_COMPARE_B_INVALID");
  fail(a.input.sha256 === b.input.sha256, "CHALLENGER_COMPARE_INPUT_MISMATCH");
  fail(a.outputDomain === b.outputDomain, "CHALLENGER_COMPARE_DOMAIN_MISMATCH");
  fail(
    a.window.validStartSample === b.window.validStartSample &&
      a.window.validEndSampleExclusive === b.window.validEndSampleExclusive,
    "CHALLENGER_COMPARE_WINDOW_MISMATCH"
  );
  let status;
  if (a.abstained && b.abstained) status = "BOTH_ABSTAINED";
  else if (a.abstained) status = "SOURCE_A_ABSTAINED";
  else if (b.abstained) status = "SOURCE_B_ABSTAINED";
  else status = canonicalStringify(a.outputs) === canonicalStringify(b.outputs) ? "AGREE" : "DISAGREE";
  const body = {
    schema: "ekg-challenger-disagreement-v1",
    sourceAEnvelopeSha256: a.envelopeSha256,
    sourceBEnvelopeSha256: b.envelopeSha256,
    inputSha256: a.input.sha256,
    outputDomain: a.outputDomain,
    status,
    decisionAuthority: "NONE",
    clinicalResolutionPerformed: false,
    evidenceAdmissionPerformed: false,
    runtimeActivationPerformed: false,
  };
  return { ...body, disagreementSha256: digest(body) };
}

module.exports = {
  GOVERNANCE,
  OUTPUT_DOMAINS,
  canonicalStringify,
  compareChallengerEnvelopes,
  compareChallengerEventsWithinTolerance,
  createChallengerEnvelope,
  createChallengerEventAgreementMatrix,
  createEvaluationWindow,
  validateChallengerEnvelope,
};