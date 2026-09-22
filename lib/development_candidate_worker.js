"use strict";

const fs = require("fs");
const { DEVELOPMENT_CONTROL_RESOURCE_LIMITS, createDevelopmentControlBudget, readDevelopmentControlJson } = require("./development_control_snapshot");
const { loadDevelopmentCandidateExecution } = require("./development_execution_identity");
const { normalizeFailureCode } = require("./development_run_accounting");

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

class ControlIngressError extends Error {}

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, code) {
  requireCondition(plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.slice().sort()), code);
}

function readBoundedStdin() {
  const chunks = [];
  let totalBytes = 0;
  for (;;) {
    const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_REQUEST_BYTES + 1 - totalBytes));
    const count = fs.readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    totalBytes += count;
    requireCondition(totalBytes <= MAX_REQUEST_BYTES, "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_SIZE");
    chunks.push(Buffer.from(chunk.subarray(0, count)));
  }
  requireCondition(totalBytes > 0, "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_SIZE");
  return Buffer.concat(chunks, totalBytes);
}

function validateRequest(request) {
  exactKeys(request, ["schema", "requestId", "detector", "samples", "sampleRateHz", "configuration", "provenance"], "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_FIELDS");
  requireCondition(request.schema === "ekg-development-candidate-prediction-request-v2", "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_SCHEMA");
  requireCondition(typeof request.requestId === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(request.requestId), "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_ID");
  requireCondition(["CURRENT_ENGINE", "PAN_TOMPKINS"].includes(request.detector), "DEVELOPMENT_CANDIDATE_WORKER_DETECTOR");
  requireCondition(Array.isArray(request.samples) && request.samples.length >= 3 && request.samples.length <= 10000000 && request.samples.every(value => typeof value === "number" && Number.isFinite(value)), "DEVELOPMENT_CANDIDATE_WORKER_SAMPLES");
  requireCondition(Number.isInteger(request.sampleRateHz) && request.sampleRateHz > 0 && request.sampleRateHz <= 100000, "DEVELOPMENT_CANDIDATE_WORKER_SAMPLE_RATE");
  exactKeys(request.configuration, ["minAbsoluteDeviation", "refractoryMs"], "DEVELOPMENT_CANDIDATE_WORKER_CONFIGURATION");
  requireCondition(Object.values(request.configuration).every(value => typeof value === "number" && Number.isFinite(value)), "DEVELOPMENT_CANDIDATE_WORKER_CONFIGURATION_VALUE");
  exactKeys(request.provenance, ["sourceKind", "locator"], "DEVELOPMENT_CANDIDATE_WORKER_PROVENANCE");
  requireCondition(request.provenance.sourceKind === "signer_prepared_signal_only" && request.provenance.locator === request.requestId.split(":")[0], "DEVELOPMENT_CANDIDATE_WORKER_PROVENANCE_VALUE");
  return request;
}

function execute(request, execution) {
  const started = process.hrtime.bigint();
  try {
    const detector = request.detector === "CURRENT_ENGINE" ? execution.detectCandidateRPeaks : execution.detectPanTompkinsRPeaks;
    const options = request.detector === "CURRENT_ENGINE" ? { ...request.configuration, provenance: request.provenance } : { provenance: request.provenance };
    const output = detector(request.samples, request.sampleRateHz, options);
    requireCondition(output !== null && typeof output === "object" && !Array.isArray(output) && typeof output.algorithm === "string" && output.algorithm.length > 0 && output.algorithm.length <= 256 && Array.isArray(output.events), "DEVELOPMENT_CANDIDATE_WORKER_OUTPUT");
    const predictedSampleIndices = output.events.map(event => {
      requireCondition(event !== null && typeof event === "object" && !Array.isArray(event) && Number.isInteger(event.sampleIndex) && event.sampleIndex >= 0 && event.sampleIndex < request.samples.length, "DEVELOPMENT_CANDIDATE_WORKER_PREDICTION");
      return event.sampleIndex;
    });
    requireCondition(predictedSampleIndices.every((value, index) => index === 0 || value > predictedSampleIndices[index - 1]), "DEVELOPMENT_CANDIDATE_WORKER_PREDICTION_ORDER");
    return { schema: "ekg-development-candidate-prediction-response-v1", requestId: request.requestId, status: "SUCCESS", failureCode: null, predictedSampleIndices, algorithm: output.algorithm, latencyMs: Number(process.hrtime.bigint() - started) / 1e6, peakMemoryBytes: process.memoryUsage().rss };
  } catch (error) {
    return { schema: "ekg-development-candidate-prediction-response-v1", requestId: request.requestId, status: "TECHNICAL_FAILURE", failureCode: normalizeFailureCode(error, "DEVELOPMENT_CANDIDATE_DETECTOR_FAILURE"), predictedSampleIndices: [], algorithm: null, latencyMs: Number(process.hrtime.bigint() - started) / 1e6, peakMemoryBytes: process.memoryUsage().rss };
  }
}

function main(args) {
  requireCondition(args.length === 9, "DEVELOPMENT_CANDIDATE_WORKER_USAGE");
  const [candidateRoot, manifestPath, signaturePath, trustStorePath, expectedTrustStoreSha256, expectedManifestSha256, expectedSignatureSha256, expectedRuntimeIdentitySha256, requireProductionAuthority] = args;
  requireCondition([expectedTrustStoreSha256, expectedManifestSha256, expectedSignatureSha256, expectedRuntimeIdentitySha256].every(value => /^[0-9a-f]{64}$/.test(value)), "DEVELOPMENT_CANDIDATE_WORKER_IDENTITY");
  requireCondition(["true", "false"].includes(requireProductionAuthority), "DEVELOPMENT_CANDIDATE_WORKER_AUTHORITY_MODE");
  const requestBytes = readBoundedStdin();
  let request;
  try { request = JSON.parse(requestBytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_CANDIDATE_WORKER_REQUEST_JSON"); }
  validateRequest(request);
  const budget = createDevelopmentControlBudget();
  let manifest;
  let signature;
  let trustStore;
  try {
    manifest = readDevelopmentControlJson(manifestPath, DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxManifestBytes, budget, "DEVELOPMENT_CANDIDATE_MANIFEST_JSON", expectedManifestSha256).value;
    signature = readDevelopmentControlJson(signaturePath, DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxSignatureBytes, budget, "DEVELOPMENT_CANDIDATE_SIGNATURE_JSON", expectedSignatureSha256).value;
    trustStore = readDevelopmentControlJson(trustStorePath, DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTrustStoreBytes, budget, "DEVELOPMENT_CANDIDATE_TRUST_JSON", expectedTrustStoreSha256).value;
  } catch (error) {
    throw new ControlIngressError(normalizeFailureCode(error, "DEVELOPMENT_CANDIDATE_CONTROL_INGRESS"));
  }
  const execution = loadDevelopmentCandidateExecution(manifest, signature, trustStore, { repositoryRoot: candidateRoot, expectedCandidateRuntimeIdentitySha256: expectedRuntimeIdentitySha256, requireProductionAuthority: requireProductionAuthority === "true" });
  process.stdout.write(`${JSON.stringify(execute(request, execution))}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const failureCode = normalizeFailureCode(error, "DEVELOPMENT_CANDIDATE_WORKER_FAILURE");
  process.stderr.write(`${error instanceof ControlIngressError ? "DEVELOPMENT_CANDIDATE_WORKER_CONTROL_FAILURE:" : ""}${failureCode}\n`);
  process.exitCode = 1;
}
