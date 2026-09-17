const assert = require("assert");
const {
  compareChallengerEventsWithinTolerance,
  createChallengerEnvelope,
  createChallengerEventAgreementMatrix,
} = require("../lib/challenger_contract");

let passed = 0;
function check(name, fn) { fn(); passed += 1; }
function throwsCode(name, fn, code) {
  check(name, () => assert.throws(fn, error => error && error.message === code));
}
const H = char => char.repeat(64);
const G = char => char.repeat(40);

function event(id, startSample, endSampleExclusive, label = "QRS", extra = {}) {
  return { id, startSample, endSampleExclusive, label, score: 0.9, abstained: false, ...extra };
}

function envelope(id, outputs, overrides = {}) {
  return createChallengerEnvelope({
    challenger: {
      id,
      version: "1.0.0",
      sourceRepository: `example/${id}`,
      sourceCommit: G(id === "source.alpha" ? "a" : id === "source.beta" ? "b" : "c"),
      sourceTree: G(id === "source.alpha" ? "d" : id === "source.beta" ? "e" : "f"),
      implementationKind: "ALGORITHM_CHALLENGER",
    },
    outputDomain: "wave_boundary",
    input: {
      sha256: H("1"), sampleRateHz: 500, sampleCount: 5000,
      leadIds: ["II"], sourceKind: "native_waveform",
    },
    preprocessing: { pipelineId: "none-v1", sha256: H("2") },
    window: { sampleRateHz: 500, windowSamples: 5000, leftContextSeconds: 1, rightContextSeconds: 1 },
    outputs,
    abstained: false,
    failureCodes: [],
    ...overrides,
  });
}

const alphaEvents = [event("event.a1", 1200, 1201), event("event.a2", 1800, 1801, "T")];
const betaExact = [event("event.b1", 1200, 1201), event("event.b2", 1800, 1801, "T")];

check("exact event match agrees", () => {
  const result = compareChallengerEventsWithinTolerance(
    envelope("source.alpha", alphaEvents), envelope("source.beta", betaExact), { toleranceSamples: 0 }
  );
  assert.strictEqual(result.status, "AGREE");
  assert.strictEqual(result.matchedCount, 2);
  assert.ok(result.matches.every(x => x.maxDeltaSamples === 0));
});

check("within-tolerance timing agrees", () => {
  const shifted = [event("event.b1", 1203, 1204), event("event.b2", 1798, 1799, "T")];
  const result = compareChallengerEventsWithinTolerance(
    envelope("source.alpha", alphaEvents), envelope("source.beta", shifted), { toleranceSamples: 3 }
  );
  assert.strictEqual(result.status, "AGREE");
  assert.deepStrictEqual(result.matches.map(x => x.maxDeltaSamples), [3, 2]);
});

check("outside tolerance remains disagreement", () => {
  const shifted = [event("event.b1", 1203, 1204), event("event.b2", 1803, 1804, "T")];
  const result = compareChallengerEventsWithinTolerance(
    envelope("source.alpha", alphaEvents), envelope("source.beta", shifted), { toleranceSamples: 2 }
  );
  assert.strictEqual(result.status, "DISAGREE");
  assert.strictEqual(result.matchedCount, 0);
});

check("label mismatch cannot become timing agreement", () => {
  const result = compareChallengerEventsWithinTolerance(
    envelope("source.alpha", [event("event.a1", 1200, 1201, "QRS")]),
    envelope("source.beta", [event("event.b1", 1200, 1201, "P")]),
    { toleranceSamples: 5 }
  );
  assert.strictEqual(result.status, "DISAGREE");
});

check("one source event cannot match two events", () => {
  const result = compareChallengerEventsWithinTolerance(
    envelope("source.alpha", [event("event.a1", 1200, 1201), event("event.a2", 1204, 1205)]),
    envelope("source.beta", [event("event.b1", 1202, 1203)]),
    { toleranceSamples: 3 }
  );
  assert.strictEqual(result.matchedCount, 1);
  assert.strictEqual(result.unmatchedSourceAOutputIds.length, 1);
  assert.strictEqual(result.unmatchedSourceBOutputIds.length, 0);
  assert.strictEqual(result.status, "PARTIAL_AGREEMENT");
});

check("source argument order is fully invariant", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact);
  assert.deepStrictEqual(
    compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 0 }),
    compareChallengerEventsWithinTolerance(b, a, { toleranceSamples: 0 })
  );
});

check("output ordering does not change semantic agreement digest", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b1 = envelope("source.beta", betaExact);
  const b2 = envelope("source.beta", [...betaExact].reverse());
  assert.notStrictEqual(b1.envelopeSha256, b2.envelopeSha256);
  const r1 = compareChallengerEventsWithinTolerance(a, b1, { toleranceSamples: 0 });
  const r2 = compareChallengerEventsWithinTolerance(a, b2, { toleranceSamples: 0 });
  assert.strictEqual(r1.agreementSha256, r2.agreementSha256);
  assert.deepStrictEqual(r1.matches, r2.matches);
  assert.notStrictEqual(r1.evidenceBindingSha256, r2.evidenceBindingSha256);
});

check("deterministic digest repeats exactly", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact);
  const r1 = compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 1 });
  const r2 = compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 1 });
  assert.strictEqual(r1.agreementSha256, r2.agreementSha256);
  assert.strictEqual(r1.evidenceBindingSha256, r2.evidenceBindingSha256);
});

check("whole-envelope abstention is explicit", () => {
  const abstained = envelope("source.alpha", [], { abstained: true, failureCodes: ["MODEL_UNAVAILABLE"] });
  const active = envelope("source.beta", betaExact);
  const result = compareChallengerEventsWithinTolerance(abstained, active, { toleranceSamples: 5 });
  assert.ok(result.status.endsWith("ABSTAINED"));
  assert.strictEqual(result.clinicalResolutionPerformed, false);
});

throwsCode("tampered envelope is rejected", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact);
  b.outputs[0].label = "P";
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_B_INVALID");

throwsCode("input byte substitution fails closed", () => {
  const a = envelope("source.alpha", alphaEvents);
  const bArgs = { sha256: H("9"), sampleRateHz: 500, sampleCount: 5000, leadIds: ["II"], sourceKind: "native_waveform" };
  const b = envelope("source.beta", betaExact, { input: bArgs });
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_INPUT_MISMATCH");

throwsCode("input metadata substitution fails closed", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact, { input: { ...a.input, leadIds: ["V1"] } });
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_INPUT_METADATA_MISMATCH");

throwsCode("preprocessing substitution fails closed", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact, { preprocessing: { pipelineId: "other-v1", sha256: H("8") } });
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_PREPROCESSING_MISMATCH");

throwsCode("domain mismatch fails closed", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact, { outputDomain: "beat_label" });
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_DOMAIN_MISMATCH");

throwsCode("window mismatch fails closed", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact, { window: { sampleRateHz: 500, windowSamples: 5000, leftContextSeconds: 0, rightContextSeconds: 0 } });
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_WINDOW_MISMATCH");

throwsCode("unsupported non-event domain fails closed", () => {
  const a = envelope("source.alpha", alphaEvents, { outputDomain: "embedding" });
  const b = envelope("source.beta", betaExact, { outputDomain: "embedding" });
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_DOMAIN_UNSUPPORTED");

for (const [name, tolerance, code] of [
  ["negative tolerance", -1, "CHALLENGER_AGREEMENT_TOLERANCE_RANGE"],
  ["noninteger tolerance", 1.5, "CHALLENGER_AGREEMENT_TOLERANCE_INTEGER"],
  ["huge tolerance", 10001, "CHALLENGER_AGREEMENT_TOLERANCE_RANGE"],
]) {
  throwsCode(`${name} fails closed`, () => compareChallengerEventsWithinTolerance(
    envelope("source.alpha", alphaEvents), envelope("source.beta", betaExact), { toleranceSamples: tolerance }
  ), code);
}

throwsCode("event agreement rejects unbounded output cardinality", () => {
  const tooMany = Array.from({ length: 513 }, (_, i) => event(`event.a${i}`, 1000 + i * 2, 1001 + i * 2));
  const peer = Array.from({ length: 513 }, (_, i) => event(`event.b${i}`, 1000 + i * 2, 1001 + i * 2));
  compareChallengerEventsWithinTolerance(
    envelope("source.alpha", tooMany), envelope("source.beta", peer), { toleranceSamples: 1 }
  );
}, "CHALLENGER_AGREEMENT_OUTPUT_LIMIT");

throwsCode("duplicate challenger identity is rejected", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.alpha", betaExact);
  compareChallengerEventsWithinTolerance(a, b, { toleranceSamples: 3 });
}, "CHALLENGER_AGREEMENT_DUPLICATE_CHALLENGER");

check("three-source matrix is source-order invariant and non-clinical", () => {
  const a = envelope("source.alpha", alphaEvents);
  const b = envelope("source.beta", betaExact);
  const c = envelope("source.gamma", [event("event.c1", 1201, 1202), event("event.c2", 1801, 1802, "T")]);
  const m1 = createChallengerEventAgreementMatrix([c, a, b], { toleranceSamples: 2 });
  const m2 = createChallengerEventAgreementMatrix([b, c, a], { toleranceSamples: 2 });
  assert.deepStrictEqual(m1, m2);
  assert.strictEqual(m1.pairCount, 3);
  assert.strictEqual(m1.decisionAuthority, "NONE");
  assert.strictEqual(m1.clinicalConsensusComputed, false);
  assert.strictEqual(m1.evidenceAdmissionPerformed, false);
  assert.strictEqual(m1.runtimeActivationPerformed, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(m1, "winner"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(m1, "majority"), false);
});

throwsCode("matrix rejects duplicate source identity", () => {
  const a = envelope("source.alpha", alphaEvents);
  createChallengerEventAgreementMatrix([a, a], { toleranceSamples: 1 });
}, "CHALLENGER_AGREEMENT_DUPLICATE_CHALLENGER");

throwsCode("matrix rejects unbounded source count", () => {
  const many = Array.from({ length: 9 }, (_, i) => envelope(`source.${String(i).padStart(2, "0")}`, alphaEvents));
  createChallengerEventAgreementMatrix(many, { toleranceSamples: 1 });
}, "CHALLENGER_AGREEMENT_MATRIX_SOURCE_COUNT");

check("agreement artifacts contain no raw payload or PHI authority", () => {
  const result = compareChallengerEventsWithinTolerance(
    envelope("source.alpha", alphaEvents), envelope("source.beta", betaExact), { toleranceSamples: 1 }
  );
  assert.strictEqual(result.rawClinicalPayloadIncluded, false);
  assert.strictEqual(result.phiIncluded, false);
  assert.strictEqual(result.decisionAuthority, "NONE");
  assert.strictEqual(result.clinicalResolutionPerformed, false);
  assert.strictEqual(result.evidenceAdmissionPerformed, false);
  assert.strictEqual(result.runtimeActivationPerformed, false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "patientId"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, "rawSignal"), false);
});

console.log(JSON.stringify({
  schema: "ekg-donor-003-event-agreement-tests-v1",
  donor: "neuropsychology/NeuroKit",
  donor_commit: "ff419d983568ef492eb8d229af643c0ef0100b32",
  pass: true,
  passed,
  total: passed,
  donor_code_copied: false,
  donor_runtime_dependency_added: false,
  synthetic_contract_inputs_only: true,
  decision_authority: "NONE",
  clinical_consensus_computed: false,
  evidence_admission_performed: false,
  runtime_activation_performed: false,
  clinical_authority_added: false,
}));
