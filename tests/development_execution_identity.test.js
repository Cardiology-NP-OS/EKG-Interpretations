"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { canonicalCandidatePayload, loadDevelopmentExecution, validateCandidateManifest, verifyDevelopmentExecutionPackage } = require("../lib/development_execution_identity");
const { payloadSha256 } = require("../lib/evaluation_signatures");
const ambientMeasurement = require("../lib/signal_measurement_contract");

const root = path.join(__dirname, "..");
const manifestPath = path.join(root, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.json");
const signaturePath = path.join(root, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.sig");
const trustStorePath = path.join(root, "evaluation", "keys", "DEVELOPMENT_CANDIDATE_SIGNERS.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const signature = JSON.parse(fs.readFileSync(signaturePath, "utf8"));
const trustStore = JSON.parse(fs.readFileSync(trustStorePath, "utf8"));

const verifiedPackage = verifyDevelopmentExecutionPackage(manifest, signature, trustStore, { repositoryRoot: root });
assert.equal(verifiedPackage.signatureVerification.verified, true);
assert.equal(verifiedPackage.executionIdentitySha256, manifest.executionIdentitySha256);
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
      signatureBase64: crypto.sign(null, Buffer.from(require("../lib/evaluation_runtime").stableJson(canonicalCandidatePayload(candidate)), "utf8"), keys.privateKey).toString("base64"),
    },
  };
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
