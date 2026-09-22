"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { stableJson } = require("./evaluation_runtime");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fsyncFile(file) {
  const descriptor = fs.openSync(file, "r+");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function assertDirectoryChain(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "EVALUATION_STORE_DIRECTORY");
    if (current === path.dirname(current)) break;
  }
}

function safeArtifactName(name) {
  requireCondition(typeof name === "string" && /^[a-z0-9][a-z0-9.-]*\.json$/.test(name), "EVALUATION_ARTIFACT_NAME");
  return name;
}

function removeStage(stage) {
  if (!stage || !fs.existsSync(stage)) return;
  requireCondition(path.basename(stage).startsWith(".staging-"), "EVALUATION_STAGE_SCOPE");
  fs.rmSync(stage, { recursive: true, force: true });
}

function bundleDigest(files) {
  const ordered = Object.entries(files).sort(([left], [right]) => left.localeCompare(right));
  return sha256(Buffer.from(stableJson(ordered), "utf8"));
}

const REQUIRED_ARTIFACTS = Object.freeze([
  "bootstrap-and-paired-deltas.json",
  "candidate-digests.json",
  "development-report.json",
  "engineering-report.json",
  "gates.json",
  "input-and-rights-digests.json",
  "internal-result.restricted.json",
  "logs.json",
  "metric-distributions.json",
  "per-patient.restricted.json",
  "per-record.restricted.json",
  "predictions.restricted.json",
  "subgroup-metrics.json",
]);

function publishEvaluationBundle(root, input) {
  requireCondition(typeof root === "string" && root.length > 0, "EVALUATION_STORE_ROOT");
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "EVALUATION_BUNDLE_INPUT");
  requireCondition(input.storageMode === "APPLICATION_WRITE_ONCE_SIGNED", "EVALUATION_STORE_MODE");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.startedAtUtc), "EVALUATION_RUN_TIMESTAMP");
  requireCondition(input.runManifest && input.runManifest.clinicalAccuracyClaimed === false, "EVALUATION_RUN_CLAIM_BOUNDARY");
  requireCondition(input.artifacts && typeof input.artifacts === "object" && !Array.isArray(input.artifacts), "EVALUATION_ARTIFACTS_REQUIRED");
  requireCondition(typeof input.signingPrivateKeyPem === "string" && input.signingPrivateKeyPem.includes("PRIVATE KEY"), "EVALUATION_SIGNING_KEY_REQUIRED");
  requireCondition(typeof input.signerKeyId === "string" && input.signerKeyId.length > 0, "EVALUATION_SIGNER_KEY_ID");
  const rootDir = path.resolve(root);
  fs.mkdirSync(rootDir, { recursive: true });
  assertDirectoryChain(rootDir);
  requireCondition(REQUIRED_ARTIFACTS.every(name => Object.prototype.hasOwnProperty.call(input.artifacts, name)), "EVALUATION_ARTIFACT_REQUIRED");
  requireCondition(Object.keys(input.artifacts).every(name => REQUIRED_ARTIFACTS.includes(name)), "EVALUATION_ARTIFACT_UNDECLARED");
  requireCondition(typeof input.runManifest.runIdentityDigest === "string" && /^[0-9a-f]{64}$/.test(input.runManifest.runIdentityDigest), "EVALUATION_RUN_IDENTITY_DIGEST");
  const runId = `${input.startedAtUtc.replace(/[-:]/g, "")}_${input.runManifest.runIdentityDigest.slice(0, 16)}`;
  const signedRunManifest = { ...input.runManifest, runId, ...CLAIM_BOUNDARY };
  const bodies = {};
  for (const [rawName, value] of Object.entries(input.artifacts)) {
    const name = safeArtifactName(rawName);
    bodies[name] = Buffer.from(canonicalJson(value), "utf8");
  }
  bodies["run-manifest.json"] = Buffer.from(canonicalJson(signedRunManifest), "utf8");
  const hashes = Object.fromEntries(Object.entries(bodies).sort(([left], [right]) => left.localeCompare(right)).map(([name, bytes]) => [name, sha256(bytes)]));
  const merkleRootSha256 = bundleDigest(hashes);
  const runDigest = sha256(Buffer.from(stableJson({ runManifest: signedRunManifest, hashes, merkleRootSha256 }), "utf8"));
  const datePath = input.startedAtUtc.slice(0, 10).replace(/-/g, path.sep);
  const parent = path.join(rootDir, datePath);
  fs.mkdirSync(parent, { recursive: true });
  assertDirectoryChain(parent);
  const finalDir = path.join(parent, runId);
  requireCondition(!fs.existsSync(finalDir), "EVALUATION_BUNDLE_IMMUTABLE_COLLISION");
  const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
  try {
    for (const [name, bytes] of Object.entries(bodies)) {
      const file = path.join(stage, name);
      fs.writeFileSync(file, bytes, { flag: "wx" });
      fsyncFile(file);
    }
    const checksumBody = `${Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)).map(([name, hash]) => `${hash}  ${name}`).join("\n")}\n`;
    fs.writeFileSync(path.join(stage, "checksums.sha256"), checksumBody, { encoding: "ascii", flag: "wx" });
    fsyncFile(path.join(stage, "checksums.sha256"));
    const signature = crypto.sign(null, Buffer.from(merkleRootSha256, "ascii"), input.signingPrivateKeyPem).toString("base64");
    const signatureEnvelope = canonicalJson({ schema: "ekg-evaluation-bundle-signature-v1", algorithm: "Ed25519", signerKeyId: input.signerKeyId, merkleRootSha256, signatureBase64: signature });
    fs.writeFileSync(path.join(stage, "signature.json"), signatureEnvelope, { encoding: "utf8", flag: "wx" });
    fsyncFile(path.join(stage, "signature.json"));
    fsyncDirectory(stage);
    fs.renameSync(stage, finalDir);
    fsyncDirectory(parent);
  } catch (error) {
    removeStage(stage);
    throw error;
  }
  return { schema: "ekg-evaluation-bundle-receipt-v1", runId, path: finalDir, runDigest, merkleRootSha256, gateStatus: input.runManifest.state, writeOnce: false, applicationCollisionProtected: true, externalObjectLockAttested: false, storageMode: input.storageMode, ...CLAIM_BOUNDARY };
}

function verifyEvaluationBundle(bundlePath, publicKeyPem, options = {}) {
  const directory = path.resolve(bundlePath);
  assertDirectoryChain(directory);
  const checksumFile = path.join(directory, "checksums.sha256");
  const signatureFile = path.join(directory, "signature.json");
  const checksumStat = fs.lstatSync(checksumFile);
  const signatureStat = fs.lstatSync(signatureFile);
  requireCondition(checksumStat.isFile() && !checksumStat.isSymbolicLink() && signatureStat.isFile() && !signatureStat.isSymbolicLink(), "EVALUATION_BUNDLE_CONTROL_FILES");
  const rows = fs.readFileSync(checksumFile, "ascii").trim().split("\n");
  const hashes = {};
  for (const row of rows) {
    const match = /^([0-9a-f]{64})  ([a-z0-9][a-z0-9.-]*\.json)$/.exec(row.trim());
    requireCondition(match, "EVALUATION_BUNDLE_CHECKSUM_FORMAT");
    const file = path.join(directory, match[2]);
    const stat = fs.lstatSync(file);
    requireCondition(stat.isFile() && !stat.isSymbolicLink(), "EVALUATION_BUNDLE_ARTIFACT_FILE");
    requireCondition(sha256(fs.readFileSync(file)) === match[1], "EVALUATION_BUNDLE_ARTIFACT_HASH");
    hashes[match[2]] = match[1];
  }
  const expectedFiles = [...REQUIRED_ARTIFACTS, "run-manifest.json"].sort();
  requireCondition(JSON.stringify(Object.keys(hashes).sort()) === JSON.stringify(expectedFiles), "EVALUATION_BUNDLE_ARTIFACT_COVERAGE");
  const actualFiles = fs.readdirSync(directory).filter(name => !["checksums.sha256", "signature.json"].includes(name)).sort();
  requireCondition(JSON.stringify(actualFiles) === JSON.stringify(expectedFiles), "EVALUATION_BUNDLE_UNDECLARED_FILE");
  const signature = JSON.parse(fs.readFileSync(signatureFile, "utf8"));
  requireCondition(signature && typeof signature === "object" && !Array.isArray(signature), "EVALUATION_BUNDLE_SIGNATURE_ENVELOPE");
  requireCondition(signature.schema === "ekg-evaluation-bundle-signature-v1" && signature.algorithm === "Ed25519", "EVALUATION_BUNDLE_SIGNATURE_METADATA");
  requireCondition(typeof signature.signerKeyId === "string" && signature.signerKeyId.length > 0, "EVALUATION_BUNDLE_SIGNER_KEY_ID");
  requireCondition(options.expectedSignerKeyId === undefined || signature.signerKeyId === options.expectedSignerKeyId, "EVALUATION_BUNDLE_UNTRUSTED_SIGNER");
  requireCondition(typeof signature.signatureBase64 === "string" && signature.signatureBase64.length > 0, "EVALUATION_BUNDLE_SIGNATURE_VALUE");
  const merkleRootSha256 = bundleDigest(hashes);
  requireCondition(signature.merkleRootSha256 === merkleRootSha256, "EVALUATION_BUNDLE_MERKLE_ROOT");
  requireCondition(crypto.verify(null, Buffer.from(merkleRootSha256, "ascii"), publicKeyPem, Buffer.from(signature.signatureBase64, "base64")), "EVALUATION_BUNDLE_SIGNATURE");
  const runManifest = JSON.parse(fs.readFileSync(path.join(directory, "run-manifest.json"), "utf8"));
  requireCondition(runManifest.clinicalAccuracyClaimed === false && runManifest.capabilityNotClaim === true, "EVALUATION_BUNDLE_CLAIM_BOUNDARY");
  requireCondition(typeof runManifest.runId === "string" && path.basename(directory) === runManifest.runId, "EVALUATION_BUNDLE_RUN_ID");
  const runDigest = sha256(Buffer.from(stableJson({ runManifest, hashes, merkleRootSha256 }), "utf8"));
  return { schema: "ekg-evaluation-bundle-verification-v1", pass: true, runDigest, merkleRootSha256, signerKeyId: signature.signerKeyId, artifactCount: Object.keys(hashes).length, runManifest };
}

module.exports = { REQUIRED_ARTIFACTS, bundleDigest, publishEvaluationBundle, verifyEvaluationBundle };
