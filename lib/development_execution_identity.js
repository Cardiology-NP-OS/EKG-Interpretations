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
const CANDIDATE_RUNTIME_ENTRY_FILES = Object.freeze([
  "lib/signal_measurement_contract.js",
  "lib/pan_tompkins_detector.js",
  "evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json",
]);
const CANDIDATE_RUNTIME_ARTIFACT_FILES = Object.freeze([
  "evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json",
  "lib/pan_tompkins_detector.js",
  "lib/signal_dsp_filtering.js",
  "lib/signal_measurement_contract.js",
  "lib/wfdb_signal.js",
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

function validateSignerAuthority(manifest, signature, trustStore, options = {}) {
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
  requireCondition(key && key.status === "TRUSTED" && key.candidateAuthority === true, "DEVELOPMENT_CANDIDATE_SIGNER_AUTHORITY");
  requireCondition(!options.requireProductionAuthority || key.productionAuthority === true, "DEVELOPMENT_CANDIDATE_PRODUCTION_SIGNER_REQUIRED");
  requireCondition(key.allowedTasks.includes(manifest.task), "DEVELOPMENT_CANDIDATE_SIGNER_SCOPE");
  return key;
}

function verifyDevelopmentExecutionPackage(manifest, signature, trustStore, options = {}) {
  validateCandidateManifest(manifest);
  validateSignerAuthority(manifest, signature, trustStore, options);
  const signatureVerification = verifySignedPayload(canonicalCandidatePayload(manifest), signature, trustStore, { expectedPayloadSha256: manifest.manifestPayloadSha256 });
  const root = path.resolve(options.repositoryRoot || ROOT);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const verifiedArtifacts = new Map();
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
  const executionIdentity = {
    schema: "ekg-development-execution-identity-v1",
    task: manifest.task,
    candidateId: manifest.candidateId,
    loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES",
    entryFiles: ENTRY_FILES.slice(),
    artifacts: manifest.artifacts.map(row => ({ ...row })),
  };
  requireCondition(payloadSha256(executionIdentity) === manifest.executionIdentitySha256, "DEVELOPMENT_CANDIDATE_EXECUTION_IDENTITY_MISMATCH");
  let protocol;
  let regressionPolicy;
  try {
    protocol = JSON.parse(verifiedArtifacts.get(ENTRY_FILES[4]).source);
    regressionPolicy = JSON.parse(verifiedArtifacts.get(ENTRY_FILES[5]).source);
  } catch (_) {
    throw new Error("DEVELOPMENT_EXECUTION_PROTOCOL_JSON");
  }
  return Object.freeze({
    candidateId: manifest.candidateId,
    executionIdentity,
    executionIdentitySha256: manifest.executionIdentitySha256,
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    signatureVerification,
    protocol,
    regressionPolicy,
    verifiedArtifacts,
  });
}

function verifyDevelopmentCandidateRuntimePackage(manifest, signature, trustStore, options = {}) {
  validateCandidateManifest(manifest);
  validateSignerAuthority(manifest, signature, trustStore, options);
  const signatureVerification = verifySignedPayload(canonicalCandidatePayload(manifest), signature, trustStore, { expectedPayloadSha256: manifest.manifestPayloadSha256 });
  const executionIdentity = {
    schema: "ekg-development-execution-identity-v1",
    task: manifest.task,
    candidateId: manifest.candidateId,
    loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES",
    entryFiles: ENTRY_FILES.slice(),
    artifacts: manifest.artifacts.map(row => ({ ...row })),
  };
  requireCondition(payloadSha256(executionIdentity) === manifest.executionIdentitySha256, "DEVELOPMENT_CANDIDATE_EXECUTION_IDENTITY_MISMATCH");
  const root = path.resolve(options.repositoryRoot || ROOT);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const declaredArtifacts = new Map(manifest.artifacts.map(artifact => [artifact.file, artifact]));
  const verifiedArtifacts = new Map();
  for (const file of CANDIDATE_RUNTIME_ARTIFACT_FILES) {
    const artifact = declaredArtifacts.get(file);
    requireCondition(artifact, "DEVELOPMENT_CANDIDATE_RUNTIME_ARTIFACT_MISSING");
    const absolute = path.resolve(root, file);
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
    verifiedArtifacts.set(file, { identity: artifact, bytes, source });
  }
  return Object.freeze({ candidateId: manifest.candidateId, executionIdentity, executionIdentitySha256: manifest.executionIdentitySha256, manifestPayloadSha256: manifest.manifestPayloadSha256, signatureVerification, verifiedArtifacts });
}

function deriveCandidateRuntimeIdentity(verifiedPackage) {
  requireCondition(verifiedPackage && verifiedPackage.verifiedArtifacts instanceof Map, "DEVELOPMENT_CANDIDATE_RUNTIME_PACKAGE");
  const artifacts = CANDIDATE_RUNTIME_ARTIFACT_FILES.map(file => {
    const artifact = verifiedPackage.verifiedArtifacts.get(file);
    requireCondition(artifact, "DEVELOPMENT_CANDIDATE_RUNTIME_ARTIFACT_MISSING");
    return { ...artifact.identity };
  });
  const identity = {
    schema: "ekg-development-candidate-runtime-identity-v1",
    task: "R_PEAK_DETECTION",
    candidateId: verifiedPackage.candidateId,
    loadingPolicy: "PRIVATE_COMMONJS_EXACT_DETECTOR_CLOSURE_V1",
    entryFiles: CANDIDATE_RUNTIME_ENTRY_FILES.slice(),
    artifacts,
  };
  return { candidateRuntimeIdentity: identity, candidateRuntimeIdentitySha256: payloadSha256(identity) };
}

function loadDevelopmentExecution(manifest, signature, trustStore, options = {}) {
  const verifiedPackage = verifyDevelopmentExecutionPackage(manifest, signature, trustStore, options);
  const root = path.resolve(options.repositoryRoot || ROOT);
  const modules = new Map();
  const verifiedArtifacts = verifiedPackage.verifiedArtifacts;
  let sealed = false;

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
  load("lib/event_matcher_v2.js");
  const artifactRows = [...modules.keys()].map(file => verifiedArtifacts.get(file).identity).sort((left, right) => left.file.localeCompare(right.file));
  requireCondition(JSON.stringify(manifest.artifacts) === JSON.stringify(artifactRows), "DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");
  sealed = true;
  for (const artifact of manifest.artifacts) {
    const bytes = fs.readFileSync(path.join(root, artifact.file));
    requireCondition(bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256, "DEVELOPMENT_EXECUTION_LOADED_BYTES_MISMATCH");
  }
  return Object.freeze({
    candidateId: manifest.candidateId,
    executionIdentity: verifiedPackage.executionIdentity,
    executionIdentitySha256: verifiedPackage.executionIdentitySha256,
    manifestPayloadSha256: verifiedPackage.manifestPayloadSha256,
    signatureVerification: verifiedPackage.signatureVerification,
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

function loadDevelopmentCandidateExecution(manifest, signature, trustStore, options = {}) {
  const verifiedPackage = verifyDevelopmentCandidateRuntimePackage(manifest, signature, trustStore, options);
  const runtime = deriveCandidateRuntimeIdentity(verifiedPackage);
  if (options.expectedCandidateRuntimeIdentitySha256 !== undefined) requireCondition(runtime.candidateRuntimeIdentitySha256 === options.expectedCandidateRuntimeIdentitySha256, "DEVELOPMENT_CANDIDATE_RUNTIME_IDENTITY_MISMATCH");
  const root = path.resolve(options.repositoryRoot || ROOT);
  const allowed = new Set(CANDIDATE_RUNTIME_ARTIFACT_FILES);
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  const bridge = vm.runInContext(`(() => {
    const modules = Object.create(null);
    const routes = Object.create(null);
    return Object.freeze({
      create(file) { modules[file] = { exports: {} }; routes[file] = Object.create(null); },
      route(file, request, target) { routes[file][request] = target; },
      requireFor(file) { return request => { if (typeof request !== "string" || !Object.prototype.hasOwnProperty.call(routes[file], request)) throw new Error("DEVELOPMENT_CANDIDATE_RUNTIME_DEPENDENCY_UNSUPPORTED"); const target = routes[file][request]; if (target === null) throw new Error("DEVELOPMENT_CANDIDATE_RUNTIME_DEPENDENCY_UNDECLARED"); return modules[target].exports; }; },
      module(file) { return modules[file]; },
      setJson(file, source) { modules[file].exports = JSON.parse(source); },
      invoke(file, name, input) { return JSON.stringify(Reflect.apply(modules[file].exports[name], undefined, JSON.parse(input))); },
      value(file, name) { return JSON.stringify(modules[file].exports[name]); }
    });
  })()`, context);
  const dependencies = new Map();
  const sourcePattern = /require\s*\(\s*(["'])([^"']+)\1\s*\)/g;
  for (const file of CANDIDATE_RUNTIME_ARTIFACT_FILES) {
    bridge.create(file);
    dependencies.set(file, []);
  }
  for (const file of CANDIDATE_RUNTIME_ARTIFACT_FILES) {
    if (file.endsWith(".json")) continue;
    const source = verifiedPackage.verifiedArtifacts.get(file).source;
    sourcePattern.lastIndex = 0;
    for (let match = sourcePattern.exec(source); match !== null; match = sourcePattern.exec(source)) {
      const request = match[2];
      if (!request.startsWith("./") && !request.startsWith("../")) continue;
      const resolved = path.resolve(root, path.dirname(file), request);
      const withExtension = path.extname(resolved) ? resolved : `${resolved}.js`;
      const target = path.relative(root, withExtension).split(path.sep).join("/");
      if (!allowed.has(target)) {
        bridge.route(file, request, null);
        continue;
      }
      bridge.route(file, request, target);
      dependencies.get(file).push(target);
    }
  }
  const states = new Map();
  function executeFile(file) {
    if (states.get(file) === "complete") return;
    if (states.get(file) === "executing") return;
    states.set(file, "executing");
    for (const dependency of dependencies.get(file)) executeFile(dependency);
    const verified = verifiedPackage.verifiedArtifacts.get(file);
    requireCondition(verified, "DEVELOPMENT_CANDIDATE_RUNTIME_ARTIFACT_MISSING");
    if (file.endsWith(".json")) bridge.setJson(file, verified.source);
    else {
      const absolute = path.resolve(root, file);
      const loaded = bridge.module(file);
      const execute = vm.compileFunction(verified.source, ["exports", "require", "module", "__filename", "__dirname"], { filename: absolute, parsingContext: context });
      execute(loaded.exports, bridge.requireFor(file), loaded, absolute, path.dirname(absolute));
    }
    states.set(file, "complete");
  }
  for (const file of CANDIDATE_RUNTIME_ARTIFACT_FILES) executeFile(file);
  requireCondition(states.size === CANDIDATE_RUNTIME_ARTIFACT_FILES.length && [...states.values()].every(state => state === "complete"), "DEVELOPMENT_CANDIDATE_RUNTIME_CLOSURE_MISMATCH");
  for (const artifact of runtime.candidateRuntimeIdentity.artifacts) {
    const bytes = fs.readFileSync(path.join(root, artifact.file));
    requireCondition(bytes.length === artifact.bytes && sha256(bytes) === artifact.sha256, "DEVELOPMENT_CANDIDATE_RUNTIME_LOADED_BYTES_MISMATCH");
  }
  const invoke = (file, name, args) => JSON.parse(bridge.invoke(file, name, JSON.stringify(args)));
  return Object.freeze({
    candidateId: manifest.candidateId,
    candidateRuntimeIdentity: runtime.candidateRuntimeIdentity,
    candidateRuntimeIdentitySha256: runtime.candidateRuntimeIdentitySha256,
    executionIdentity: verifiedPackage.executionIdentity,
    executionIdentitySha256: verifiedPackage.executionIdentitySha256,
    manifestPayloadSha256: verifiedPackage.manifestPayloadSha256,
    signatureVerification: verifiedPackage.signatureVerification,
    detectCandidateRPeaks: (...args) => invoke(CANDIDATE_RUNTIME_ENTRY_FILES[0], "detectCandidateRPeaks", args),
    detectPanTompkinsRPeaks: (...args) => invoke(CANDIDATE_RUNTIME_ENTRY_FILES[1], "detectPanTompkinsRPeaks", args),
    panTompkinsAlgorithm: JSON.parse(bridge.value(CANDIDATE_RUNTIME_ENTRY_FILES[1], "PAN_TOMPKINS_ALGORITHM")),
    protocol: JSON.parse(verifiedPackage.verifiedArtifacts.get(CANDIDATE_RUNTIME_ENTRY_FILES[2]).source),
  });
}

module.exports = { CANDIDATE_RUNTIME_ARTIFACT_FILES, CANDIDATE_RUNTIME_ENTRY_FILES, ENTRY_FILES, canonicalCandidatePayload, deriveCandidateRuntimeIdentity, loadDevelopmentCandidateExecution, loadDevelopmentExecution, validateCandidateManifest, validateSignerAuthority, verifyDevelopmentCandidateRuntimePackage, verifyDevelopmentExecutionPackage };
