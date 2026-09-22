"use strict";

const { validateCandidateIsolationExpectation } = require("./development_candidate_isolation");
const { payloadSha256 } = require("./evaluation_signatures");

const LIMITATIONS = Object.freeze([
  "NO_INDEPENDENT_CONTROL_PLANE_ATTESTOR",
  "NO_EXCLUSIVE_IMAGE_PROVENANCE",
  "NO_EXCLUSIVE_MOUNT_PROVENANCE",
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, code) {
  requireCondition(plain(value), code);
  requireCondition(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.slice().sort()), code);
}

function validateCandidateRuntimeAttestation(attestation, expectation, expectedDigest) {
  const validatedExpectation = validateCandidateIsolationExpectation(expectation);
  exactKeys(attestation, ["schema", "evidenceState", "evidenceAuthority", "isolationMode", "candidateInputMode", "candidateIsolationExpectationSha256", "externalAttestorKeyId", "externalAttestationSignature", "limitations", "candidateReferenceIsolation"], "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_FIELDS");
  requireCondition(attestation.schema === "ekg-development-candidate-isolation-evidence-v2", "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_SCHEMA");
  requireCondition(attestation.evidenceState === (expectation.isolationMode === "SYNTHETIC_IN_PROCESS" ? "SYNTHETIC_NON_AUTHORITATIVE" : "CONTAINER_LOCAL_NON_AUTHORITATIVE"), "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_STATE");
  requireCondition(attestation.evidenceAuthority === "CANDIDATE_LOCAL_OBSERVATION_ONLY", "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_AUTHORITY");
  requireCondition(attestation.isolationMode === expectation.isolationMode && attestation.candidateInputMode === expectation.candidateInputMode, "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_BINDING");
  requireCondition(attestation.candidateIsolationExpectationSha256 === validatedExpectation.candidateIsolationExpectationSha256, "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_BINDING:candidateIsolationExpectationSha256");
  requireCondition(attestation.externalAttestorKeyId === null && attestation.externalAttestationSignature === null, "DEVELOPMENT_CANDIDATE_EXTERNAL_ATTESTOR_UNAVAILABLE");
  requireCondition(JSON.stringify(attestation.limitations) === JSON.stringify(LIMITATIONS), "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_LIMITATIONS");
  requireCondition(attestation.candidateReferenceIsolation === false, "DEVELOPMENT_CANDIDATE_REFERENCE_ISOLATION_MUST_REMAIN_FALSE");
  const digest = payloadSha256(attestation);
  if (expectedDigest !== undefined) requireCondition(digest === expectedDigest, "DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_DIGEST");
  return { attestation, candidateRuntimeAttestationSha256: digest, candidateReferenceIsolation: false };
}

function collectCandidateRuntimeAttestation(expectation) {
  const validatedExpectation = validateCandidateIsolationExpectation(expectation);
  return validateCandidateRuntimeAttestation({
    schema: "ekg-development-candidate-isolation-evidence-v2",
    evidenceState: expectation.isolationMode === "SYNTHETIC_IN_PROCESS" ? "SYNTHETIC_NON_AUTHORITATIVE" : "CONTAINER_LOCAL_NON_AUTHORITATIVE",
    evidenceAuthority: "CANDIDATE_LOCAL_OBSERVATION_ONLY",
    isolationMode: expectation.isolationMode,
    candidateInputMode: expectation.candidateInputMode,
    candidateIsolationExpectationSha256: validatedExpectation.candidateIsolationExpectationSha256,
    externalAttestorKeyId: null,
    externalAttestationSignature: null,
    limitations: LIMITATIONS.slice(),
    candidateReferenceIsolation: false,
  }, expectation);
}

module.exports = { LIMITATIONS, collectCandidateRuntimeAttestation, validateCandidateRuntimeAttestation };
