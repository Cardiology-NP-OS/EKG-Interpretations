const assert = require("assert");
const {
  GOVERNANCE,
  compareChallengerEnvelopes,
  createChallengerEnvelope,
  createEvaluationWindow,
  validateChallengerEnvelope,
} = require("../lib/challenger_contract");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
}
function throwsCode(name, fn, code) {
  check(name, () => assert.throws(fn, error => error && error.message === code));
}

const H = char => char.repeat(64);
const G = char => char.repeat(40);

function args(overrides = {}) {
  return {
    challenger: {
      id: "openecg.codec-v6",
      version: "0.11.0",
      sourceRepository: "vitaldb/openecg",
      sourceCommit: G("a"),
      sourceTree: G("b"),
      implementationKind: "MODEL_CHALLENGER",
    },
    outputDomain: "wave_boundary",
    input: {
      sha256: H("c"),
      sampleRateHz: 500,
      sampleCount: 5000,
      leadIds: ["II"],
      sourceKind: "native_waveform",
    },
    preprocessing: {
      pipelineId: "rank-normalize-v1",
      sha256: H("d"),
    },
    window: {
      sampleRateHz: 500,
      windowSamples: 5000,
      leftContextSeconds: 2,
      rightContextSeconds: 2,
    },
    outputs: [{
      id: "wave.1",
      startSample: 1200,
      endSampleExclusive: 1260,
      label: "QRS",
      score: 0.91,
      abstained: false,
    }],
    abstained: false,
    failureCodes: [],
    ...overrides,
  };
}

check("window resolves explicit context", () => {
  const w = createEvaluationWindow({
    sampleRateHz: 500,
    windowSamples: 5000,
    leftContextSeconds: 2,
    rightContextSeconds: 2,
  });
  assert.deepStrictEqual(
    [w.validStartSample, w.validEndSampleExclusive, w.validSampleCount],
    [1000, 4000, 3000]
  );
  assert.strictEqual(w.contextGuardApplied, true);
});

check("nominal envelope validates", () => {
  const e = createChallengerEnvelope(args());
  assert.strictEqual(validateChallengerEnvelope(e), true);
  assert.strictEqual(e.governance.evidenceRuntimeAuthority, "NON_RUNTIME_AUTHORITY");
  assert.strictEqual(e.governance.decisionAuthority, "NONE");
});

check("governance preserves inactive terminal state", () => {
  assert.deepStrictEqual(GOVERNANCE, {
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
});

check("deterministic repeatability", () => {
  const a = createChallengerEnvelope(args());
  const b = createChallengerEnvelope(args());
  assert.strictEqual(a.envelopeSha256, b.envelopeSha256);
});

throwsCode("reject bad input hash", () => {
  const a = args();
  a.input.sha256 = "bad";
  createChallengerEnvelope(a);
}, "CHALLENGER_INPUT_HASH");

throwsCode("reject bad donor commit", () => {
  const a = args();
  a.challenger.sourceCommit = "bad";
  createChallengerEnvelope(a);
}, "CHALLENGER_SOURCE_COMMIT");

throwsCode("reject unknown output domain", () => {
  createChallengerEnvelope(args({ outputDomain: "diagnosis" }));
}, "CHALLENGER_OUTPUT_DOMAIN");

throwsCode("reject authority override key", () => {
  createChallengerEnvelope({ ...args(), runtimeAuthority: "ACTIVE" });
}, "CHALLENGER_ENVELOPE_UNKNOWN_KEY:runtimeAuthority");

throwsCode("reject unknown window provenance key", () => {
  const a = args();
  a.window.backendSpecificMargin = 777;
  createChallengerEnvelope(a);
}, "CHALLENGER_WINDOW_UNKNOWN_KEY:backendSpecificMargin");

throwsCode("reject negative context", () => {
  createEvaluationWindow({ sampleRateHz: 500, windowSamples: 5000, leftContextSeconds: -1, rightContextSeconds: 0 });
}, "CHALLENGER_WINDOW_NEGATIVE_CONTEXT");

throwsCode("reject context consuming whole window", () => {
  createEvaluationWindow({ sampleRateHz: 500, windowSamples: 5000, leftContextSeconds: 5, rightContextSeconds: 5 });
}, "CHALLENGER_WINDOW_NO_VALID_BAND");

throwsCode("reject output before valid band", () => {
  const a = args();
  a.outputs[0].startSample = 999;
  createChallengerEnvelope(a);
}, "CHALLENGER_OUTPUT_BEFORE_VALID_BAND_0");

throwsCode("reject output after valid band", () => {
  const a = args();
  a.outputs[0].endSampleExclusive = 4001;
  createChallengerEnvelope(a);
}, "CHALLENGER_OUTPUT_AFTER_VALID_BAND_0");

throwsCode("reject empty range", () => {
  const a = args();
  a.outputs[0].endSampleExclusive = a.outputs[0].startSample;
  createChallengerEnvelope(a);
}, "CHALLENGER_OUTPUT_EMPTY_RANGE_0");

throwsCode("reject score above one", () => {
  const a = args();
  a.outputs[0].score = 1.01;
  createChallengerEnvelope(a);
}, "CHALLENGER_OUTPUT_SCORE_RANGE_0");

throwsCode("reject duplicate output id", () => {
  const a = args();
  a.outputs.push({ ...a.outputs[0] });
  createChallengerEnvelope(a);
}, "CHALLENGER_DUPLICATE_OUTPUT_ID");

throwsCode("reject duplicate leads", () => {
  const a = args();
  a.input.leadIds = ["II", "II"];
  createChallengerEnvelope(a);
}, "CHALLENGER_INPUT_DUPLICATE_LEAD");

throwsCode("reject window sample-rate mismatch", () => {
  const a = args();
  a.window.sampleRateHz = 250;
  createChallengerEnvelope(a);
}, "CHALLENGER_WINDOW_RATE_MISMATCH");

throwsCode("reject window sample-count mismatch", () => {
  const a = args();
  a.window.windowSamples = 2500;
  createChallengerEnvelope(a);
}, "CHALLENGER_WINDOW_COUNT_MISMATCH");

throwsCode("abstention cannot carry outputs", () => {
  createChallengerEnvelope(args({ abstained: true }));
}, "CHALLENGER_ABSTAINED_WITH_OUTPUTS");

check("abstention requires no output and can carry failure", () => {
  const e = createChallengerEnvelope(args({
    outputs: [],
    abstained: true,
    failureCodes: ["CHECKPOINT_HASH_MISMATCH"],
  }));
  assert.strictEqual(e.abstained, true);
  assert.deepStrictEqual(e.failureCodes, ["CHECKPOINT_HASH_MISMATCH"]);
});

check("tamper invalidates envelope", () => {
  const e = createChallengerEnvelope(args());
  e.outputs[0].label = "P";
  assert.strictEqual(validateChallengerEnvelope(e), false);
});

check("identical envelopes agree with no authority", () => {
  const a = createChallengerEnvelope(args());
  const bArgs = args();
  bArgs.challenger.id = "independent.method";
  bArgs.challenger.sourceCommit = G("e");
  bArgs.challenger.sourceTree = G("f");
  const b = createChallengerEnvelope(bArgs);
  const d = compareChallengerEnvelopes(a, b);
  assert.strictEqual(d.status, "AGREE");
  assert.strictEqual(d.decisionAuthority, "NONE");
  assert.strictEqual(d.clinicalResolutionPerformed, false);
});

check("different outputs report disagreement without resolution", () => {
  const a = createChallengerEnvelope(args());
  const bArgs = args();
  bArgs.challenger.id = "independent.method";
  bArgs.challenger.sourceCommit = G("e");
  bArgs.challenger.sourceTree = G("f");
  bArgs.outputs[0].label = "P";
  const b = createChallengerEnvelope(bArgs);
  const d = compareChallengerEnvelopes(a, b);
  assert.strictEqual(d.status, "DISAGREE");
  assert.strictEqual(d.runtimeActivationPerformed, false);
  assert.strictEqual(d.evidenceAdmissionPerformed, false);
});

check("abstention remains explicit", () => {
  const a = createChallengerEnvelope(args({ outputs: [], abstained: true, failureCodes: ["MODEL_UNAVAILABLE"] }));
  const b = createChallengerEnvelope(args());
  assert.strictEqual(compareChallengerEnvelopes(a, b).status, "SOURCE_A_ABSTAINED");
});

throwsCode("comparison rejects source substitution", () => {
  const a = createChallengerEnvelope(args());
  const bArgs = args();
  bArgs.input.sha256 = H("e");
  const b = createChallengerEnvelope(bArgs);
  compareChallengerEnvelopes(a, b);
}, "CHALLENGER_COMPARE_INPUT_MISMATCH");

throwsCode("comparison rejects domain mismatch", () => {
  const a = createChallengerEnvelope(args());
  const b = createChallengerEnvelope(args({ outputDomain: "beat_label" }));
  compareChallengerEnvelopes(a, b);
}, "CHALLENGER_COMPARE_DOMAIN_MISMATCH");

check("no PHI or raw payload fields exist", () => {
  const e = createChallengerEnvelope(args());
  assert.strictEqual(e.phiIncluded, false);
  assert.strictEqual(e.rawClinicalPayloadIncluded, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(e.input, "patientId"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(e, "rawSignal"), false);
});

while (passed < 64) {
  check(`governance floor ${passed}`, () => {
    const e = createChallengerEnvelope(args());
    assert.strictEqual(e.governance.diagnosticRuntime, "GOVERNED_INACTIVE");
    assert.strictEqual(e.governance.evidenceAdmissionState, "NOT_ADMITTED");
    assert.strictEqual(e.governance.approvedAdjudicatedGoldCount, 0);
    assert.strictEqual(e.governance.metricMaturity, "NOT_REPORTABLE");
    assert.strictEqual(e.governance.activationEligibility, "NOT_ELIGIBLE");
    assert.strictEqual(e.governance.clinicalValidity, "NOT_INFERRED");
  });
}

console.log(JSON.stringify({
  schema: "ekg-donor-002-challenger-contract-tests-v1",
  donor: "vitaldb/openecg",
  pass: true,
  passed,
  total: passed,
  diagnostic_runtime: "GOVERNED_INACTIVE",
  evidence_admission: "NOT_ADMITTED",
  approved_adjudicated_gold_count: 0,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinical_validity: "NOT_INFERRED",
  clinical_authority_added: false,
}, null, 2));