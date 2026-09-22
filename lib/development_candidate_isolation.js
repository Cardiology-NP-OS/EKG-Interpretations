"use strict";

const { payloadSha256 } = require("./evaluation_signatures");

const CANDIDATE_INPUT_MODE = "SIGNAL_ONLY_READ_ONLY_V1";
const CANDIDATE_ISOLATION_PENDING_STATE = "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION";
const CANDIDATE_CPU_LIMIT = 2;
const CANDIDATE_MEMORY_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const CANDIDATE_MEMORY_SWAP_LIMIT_BYTES = CANDIDATE_MEMORY_LIMIT_BYTES;
const CANDIDATE_WORKER_TIMEOUT_MS = 30000;
const CANDIDATE_TOTAL_WORKER_BUDGET_MS = 15 * 60 * 1000;
const CANDIDATE_LAUNCH_POLICY = Object.freeze({
  schema: "ekg-development-candidate-launch-policy-v1",
  runtimeImage: "CONFIGURED_DIGEST_REFERENCE_NOT_ATTESTED",
  network: "NONE",
  rootFilesystem: "READ_ONLY",
  user: "HOST_RUNNER_UID_GID",
  capabilities: "DROP_ALL",
  noNewPrivileges: true,
  pidsLimit: 256,
  cpuLimit: CANDIDATE_CPU_LIMIT,
  memoryLimitBytes: CANDIDATE_MEMORY_LIMIT_BYTES,
  memorySwapLimitBytes: CANDIDATE_MEMORY_SWAP_LIMIT_BYTES,
  candidateWorkerTimeoutMs: CANDIDATE_WORKER_TIMEOUT_MS,
  candidateTotalWorkerBudgetMs: CANDIDATE_TOTAL_WORKER_BUDGET_MS,
  mounts: Object.freeze([
    Object.freeze({ source: "MINIMAL_CANDIDATE_CONFIG", target: "/candidate-config/ekg-development-candidate.json", mode: "READ_ONLY" }),
    Object.freeze({ source: "SIGNAL_ONLY_EXECUTION_INPUT", target: "/execution-input", mode: "READ_ONLY" }),
    Object.freeze({ source: "EXECUTION_HANDOFF", target: "/handoff", mode: "WRITE_ONLY_PURPOSE" }),
    Object.freeze({ source: "CANDIDATE_MANIFEST", target: "/controls/candidate-manifest.json", mode: "READ_ONLY" }),
    Object.freeze({ source: "CANDIDATE_SIGNATURE", target: "/controls/candidate-manifest.sig.json", mode: "READ_ONLY" }),
    Object.freeze({ source: "CANDIDATE_TRUST_STORE", target: "/controls/candidate-trust-store.json", mode: "READ_ONLY" }),
  ]),
  forbiddenMounts: Object.freeze(["/workspace", "/candidate", "/governance", "/corpus", "/artifacts", "/runsecrets", "/runconfig"]),
});
const CANDIDATE_LAUNCH_POLICY_SHA256 = payloadSha256(CANDIDATE_LAUNCH_POLICY);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function deriveCandidateIsolationExpectation(config) {
  const synthetic = config.networkIsolation === "SYNTHETIC_TEST_PROCESS";
  requireCondition(synthetic || config.networkIsolation === "CONTAINER_NETWORK_NONE", "DEVELOPMENT_CANDIDATE_ISOLATION_MODE");
  const candidateRuntimeImageDigest = synthetic ? null : config.environmentImageDigest;
  const expectedUid = synthetic ? null : config.candidateExpectedUid;
  const expectedGid = synthetic ? null : config.candidateExpectedGid;
  requireCondition(candidateRuntimeImageDigest === null || /^[0-9a-f]{64}$/.test(candidateRuntimeImageDigest), "DEVELOPMENT_CANDIDATE_IMAGE_DIGEST");
  if (!synthetic) {
    requireCondition(typeof candidateRuntimeImageDigest === "string", "DEVELOPMENT_CANDIDATE_IMAGE_DIGEST_REQUIRED");
    requireCondition(Number.isSafeInteger(expectedUid) && expectedUid >= 0, "DEVELOPMENT_CANDIDATE_EXPECTED_UID");
    requireCondition(Number.isSafeInteger(expectedGid) && expectedGid >= 0, "DEVELOPMENT_CANDIDATE_EXPECTED_GID");
  }
  const expectation = {
    schema: "ekg-development-candidate-isolation-expectation-v1",
    attestationState: CANDIDATE_ISOLATION_PENDING_STATE,
    isolationMode: synthetic ? "SYNTHETIC_IN_PROCESS" : "PINNED_SIGNAL_ONLY_CONTAINER",
    candidateInputMode: CANDIDATE_INPUT_MODE,
    candidateRuntimeImageDigest,
    candidateLaunchPolicySha256: CANDIDATE_LAUNCH_POLICY_SHA256,
    expectedUid,
    expectedGid,
  };
  return { expectation, candidateIsolationExpectationSha256: payloadSha256(expectation) };
}

function validateCandidateIsolationExpectation(expectation, expectedDigest) {
  requireCondition(plain(expectation), "DEVELOPMENT_CANDIDATE_ISOLATION_EXPECTATION");
  const expected = ["schema", "attestationState", "isolationMode", "candidateInputMode", "candidateRuntimeImageDigest", "candidateLaunchPolicySha256", "expectedUid", "expectedGid"].sort();
  requireCondition(JSON.stringify(Object.keys(expectation).sort()) === JSON.stringify(expected), "DEVELOPMENT_CANDIDATE_ISOLATION_EXPECTATION_FIELDS");
  requireCondition(expectation.schema === "ekg-development-candidate-isolation-expectation-v1", "DEVELOPMENT_CANDIDATE_ISOLATION_EXPECTATION_SCHEMA");
  requireCondition(expectation.attestationState === CANDIDATE_ISOLATION_PENDING_STATE, "DEVELOPMENT_CANDIDATE_ISOLATION_PRELAUNCH_STATE");
  requireCondition(expectation.candidateInputMode === CANDIDATE_INPUT_MODE, "DEVELOPMENT_CANDIDATE_INPUT_MODE");
  requireCondition(expectation.candidateLaunchPolicySha256 === CANDIDATE_LAUNCH_POLICY_SHA256, "DEVELOPMENT_CANDIDATE_LAUNCH_POLICY");
  if (expectation.isolationMode === "SYNTHETIC_IN_PROCESS") {
    requireCondition(expectation.candidateRuntimeImageDigest === null && expectation.expectedUid === null && expectation.expectedGid === null, "DEVELOPMENT_CANDIDATE_SYNTHETIC_EXPECTATION");
  } else {
    requireCondition(expectation.isolationMode === "PINNED_SIGNAL_ONLY_CONTAINER", "DEVELOPMENT_CANDIDATE_ISOLATION_MODE");
    requireCondition(/^[0-9a-f]{64}$/.test(expectation.candidateRuntimeImageDigest), "DEVELOPMENT_CANDIDATE_IMAGE_DIGEST_REQUIRED");
    requireCondition(Number.isSafeInteger(expectation.expectedUid) && expectation.expectedUid >= 0, "DEVELOPMENT_CANDIDATE_EXPECTED_UID");
    requireCondition(Number.isSafeInteger(expectation.expectedGid) && expectation.expectedGid >= 0, "DEVELOPMENT_CANDIDATE_EXPECTED_GID");
  }
  const digest = payloadSha256(expectation);
  if (expectedDigest !== undefined) requireCondition(digest === expectedDigest, "DEVELOPMENT_CANDIDATE_ISOLATION_EXPECTATION_DIGEST");
  return { expectation, candidateIsolationExpectationSha256: digest };
}

module.exports = { CANDIDATE_CPU_LIMIT, CANDIDATE_INPUT_MODE, CANDIDATE_ISOLATION_PENDING_STATE, CANDIDATE_LAUNCH_POLICY, CANDIDATE_LAUNCH_POLICY_SHA256, CANDIDATE_MEMORY_LIMIT_BYTES, CANDIDATE_MEMORY_SWAP_LIMIT_BYTES, CANDIDATE_TOTAL_WORKER_BUDGET_MS, CANDIDATE_WORKER_TIMEOUT_MS, deriveCandidateIsolationExpectation, validateCandidateIsolationExpectation };
