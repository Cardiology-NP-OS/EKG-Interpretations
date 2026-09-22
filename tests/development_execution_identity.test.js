"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { CANDIDATE_RUNTIME_ARTIFACT_FILES, ENTRY_FILES, canonicalCandidatePayload, deriveCandidateRuntimeIdentity, loadDevelopmentCandidateExecution, loadDevelopmentExecution, validateCandidateManifest, verifyDevelopmentExecutionPackage } = require("../lib/development_execution_identity");
const { payloadSha256, verifySignedPayload } = require("../lib/evaluation_signatures");
const { stableJson } = require("../lib/evaluation_runtime");
const ambientMeasurement = require("../lib/signal_measurement_contract");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.json");
const signaturePath = path.join(root, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.sig");
const trustStorePath = path.join(root, "evaluation", "keys", "DEVELOPMENT_CANDIDATE_SIGNERS.json");
const historicalManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const historicalSignature = JSON.parse(fs.readFileSync(signaturePath, "utf8"));
const historicalTrustStore = JSON.parse(fs.readFileSync(trustStorePath, "utf8"));
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex"), "b0f77474c5d5e74e80c5256d7b7d979a6fb1dcc39e0d0f8b9809251271c0a003");
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(signaturePath)).digest("hex"), "f0675306dc14c1d6ccf881e92ea6e895cfcfabb6a0990d9a6cb0d88af9e7d97b");
assert.equal(verifySignedPayload(canonicalCandidatePayload(historicalManifest), historicalSignature, historicalTrustStore, { expectedPayloadSha256: historicalManifest.manifestPayloadSha256 }).verified, true);
assert.throws(() => verifyDevelopmentExecutionPackage(historicalManifest, historicalSignature, historicalTrustStore, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH/);

const keys = crypto.generateKeyPairSync("ed25519");
const testTrust = {
  schema: "ekg-development-candidate-trust-store-v1",
  keys: [{
    keyId: "ephemeral-candidate-test",
    algorithm: "Ed25519",
    status: "TRUSTED",
    candidateAuthority: true,
    productionAuthority: false,
    allowedTasks: ["R_PEAK_DETECTION"],
    purpose: "Ephemeral synthetic candidate identity test only.",
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }),
  }],
};
function sign(value) {
  const candidate = JSON.parse(JSON.stringify(value));
  delete candidate.manifestPayloadSha256;
  candidate.manifestPayloadSha256 = payloadSha256(candidate);
  return {
    manifest: candidate,
    signature: {
      schema: "ekg-detached-signature-v1",
      algorithm: "Ed25519",
      keyId: "ephemeral-candidate-test",
      payloadSha256: candidate.manifestPayloadSha256,
      signatureBase64: crypto.sign(null, Buffer.from(stableJson(canonicalCandidatePayload(candidate)), "utf8"), keys.privateKey).toString("base64"),
    },
  };
}
const currentManifest = JSON.parse(JSON.stringify(historicalManifest));
currentManifest.candidateId = "synthetic-development-rpeak-execution-current";
currentManifest.artifacts = currentManifest.artifacts.map(artifact => {
  const bytes = fs.readFileSync(path.join(root, artifact.file));
  return { file: artifact.file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
});
currentManifest.executionIdentitySha256 = payloadSha256({ schema: "ekg-development-execution-identity-v1", task: currentManifest.task, candidateId: currentManifest.candidateId, loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES", entryFiles: ENTRY_FILES.slice(), artifacts: currentManifest.artifacts });
const signedCurrent = sign(currentManifest);
const manifest = signedCurrent.manifest;
const signature = signedCurrent.signature;
const trustStore = testTrust;
const verifiedPackage = verifyDevelopmentExecutionPackage(manifest, signature, trustStore, { repositoryRoot: root });
assert.equal(verifiedPackage.signatureVerification.verified, true);
assert.equal(verifiedPackage.executionIdentitySha256, manifest.executionIdentitySha256);
assert.throws(() => verifyDevelopmentExecutionPackage(manifest, signature, trustStore, { repositoryRoot: root, requireProductionAuthority: true }), /DEVELOPMENT_CANDIDATE_PRODUCTION_SIGNER_REQUIRED/);
const productionTrustStore = JSON.parse(JSON.stringify(trustStore));
productionTrustStore.keys[0].productionAuthority = true;
assert.equal(verifyDevelopmentExecutionPackage(manifest, signature, productionTrustStore, { repositoryRoot: root, requireProductionAuthority: true }).signatureVerification.verified, true);
const candidateRuntime = deriveCandidateRuntimeIdentity(verifiedPackage);
assert.equal(candidateRuntime.candidateRuntimeIdentity.artifacts.length, CANDIDATE_RUNTIME_ARTIFACT_FILES.length);
assert.deepEqual(candidateRuntime.candidateRuntimeIdentity.artifacts.map(row => row.file), CANDIDATE_RUNTIME_ARTIFACT_FILES);
const candidateRuntimeSchema = JSON.parse(fs.readFileSync(path.join(root, "evaluation", "schemas", "DEVELOPMENT_CANDIDATE_RUNTIME_IDENTITY_SCHEMA.json"), "utf8"));
assert.equal(candidateRuntimeSchema.$id, candidateRuntime.candidateRuntimeIdentity.schema);
assert.deepEqual(candidateRuntimeSchema.properties.entryFiles.const, candidateRuntime.candidateRuntimeIdentity.entryFiles);
assert.deepEqual(candidateRuntimeSchema.properties.artifacts.prefixItems.map(row => row.properties.file.const), CANDIDATE_RUNTIME_ARTIFACT_FILES);
assert.equal(candidateRuntimeSchema.properties.artifacts.items, false);
const loadedCandidate = loadDevelopmentCandidateExecution(manifest, signature, trustStore, { repositoryRoot: root, expectedCandidateRuntimeIdentitySha256: candidateRuntime.candidateRuntimeIdentitySha256 });
assert.equal(loadedCandidate.candidateRuntimeIdentitySha256, candidateRuntime.candidateRuntimeIdentitySha256);
assert.equal(typeof loadedCandidate.detectCandidateRPeaks, "function");
assert.equal(loadedCandidate.evaluateRPeakRecords, undefined);
assert.throws(() => loadDevelopmentCandidateExecution(manifest, signature, trustStore, { repositoryRoot: root, expectedCandidateRuntimeIdentitySha256: manifest.executionIdentitySha256 }), /DEVELOPMENT_CANDIDATE_RUNTIME_IDENTITY_MISMATCH/);
const candidateImageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-candidate-image-"));
try {
  const candidateDockerfile = fs.readFileSync(path.join(root, "evaluation", "candidate", "Dockerfile"), "utf8");
  const candidateImageSources = candidateDockerfile.split("\n").filter(line => line.startsWith("COPY ")).map(line => line.split(/\s+/)[1]);
  for (const file of candidateImageSources) {
    const target = path.join(candidateImageRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  assert.equal(fs.existsSync(path.join(candidateImageRoot, "lib", "rpeak_development_metrics.js")), false);
  assert.equal(loadDevelopmentCandidateExecution(manifest, signature, trustStore, { repositoryRoot: candidateImageRoot, expectedCandidateRuntimeIdentitySha256: candidateRuntime.candidateRuntimeIdentitySha256 }).candidateRuntimeIdentitySha256, candidateRuntime.candidateRuntimeIdentitySha256);
} finally {
  fs.rmSync(candidateImageRoot, { recursive: true, force: true });
}
const loaded = loadDevelopmentExecution(manifest, signature, trustStore, { repositoryRoot: root });
assert.equal(loaded.signatureVerification.verified, true);
assert.equal(loaded.executionIdentitySha256, manifest.executionIdentitySha256);
assert.equal(loaded.executionIdentity.artifacts.length, manifest.artifacts.length);
assert.notStrictEqual(loaded.detectCandidateRPeaks, ambientMeasurement.detectCandidateRPeaks);
assert.equal(loaded.protocol.clinicalAccuracyClaimed, false);
assert.equal(loaded.regressionPolicy.clinicalAccuracyClaimed, false);

const driftRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-identity-drift-"));
try {
  for (const artifact of manifest.artifacts) {
    const target = path.join(driftRoot, artifact.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.file), target);
  }
  const driftFile = path.join(driftRoot, "lib", "signal_measurement_contract.js");
  fs.appendFileSync(driftFile, "\nglobal.__developmentIdentitySideEffect = true;\n");
  delete global.__developmentIdentitySideEffect;
  assert.throws(() => loadDevelopmentExecution(manifest, signature, trustStore, { repositoryRoot: driftRoot }), /DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH/);
  assert.equal(global.__developmentIdentitySideEffect, undefined);
} finally {
  delete global.__developmentIdentitySideEffect;
  fs.rmSync(driftRoot, { recursive: true, force: true });
}

const omittedRuntimeArtifact = JSON.parse(JSON.stringify(manifest));
omittedRuntimeArtifact.artifacts = omittedRuntimeArtifact.artifacts.filter(row => row.file !== "lib/wfdb_signal.js");
omittedRuntimeArtifact.executionIdentitySha256 = payloadSha256({ ...verifiedPackage.executionIdentity, artifacts: omittedRuntimeArtifact.artifacts });
const signedOmittedRuntime = sign(omittedRuntimeArtifact);
assert.throws(() => loadDevelopmentCandidateExecution(signedOmittedRuntime.manifest, signedOmittedRuntime.signature, testTrust, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_RUNTIME_ARTIFACT_MISSING/);

const extraDependencyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-candidate-extra-"));
try {
  for (const artifact of manifest.artifacts) {
    const target = path.join(extraDependencyRoot, artifact.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.file), target);
  }
  const measurementFile = path.join(extraDependencyRoot, "lib", "signal_measurement_contract.js");
  fs.appendFileSync(measurementFile, "\nrequire('./event_matcher_v2');\n");
  const extraDependencyManifest = JSON.parse(JSON.stringify(manifest));
  const measurementBytes = fs.readFileSync(measurementFile);
  const measurementArtifact = extraDependencyManifest.artifacts.find(row => row.file === "lib/signal_measurement_contract.js");
  measurementArtifact.bytes = measurementBytes.length;
  measurementArtifact.sha256 = crypto.createHash("sha256").update(measurementBytes).digest("hex");
  extraDependencyManifest.executionIdentitySha256 = payloadSha256({ ...verifiedPackage.executionIdentity, artifacts: extraDependencyManifest.artifacts });
  const signedExtraDependency = sign(extraDependencyManifest);
  assert.throws(() => loadDevelopmentCandidateExecution(signedExtraDependency.manifest, signedExtraDependency.signature, testTrust, { repositoryRoot: extraDependencyRoot }), /DEVELOPMENT_CANDIDATE_RUNTIME_DEPENDENCY_UNDECLARED/);
} finally {
  fs.rmSync(extraDependencyRoot, { recursive: true, force: true });
}

const lazyCandidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-candidate-lazy-"));
try {
  for (const artifact of manifest.artifacts) {
    const target = path.join(lazyCandidateRoot, artifact.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.file), target);
  }
  const measurementFile = path.join(lazyCandidateRoot, "lib", "signal_measurement_contract.js");
  fs.appendFileSync(measurementFile, "\nconst originalCandidateDetector = module.exports.detectCandidateRPeaks; module.exports.detectCandidateRPeaks = (...args) => { require('./event_matcher_v2'); return originalCandidateDetector(...args); };\n");
  const lazyCandidateManifest = JSON.parse(JSON.stringify(manifest));
  const measurementBytes = fs.readFileSync(measurementFile);
  const measurementArtifact = lazyCandidateManifest.artifacts.find(row => row.file === "lib/signal_measurement_contract.js");
  measurementArtifact.bytes = measurementBytes.length;
  measurementArtifact.sha256 = crypto.createHash("sha256").update(measurementBytes).digest("hex");
  lazyCandidateManifest.executionIdentitySha256 = payloadSha256({ ...verifiedPackage.executionIdentity, artifacts: lazyCandidateManifest.artifacts });
  const signedLazyCandidate = sign(lazyCandidateManifest);
  const lazyCandidate = loadDevelopmentCandidateExecution(signedLazyCandidate.manifest, signedLazyCandidate.signature, testTrust, { repositoryRoot: lazyCandidateRoot });
  assert.throws(() => lazyCandidate.detectCandidateRPeaks([0, 1, 0], 250, {}), /DEVELOPMENT_CANDIDATE_RUNTIME_DEPENDENCY_UNDECLARED/);
} finally {
  fs.rmSync(lazyCandidateRoot, { recursive: true, force: true });
}

const ambientAccessRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-candidate-ambient-"));
try {
  for (const artifact of manifest.artifacts) {
    const target = path.join(ambientAccessRoot, artifact.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.file), target);
  }
  const measurementFile = path.join(ambientAccessRoot, "lib", "signal_measurement_contract.js");
  fs.appendFileSync(measurementFile, "\nconst ambientGuardedDetector = module.exports.detectCandidateRPeaks; module.exports.detectCandidateRPeaks = (...args) => { if (typeof process !== 'undefined' || typeof global !== 'undefined') throw new Error('AMBIENT_GLOBAL_EXPOSED'); let escaped = false; try { args.constructor.constructor('return process')(); escaped = true; } catch (_) {} try { require.constructor('return process')(); escaped = true; } catch (_) {} if (escaped) throw new Error('HOST_CONSTRUCTOR_EXPOSED'); let blocked = false; try { require('fs'); } catch (error) { blocked = /DEVELOPMENT_CANDIDATE_RUNTIME_DEPENDENCY_(UNSUPPORTED|UNDECLARED)/.test(String(error && error.message)); } if (!blocked) throw new Error('BUILTIN_MODULE_EXPOSED'); return ambientGuardedDetector(...args); };\n");
  const ambientAccessManifest = JSON.parse(JSON.stringify(manifest));
  const measurementBytes = fs.readFileSync(measurementFile);
  const measurementArtifact = ambientAccessManifest.artifacts.find(row => row.file === "lib/signal_measurement_contract.js");
  measurementArtifact.bytes = measurementBytes.length;
  measurementArtifact.sha256 = crypto.createHash("sha256").update(measurementBytes).digest("hex");
  ambientAccessManifest.executionIdentitySha256 = payloadSha256({ ...verifiedPackage.executionIdentity, artifacts: ambientAccessManifest.artifacts });
  const signedAmbientAccess = sign(ambientAccessManifest);
  const ambientAccessCandidate = loadDevelopmentCandidateExecution(signedAmbientAccess.manifest, signedAmbientAccess.signature, testTrust, { repositoryRoot: ambientAccessRoot });
  assert.ok(Array.isArray(ambientAccessCandidate.detectCandidateRPeaks([0, 1, 0], 250, { minAbsoluteDeviation: 0.1, refractoryMs: 200, provenance: { sourceKind: "signer_prepared_signal_only", locator: "record-000001" } }).events));
} finally {
  fs.rmSync(ambientAccessRoot, { recursive: true, force: true });
}

const nonExecutingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-identity-nonexecuting-"));
try {
  for (const artifact of manifest.artifacts) {
    const target = path.join(nonExecutingRoot, artifact.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.file), target);
  }
  const sideEffectFile = path.join(nonExecutingRoot, "lib", "signal_measurement_contract.js");
  fs.appendFileSync(sideEffectFile, "\nglobal.__nonExecutingVerificationSideEffect = true;\n");
  const nonExecutingManifest = JSON.parse(JSON.stringify(manifest));
  const sideEffectBytes = fs.readFileSync(sideEffectFile);
  const sideEffectArtifact = nonExecutingManifest.artifacts.find(row => row.file === "lib/signal_measurement_contract.js");
  sideEffectArtifact.bytes = sideEffectBytes.length;
  sideEffectArtifact.sha256 = crypto.createHash("sha256").update(sideEffectBytes).digest("hex");
  nonExecutingManifest.executionIdentitySha256 = payloadSha256({ ...verifiedPackage.executionIdentity, artifacts: nonExecutingManifest.artifacts });
  const signedNonExecuting = sign(nonExecutingManifest);
  delete global.__nonExecutingVerificationSideEffect;
  const verifiedNonExecuting = verifyDevelopmentExecutionPackage(signedNonExecuting.manifest, signedNonExecuting.signature, testTrust, { repositoryRoot: nonExecutingRoot });
  assert.equal(verifiedNonExecuting.signatureVerification.verified, true);
  assert.match(deriveCandidateRuntimeIdentity(verifiedNonExecuting).candidateRuntimeIdentitySha256, /^[0-9a-f]{64}$/);
  assert.equal(global.__nonExecutingVerificationSideEffect, undefined);
} finally {
  delete global.__nonExecutingVerificationSideEffect;
  fs.rmSync(nonExecutingRoot, { recursive: true, force: true });
}

const wrongHash = JSON.parse(JSON.stringify(manifest));
wrongHash.artifacts[0].sha256 = "0".repeat(64);
const signedWrongHash = sign(wrongHash);
assert.throws(() => loadDevelopmentExecution(signedWrongHash.manifest, signedWrongHash.signature, testTrust, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH/);

const missingArtifact = JSON.parse(JSON.stringify(manifest));
missingArtifact.artifacts.pop();
const signedMissing = sign(missingArtifact);
assert.throws(() => loadDevelopmentExecution(signedMissing.manifest, signedMissing.signature, testTrust, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_EXECUTION_IDENTITY_MISMATCH/);

const extraArtifact = JSON.parse(JSON.stringify(manifest));
const extraBytes = fs.readFileSync(path.join(root, "lib", "development_execution_identity.js"));
extraArtifact.artifacts.push({ file: "lib/development_execution_identity.js", bytes: extraBytes.length, sha256: crypto.createHash("sha256").update(extraBytes).digest("hex") });
extraArtifact.artifacts.sort((left, right) => left.file.localeCompare(right.file));
const signedExtra = sign(extraArtifact);
assert.throws(() => loadDevelopmentExecution(signedExtra.manifest, signedExtra.signature, testTrust, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_EXECUTION_IDENTITY_MISMATCH/);

const reordered = JSON.parse(JSON.stringify(manifest));
[reordered.artifacts[0], reordered.artifacts[1]] = [reordered.artifacts[1], reordered.artifacts[0]];
assert.throws(() => validateCandidateManifest(sign(reordered).manifest), /DEVELOPMENT_CANDIDATE_ARTIFACT_ORDER/);

const lazyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-identity-lazy-"));
try {
  for (const artifact of manifest.artifacts) {
    const target = path.join(lazyRoot, artifact.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, artifact.file), target);
  }
  const lazyFile = path.join(lazyRoot, "lib", "rpeak_development_metrics.js");
  fs.appendFileSync(lazyFile, "\nconst originalEvaluate = module.exports.evaluateRPeakRecords; module.exports.evaluateRPeakRecords = input => { require('./lazy_dependency'); return originalEvaluate(input); };\n");
  const lazyManifest = JSON.parse(JSON.stringify(manifest));
  const lazyBytes = fs.readFileSync(lazyFile);
  const lazyArtifact = lazyManifest.artifacts.find(row => row.file === "lib/rpeak_development_metrics.js");
  lazyArtifact.bytes = lazyBytes.length;
  lazyArtifact.sha256 = crypto.createHash("sha256").update(lazyBytes).digest("hex");
  lazyManifest.executionIdentitySha256 = payloadSha256({ ...loaded.executionIdentity, artifacts: lazyManifest.artifacts });
  const signedLazy = sign(lazyManifest);
  const lazyExecution = loadDevelopmentExecution(signedLazy.manifest, signedLazy.signature, testTrust, { repositoryRoot: lazyRoot });
  assert.throws(() => lazyExecution.evaluateRPeakRecords({}), /DEVELOPMENT_EXECUTION_DEPENDENCY_UNDECLARED/);
} finally {
  fs.rmSync(lazyRoot, { recursive: true, force: true });
}

const unauthorizedTrust = JSON.parse(JSON.stringify(testTrust));
unauthorizedTrust.keys[0].candidateAuthority = false;
assert.throws(() => loadDevelopmentExecution(manifest, signature, unauthorizedTrust, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_SIGNER_AUTHORITY|EVAL_SIGNATURE_UNKNOWN_KEY/);
const duplicateTrust = JSON.parse(JSON.stringify(trustStore));
duplicateTrust.keys.push(JSON.parse(JSON.stringify(duplicateTrust.keys[0])));
assert.throws(() => loadDevelopmentExecution(manifest, signature, duplicateTrust, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_TRUST_KEY_ID/);
assert.throws(() => loadDevelopmentExecution(manifest, { ...signature, extra: true }, trustStore, { repositoryRoot: root }), /DEVELOPMENT_CANDIDATE_SIGNATURE_FIELDS/);

console.log("development execution identity tests passed");
