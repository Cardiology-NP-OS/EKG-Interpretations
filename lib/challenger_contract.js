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
  createChallengerEnvelope,
  createEvaluationWindow,
  validateChallengerEnvelope,
};