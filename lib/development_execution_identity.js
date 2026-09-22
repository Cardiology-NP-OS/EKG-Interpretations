"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { isBuiltin } = require("module");
const { payloadSha256, validateSha256, verifySignedPayload } = require("./evaluation_signatures");

const ROOT = path.resolve(__dirname, "..");
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const ENTRY_FILES = Object.freeze([
  "lib/signal_measurement_contract.js",
  "lib/pan_tompkins_detector.js",
  "lib/rpeak_development_metrics.js",
  "lib/development_run_comparison.js",
  "evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json",
  "evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json",
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, code) {
  const keys = Object.keys(value);
  requireCondition(keys.length === allowed.length && keys.every(key => allowed.includes(key)), code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalCandidatePayload(manifest) {
  const copy = { ...manifest };
  delete copy.manifestPayloadSha256;
  return copy;
}

function validateCandidateManifest(manifest) {
  requireCondition(plain(manifest), "DEVELOPMENT_CANDIDATE_MANIFEST");
  exactKeys(manifest, ["schema", "candidateId", "task", "createdAtUtc", "clinicalAccuracyClaimed", "runtimeAuthority", "artifacts", "executionIdentitySha256", "manifestPayloadSha256"], "DEVELOPMENT_CANDIDATE_MANIFEST_FIELDS");
  requireCondition(manifest.schema === "ekg-development-candidate-manifest-v1", "DEVELOPMENT_CANDIDATE_MANIFEST_SCHEMA");
  requireCondition(typeof manifest.candidateId === "string" && manifest.candidateId.length > 0, "DEVELOPMENT_CANDIDATE_ID");
  requireCondition(manifest.task === "R_PEAK_DETECTION", "DEVELOPMENT_CANDIDATE_TASK");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.createdAtUtc), "DEVELOPMENT_CANDIDATE_CREATED_AT");
  requireCondition(manifest.clinicalAccuracyClaimed === false, "DEVELOPMENT_CANDIDATE_CLINICAL_CLAIM");
  requireCondition(manifest.runtimeAuthority === false, "DEVELOPMENT_CANDIDATE_RUNTIME_AUTHORITY");
  requireCondition(Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0, "DEVELOPMENT_CANDIDATE_ARTIFACTS");
  const files = new Set();
  for (const artifact of manifest.artifacts) {
    requireCondition(plain(artifact), "DEVELOPMENT_CANDIDATE_ARTIFACT");
    exactKeys(artifact, ["file", "bytes", "sha256"], "DEVELOPMENT_CANDIDATE_ARTIFACT_FIELDS");
    requireCondition(typeof artifact.file === "string" && /^(lib|evaluation\/protocols)\/[A-Za-z0-9_.-]+\.(js|json)$/.test(artifact.file), "DEVELOPMENT_CANDIDATE_ARTIFACT_FILE");
    requireCondition(!files.has(artifact.file), "DEVELOPMENT_CANDIDATE_ARTIFACT_DUPLICATE");
    files.add(artifact.file);
    requireCondition(Number.isInteger(artifact.bytes) && artifact.bytes > 0 && artifact.bytes <= MAX_ARTIFACT_BYTES, "DEVELOPMENT_CANDIDATE_ARTIFACT_BYTES");
    validateSha256(artifact.sha256, "DEVELOPMENT_CANDIDATE_ARTIFACT_SHA256");
  }
  requireCondition(manifest.artifacts.every((row, index) => index === 0 || manifest.artifacts[index - 1].file < row.file), "DEVELOPMENT_CANDIDATE_ARTIFACT_ORDER");
  validateSha256(manifest.executionIdentitySha256, "DEVELOPMENT_CANDIDATE_EXECUTION_IDENTITY_SHA256");
  validateSha256(manifest.manifestPayloadSha256, "DEVELOPMENT_CANDIDATE_MANIFEST_SHA256");
  requireCondition(payloadSha256(canonicalCandidatePayload(manifest)) === manifest.manifestPayloadSha256, "DEVELOPMENT_CANDIDATE_MANIFEST_HASH_MISMATCH");
}

function validateSignerAuthority(manifest, signature, trustStore) {
  requireCondition(plain(signature), "DEVELOPMENT_CANDIDATE_SIGNATURE");
  exactKeys(signature, ["schema", "algorithm", "keyId", "payloadSha256", "signatureBase64"], "DEVELOPMENT_CANDIDATE_SIGNATURE_FIELDS");
  requireCondition(signature.schema === "ekg-detached-signature-v1", "DEVELOPMENT_CANDIDATE_SIGNATURE_SCHEMA");
  requireCondition(plain(trustStore), "DEVELOPMENT_CANDIDATE_TRUST_STORE");
  exactKeys(trustStore, ["schema", "keys"], "DEVELOPMENT_CANDIDATE_TRUST_STORE_FIELDS");
  requireCondition(trustStore.schema === "ekg-development-candidate-trust-store-v1" && Array.isArray(trustStore.keys) && trustStore.keys.length > 0, "DEVELOPMENT_CANDIDATE_TRUST_STORE_SCHEMA");
  const ids = new Set();
  for (const row of trustStore.keys) {
    requireCondition(plain(row), "DEVELOPMENT_CANDIDATE_TRUST_KEY");
    exactKeys(row, ["keyId", "algorithm", "status", "candidateAuthority", "productionAuthority", "allowedTasks", "purpose", "publicKeyPem"], "DEVELOPMENT_CANDIDATE_TRUST_KEY_FIELDS");
    requireCondition(typeof row.keyId === "string" && row.keyId.length > 0 && !ids.has(row.keyId), "DEVELOPMENT_CANDIDATE_TRUST_KEY_ID");
    ids.add(row.keyId);
    requireCondition(row.algorithm === "Ed25519" && ["TRUSTED", "REVOKED"].includes(row.status), "DEVELOPMENT_CANDIDATE_TRUST_KEY_STATUS");
    requireCondition(typeof row.candidateAuthority === "boolean" && typeof row.productionAuthority === "boolean", "DEVELOPMENT_CANDIDATE_TRUST_KEY_AUTHORITY");
    requireCondition(Array.isArray(row.allowedTasks) && row.allowedTasks.every(task => typeof task === "string" && task.length > 0), "DEVELOPMENT_CANDIDATE_TRUST_KEY_TASKS");
    requireCondition(typeof row.purpose === "string" && row.purpose.length > 0 && typeof row.publicKeyPem === "string" && row.publicKeyPem.length > 0, "DEVELOPMENT_CANDIDATE_TRUST_KEY_METADATA");
  }
  const key = trustStore.keys.find(row => row.keyId === signature.keyId);
  requireCondition(key && key.candidateAuthority === true, "DEVELOPMENT_CANDIDATE_SIGNER_AUTHORITY");
  requireCondition(key.allowedTasks.includes(manifest.task), "DEVELOPMENT_CANDIDATE_SIGNER_SCOPE");
}

function loadDevelopmentExecution(manifest, signature, trustStore, options = {}) {
  validateCandidateManifest(manifest);
  validateSignerAuthority(manifest, signature, trustStore);
  const signatureVerification = verifySignedPayload(canonicalCandidatePayload(manifest), signature, trustStore, { expectedPayloadSha256: manifest.manifestPayloadSha256 });
  const root = path.resolve(options.repositoryRoot || ROOT);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const modules = new Map();
  const verifiedArtifacts = new Map();
  let sealed = false;
  for (const artifact of manifest.artifacts) {
    const absolute = path.resolve(root, artifact.file);
    requireCondition(absolute.startsWith(prefix), "DEVELOPMENT_EXECUTION_DEPENDENCY_ESCAPE");
    for (let current = absolute; ; current = path.dirname(current)) {
      requireCondition(current === root || current.startsWith(prefix), "DEVELOPMENT_EXECUTION_DEPENDENCY_ESCAPE");
      requireCondition(!fs.lstatSync(current).isSymbolicLink(), "DEVELOPMENT_EXECUTION_ARTIFACT_SYMLINK");
      if (current === root) break;
    }
    const bytes = fs.readFileSync(absolute);
    requireCondition(bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256, "DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");
    const source = bytes.toString("utf8");
    requireCondition(Buffer.from(source, "utf8").equals(bytes), "DEVELOPMENT_EXECUTION_ARTIFACT_ENCODING");
    verifiedArtifacts.set(artifact.file, { identity: artifact, bytes, source });
  }

  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    requireCondition(!sealed, "DEVELOPMENT_EXECUTION_DEPENDENCY_UNDECLARED");
    requireCondition(/^(lib|evaluation\/protocols)\/[A-Za-z0-9_.-]+\.(js|json)$/.test(file), "DEVELOPMENT_EXECUTION_DEPENDENCY_UNSUPPORTED");
    const verified = verifiedArtifacts.get(file);
    requireCondition(verified, "DEVELOPMENT_EXECUTION_DEPENDENCY_UNDECLARED");
    const absolute = path.resolve(root, file);
    const loaded = { exports: {} };
    modules.set(file, loaded);
    if (file.endsWith(".json")) {
      loaded.exports = JSON.parse(verified.source);
    } else {
      const localRequire = request => {
        if (isBuiltin(request)) return require(request);
        requireCondition(request.startsWith("./") || request.startsWith("../"), "DEVELOPMENT_EXECUTION_DEPENDENCY_UNSUPPORTED");
        const resolved = path.resolve(path.dirname(absolute), request);
        const withExtension = path.extname(resolved) ? resolved : `${resolved}.js`;
        return load(path.relative(root, withExtension).split(path.sep).join("/"));
      };
      const execute = vm.compileFunction(verified.source, ["exports", "require", "module", "__filename", "__dirname"], { filename: absolute });
      execute(loaded.exports, localRequire, loaded, absolute, path.dirname(absolute));
    }
    return loaded.exports;
  }

  const signalMeasurement = load(ENTRY_FILES[0]);
  const panTompkins = load(ENTRY_FILES[1]);
  const metrics = load(ENTRY_FILES[2]);
  const comparison = load(ENTRY_FILES[3]);
  const protocol = load(ENTRY_FILES[4]);
  const regressionPolicy = load(ENTRY_FILES[5]);
  const artifactRows = [...modules.keys()].map(file => verifiedArtifacts.get(file).identity).sort((left, right) => left.file.localeCompare(right.file));
  const executionIdentity = {
    schema: "ekg-development-execution-identity-v1",
    task: manifest.task,
    candidateId: manifest.candidateId,
    loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES",
    entryFiles: ENTRY_FILES.slice(),
    artifacts: artifactRows,
  };
  requireCondition(JSON.stringify(manifest.artifacts) === JSON.stringify(artifactRows), "DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");
  requireCondition(payloadSha256(executionIdentity) === manifest.executionIdentitySha256, "DEVELOPMENT_CANDIDATE_EXECUTION_IDENTITY_MISMATCH");
  sealed = true;
  for (const artifact of artifactRows) {
    const bytes = fs.readFileSync(path.join(root, artifact.file));
    requireCondition(bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256, "DEVELOPMENT_EXECUTION_LOADED_BYTES_MISMATCH");
  }
  return Object.freeze({
    candidateId: manifest.candidateId,
    executionIdentity,
    executionIdentitySha256: manifest.executionIdentitySha256,
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    signatureVerification,
    detectCandidateRPeaks: signalMeasurement.detectCandidateRPeaks,
    detectPanTompkinsRPeaks: panTompkins.detectPanTompkinsRPeaks,
    panTompkinsAlgorithm: panTompkins.PAN_TOMPKINS_ALGORITHM,
    evaluateRPeakRecords: metrics.evaluateRPeakRecords,
    matcherAlgorithm: metrics.RPEAK_METRIC_VERSION && load("lib/event_matcher_v2.js").MATCHER_ALGORITHM,
    compareDevelopmentRuns: comparison.compareDevelopmentRuns,
    protocol,
    regressionPolicy,
  });
}

module.exports = { ENTRY_FILES, canonicalCandidatePayload, loadDevelopmentExecution, validateCandidateManifest, validateSignerAuthority };
