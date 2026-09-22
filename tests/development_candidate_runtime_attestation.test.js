"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { deriveCandidateIsolationExpectation } = require("../lib/development_candidate_isolation");
const { LIMITATIONS, collectCandidateRuntimeAttestation, validateCandidateRuntimeAttestation } = require("../lib/development_candidate_runtime_attestation");
const { payloadSha256 } = require("../lib/evaluation_signatures");
const root = path.join(__dirname, "..");
const expectationSchema = JSON.parse(fs.readFileSync(path.join(root, "evaluation", "schemas", "DEVELOPMENT_CANDIDATE_ISOLATION_EXPECTATION_SCHEMA.json"), "utf8"));
const evidenceSchema = JSON.parse(fs.readFileSync(path.join(root, "evaluation", "schemas", "DEVELOPMENT_CANDIDATE_ISOLATION_EVIDENCE_SCHEMA.json"), "utf8"));
assert.equal(expectationSchema.$id, "ekg-development-candidate-isolation-expectation-v1");
assert.equal(expectationSchema.properties.attestationState.const, "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION");
assert.equal(evidenceSchema.$id, "ekg-development-candidate-isolation-evidence-v2");
assert.equal(evidenceSchema.properties.candidateReferenceIsolation.const, false);
assert.equal(evidenceSchema.properties.evidenceAuthority.const, "CANDIDATE_LOCAL_OBSERVATION_ONLY");
assert.deepEqual(evidenceSchema.properties.limitations.const, LIMITATIONS);
assert.deepEqual(evidenceSchema.allOf.map(rule => rule.then.properties.evidenceState.const), ["SYNTHETIC_NON_AUTHORITATIVE", "CONTAINER_LOCAL_NON_AUTHORITATIVE"]);

const syntheticExpectation = deriveCandidateIsolationExpectation({ networkIsolation: "SYNTHETIC_TEST_PROCESS" });
const synthetic = collectCandidateRuntimeAttestation(syntheticExpectation.expectation);
assert.equal(synthetic.attestation.evidenceState, "SYNTHETIC_NON_AUTHORITATIVE");
assert.equal(synthetic.attestation.candidateReferenceIsolation, false);
assert.deepEqual(synthetic.attestation.limitations, LIMITATIONS);
assert.equal(validateCandidateRuntimeAttestation(synthetic.attestation, syntheticExpectation.expectation, synthetic.candidateRuntimeAttestationSha256).candidateReferenceIsolation, false);

const productionExpectation = deriveCandidateIsolationExpectation({ networkIsolation: "CONTAINER_NETWORK_NONE", environmentImageDigest: "8".repeat(64), candidateExpectedUid: 1000, candidateExpectedGid: 1001 });
const production = collectCandidateRuntimeAttestation(productionExpectation.expectation);
assert.equal(production.attestation.evidenceState, "CONTAINER_LOCAL_NON_AUTHORITATIVE");
assert.equal(production.attestation.evidenceAuthority, "CANDIDATE_LOCAL_OBSERVATION_ONLY");
assert.equal(production.candidateReferenceIsolation, false);
assert.equal(production.attestation.externalAttestorKeyId, null);
assert.equal(production.attestation.externalAttestationSignature, null);
assert.throws(() => validateCandidateRuntimeAttestation({ ...production.attestation, candidateReferenceIsolation: true }, productionExpectation.expectation), /DEVELOPMENT_CANDIDATE_REFERENCE_ISOLATION_MUST_REMAIN_FALSE/);
assert.throws(() => validateCandidateRuntimeAttestation({ ...production.attestation, evidenceState: "VERIFIED_RUNTIME" }, productionExpectation.expectation), /DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_STATE/);
assert.throws(() => validateCandidateRuntimeAttestation({ ...production.attestation, externalAttestorKeyId: "candidate-claim" }, productionExpectation.expectation), /DEVELOPMENT_CANDIDATE_EXTERNAL_ATTESTOR_UNAVAILABLE/);
assert.throws(() => validateCandidateRuntimeAttestation(production.attestation, productionExpectation.expectation, "0".repeat(64)), /DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_DIGEST/);
assert.equal(payloadSha256(production.attestation), production.candidateRuntimeAttestationSha256);

console.log("development candidate runtime attestation tests passed");
