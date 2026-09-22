"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadDevelopmentCandidateExecution } = require("./development_execution_identity");
const { normalizeFailureCode } = require("./development_run_accounting");

const MAX_REQUEST_BYTES = 64 * 1024 * 1024;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, code) {
  requireCondition(plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.slice().sort()), code);
}

function readJson(file, code) {
  let value;
  try { value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); } catch (_) { throw new Error(code); }
  requireCondition(plain(value), code);
  return value;
}

function readTrustStore(file, expectedSha256) {
  const bytes = fs.readFileSync(path.resolve(file));
  requireCondition(crypto.createHash("sha256").update(bytes).digest("hex") === expectedSha256, "DEVELOPMENT_CANDIDATE_TRUST_JSON_HASH");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_CANDIDATE_TRUST_JSON"); }
  requireCondition(plain(value), "DEVELOPMENT_CANDIDATE_TRUST_JSON");
  return value;
}

function validateRequest(request) {
  exactKeys(request, ["schema", "requestId", "samples", "sampleRateHz", "configuration", "provenance"], "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_FIELDS");
  requireCondition(request.schema === "ekg-development-candidate-prediction-request-v1", "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_SCHEMA");
  requireCondition(typeof request.requestId === "string" && /^[A-Za-z0-9._:-]{1,256}$/.test(request.requestId), "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_ID");
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
    const output = execution.detectCandidateRPeaks(request.samples, request.sampleRateHz, { ...request.configuration, provenance: request.provenance });
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
  requireCondition(args.length === 7, "DEVELOPMENT_CANDIDATE_WORKER_USAGE");
  const [candidateRoot, manifestPath, signaturePath, trustStorePath, expectedTrustStoreSha256, expectedRuntimeIdentitySha256, requireProductionAuthority] = args;
  requireCondition(/^[0-9a-f]{64}$/.test(expectedTrustStoreSha256) && /^[0-9a-f]{64}$/.test(expectedRuntimeIdentitySha256), "DEVELOPMENT_CANDIDATE_WORKER_IDENTITY");
  requireCondition(["true", "false"].includes(requireProductionAuthority), "DEVELOPMENT_CANDIDATE_WORKER_AUTHORITY_MODE");
  const requestBytes = fs.readFileSync(0);
  requireCondition(requestBytes.length > 0 && requestBytes.length <= MAX_REQUEST_BYTES, "DEVELOPMENT_CANDIDATE_WORKER_REQUEST_SIZE");
  let request;
  try { request = JSON.parse(requestBytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_CANDIDATE_WORKER_REQUEST_JSON"); }
  validateRequest(request);
  const manifest = readJson(manifestPath, "DEVELOPMENT_CANDIDATE_MANIFEST_JSON");
  const signature = readJson(signaturePath, "DEVELOPMENT_CANDIDATE_SIGNATURE_JSON");
  const trustStore = readTrustStore(trustStorePath, expectedTrustStoreSha256);
  const execution = loadDevelopmentCandidateExecution(manifest, signature, trustStore, { repositoryRoot: candidateRoot, expectedCandidateRuntimeIdentitySha256: expectedRuntimeIdentitySha256, requireProductionAuthority: requireProductionAuthority === "true" });
  process.stdout.write(`${JSON.stringify(execute(request, execution))}\n`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${normalizeFailureCode(error, "DEVELOPMENT_CANDIDATE_WORKER_FAILURE")}\n`);
  process.exitCode = 1;
}
