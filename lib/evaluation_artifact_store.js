"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { stableJson } = require("./evaluation_runtime");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function quotedJsonByteLength(value) {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) bytes += 2;
    else if (code < 0x20) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else if (code >= 0xd800 && code <= 0xdfff) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

function snapshotCanonicalJson(value, maxBytes) {
  let measuredBytes = 0;
  const ancestors = new Set();
  const consume = bytes => {
    requireCondition(Number.isSafeInteger(bytes) && bytes >= 0 && measuredBytes <= maxBytes - bytes, "EVALUATION_BUNDLE_FILE_SIZE");
    measuredBytes += bytes;
  };
  const visit = (current, depth) => {
    requireCondition(depth <= 100, "EVALUATION_BUNDLE_JSON_DEPTH");
    if (current === null) {
      consume(4);
      return null;
    }
    if (typeof current === "string") {
      consume(quotedJsonByteLength(current));
      return current;
    }
    if (typeof current === "boolean") {
      consume(current ? 4 : 5);
      return current;
    }
    if (typeof current === "number") {
      requireCondition(Number.isFinite(current), "EVALUATION_BUNDLE_JSON_VALUE");
      const normalized = Object.is(current, -0) ? 0 : current;
      consume(Buffer.byteLength(String(normalized), "utf8"));
      return normalized;
    }
    requireCondition(current && typeof current === "object" && (Array.isArray(current) || Object.getPrototypeOf(current) === Object.prototype), "EVALUATION_BUNDLE_JSON_VALUE");
    requireCondition(!ancestors.has(current), "EVALUATION_BUNDLE_JSON_VALUE");
    ancestors.add(current);
    let snapshot;
    if (Array.isArray(current)) {
      if (current.length === 0) {
        consume(2);
        snapshot = [];
      } else {
        consume(2);
        snapshot = [];
        for (let index = 0; index < current.length; index += 1) {
          consume((depth + 1) * 2);
          snapshot.push(visit(current[index], depth + 1));
          consume(index + 1 === current.length ? 1 : 2);
        }
        consume(depth * 2 + 1);
      }
    } else {
      const keys = Object.keys(current);
      requireCondition(Reflect.ownKeys(current).every(key => typeof key === "string" && Object.prototype.propertyIsEnumerable.call(current, key)), "EVALUATION_BUNDLE_JSON_VALUE");
      if (keys.length === 0) {
        consume(2);
        snapshot = {};
      } else {
        consume(2);
        snapshot = {};
        for (let index = 0; index < keys.length; index += 1) {
          const key = keys[index];
          consume((depth + 1) * 2 + quotedJsonByteLength(key) + 2);
          snapshot[key] = visit(current[key], depth + 1);
          consume(index + 1 === keys.length ? 1 : 2);
        }
        consume(depth * 2 + 1);
      }
    }
    ancestors.delete(current);
    return snapshot;
  };
  const snapshot = visit(value, 0);
  consume(1);
  return { snapshot, measuredBytes };
}

function canonicalSnapshotBytes(measured, maxBytes) {
  const serialized = JSON.stringify(measured.snapshot, null, 2);
  requireCondition(typeof serialized === "string", "EVALUATION_BUNDLE_JSON_VALUE");
  const bytes = Buffer.from(`${serialized}\n`, "utf8");
  requireCondition(bytes.length === measured.measuredBytes && bytes.length <= maxBytes, "EVALUATION_BUNDLE_FILE_SIZE");
  return bytes;
}

function canonicalJsonBytes(value, maxBytes) {
  return canonicalSnapshotBytes(snapshotCanonicalJson(value, maxBytes), maxBytes);
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

const BUNDLE_RESOURCE_LIMITS = Object.freeze({
  maxChecksumBytes: 64 * 1024,
  maxSignatureBytes: 64 * 1024,
  maxRunManifestBytes: 4 * 1024 * 1024,
  maxArtifactBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
});

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
}

function resolveResourceLimits(value) {
  if (value === undefined) return BUNDLE_RESOURCE_LIMITS;
  requireCondition(value && typeof value === "object" && !Array.isArray(value), "EVALUATION_BUNDLE_RESOURCE_LIMITS");
  const expected = Object.keys(BUNDLE_RESOURCE_LIMITS).sort();
  requireCondition(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected), "EVALUATION_BUNDLE_RESOURCE_LIMITS");
  const resolved = {};
  for (const name of expected) {
    const limit = value[name];
    requireCondition(Number.isSafeInteger(limit) && limit > 0 && limit <= BUNDLE_RESOURCE_LIMITS[name], "EVALUATION_BUNDLE_RESOURCE_LIMITS");
    resolved[name] = limit;
  }
  return Object.freeze(resolved);
}

function createByteBudget(maxBytes) {
  requireCondition(Number.isSafeInteger(maxBytes) && maxBytes > 0, "EVALUATION_BUNDLE_RESOURCE_LIMITS");
  return { maxBytes, totalBytes: 0 };
}

function reserveBytes(budget, bytes) {
  requireCondition(Number.isSafeInteger(bytes) && bytes >= 0, "EVALUATION_BUNDLE_FILE_SIZE");
  requireCondition(budget.totalBytes <= budget.maxBytes - bytes, "EVALUATION_BUNDLE_TOTAL_SIZE");
  budget.totalBytes += bytes;
}

function readFileSnapshot(file, maxBytes, budget, fileCode) {
  let descriptor = null;
  try {
    const before = fs.lstatSync(file, { bigint: true });
    requireCondition(before.isFile() && !before.isSymbolicLink(), fileCode);
    requireCondition(before.size > 0n && before.size <= BigInt(maxBytes), "EVALUATION_BUNDLE_FILE_SIZE");
    reserveBytes(budget, Number(before.size));
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(opened.isFile() && statIdentity(before) === statIdentity(opened), "EVALUATION_BUNDLE_READ_RACE");
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    requireCondition(statIdentity(opened) === statIdentity(after) && statIdentity(opened) === statIdentity(current) && offset === Number(opened.size), "EVALUATION_BUNDLE_READ_RACE");
    return { bytes: bytes.subarray(0, offset), identity: statIdentity(opened) };
  } catch (error) {
    if (error && /^EVALUATION_BUNDLE_/.test(error.message)) throw error;
    throw new Error(fileCode);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
  }
}

function readBoundedInventory(directory, maximumEntries) {
  const names = [];
  const handle = fs.opendirSync(directory);
  try {
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      requireCondition(names.length < maximumEntries, "EVALUATION_BUNDLE_UNDECLARED_FILE");
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return names.sort();
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
  const publication = {
    storageMode: input.storageMode,
    startedAtUtc: input.startedAtUtc,
    runManifest: input.runManifest,
    artifacts: input.artifacts,
    signingPrivateKeyPem: input.signingPrivateKeyPem,
    signerKeyId: input.signerKeyId,
  };
  requireCondition(publication.storageMode === "APPLICATION_WRITE_ONCE_SIGNED", "EVALUATION_STORE_MODE");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(publication.startedAtUtc), "EVALUATION_RUN_TIMESTAMP");
  const inputRunManifest = snapshotCanonicalJson(publication.runManifest, BUNDLE_RESOURCE_LIMITS.maxRunManifestBytes).snapshot;
  requireCondition(inputRunManifest && !Array.isArray(inputRunManifest) && inputRunManifest.clinicalAccuracyClaimed === false, "EVALUATION_RUN_CLAIM_BOUNDARY");
  requireCondition(publication.artifacts && typeof publication.artifacts === "object" && !Array.isArray(publication.artifacts), "EVALUATION_ARTIFACTS_REQUIRED");
  requireCondition(typeof publication.signingPrivateKeyPem === "string" && publication.signingPrivateKeyPem.includes("PRIVATE KEY"), "EVALUATION_SIGNING_KEY_REQUIRED");
  requireCondition(typeof publication.signerKeyId === "string" && publication.signerKeyId.length > 0, "EVALUATION_SIGNER_KEY_ID");
  const artifactNames = Reflect.ownKeys(publication.artifacts);
  const artifactValues = {};
  for (const name of artifactNames) {
    const descriptor = typeof name === "string" ? Object.getOwnPropertyDescriptor(publication.artifacts, name) : null;
    requireCondition(descriptor && descriptor.enumerable && Object.prototype.hasOwnProperty.call(descriptor, "value"), "EVALUATION_ARTIFACT_REQUIRED");
    artifactValues[name] = descriptor.value;
  }
  requireCondition(JSON.stringify(artifactNames.slice().sort()) === JSON.stringify(REQUIRED_ARTIFACTS.slice().sort()), "EVALUATION_ARTIFACT_REQUIRED");
  requireCondition(typeof inputRunManifest.runIdentityDigest === "string" && /^[0-9a-f]{64}$/.test(inputRunManifest.runIdentityDigest), "EVALUATION_RUN_IDENTITY_DIGEST");
  const runId = `${publication.startedAtUtc.replace(/[-:]/g, "")}_${inputRunManifest.runIdentityDigest.slice(0, 16)}`;
  const signedRunManifest = { ...inputRunManifest, startedAtUtc: publication.startedAtUtc, runId, ...CLAIM_BOUNDARY };
  const budget = createByteBudget(BUNDLE_RESOURCE_LIMITS.maxTotalBytes);
  const entries = [];
  for (const rawName of artifactNames) {
    const name = safeArtifactName(rawName);
    const measured = snapshotCanonicalJson(artifactValues[name], BUNDLE_RESOURCE_LIMITS.maxArtifactBytes);
    reserveBytes(budget, measured.measuredBytes);
    entries.push({ name, measured, maxBytes: BUNDLE_RESOURCE_LIMITS.maxArtifactBytes });
  }
  const measuredRunManifest = snapshotCanonicalJson(signedRunManifest, BUNDLE_RESOURCE_LIMITS.maxRunManifestBytes);
  const canonicalRunManifest = measuredRunManifest.snapshot;
  reserveBytes(budget, measuredRunManifest.measuredBytes);
  entries.push({ name: "run-manifest.json", measured: measuredRunManifest, maxBytes: BUNDLE_RESOURCE_LIMITS.maxRunManifestBytes });
  const rootDir = path.resolve(root);
  fs.mkdirSync(rootDir, { recursive: true });
  assertDirectoryChain(rootDir);
  const datePath = publication.startedAtUtc.slice(0, 10).replace(/-/g, path.sep);
  const parent = path.join(rootDir, datePath);
  fs.mkdirSync(parent, { recursive: true });
  assertDirectoryChain(parent);
  const finalDir = path.join(parent, runId);
  requireCondition(!fs.existsSync(finalDir), "EVALUATION_BUNDLE_IMMUTABLE_COLLISION");
  const stage = fs.mkdtempSync(path.join(parent, ".staging-"));
  let merkleRootSha256;
  let runDigest;
  try {
    const hashes = {};
    for (const entry of entries) {
      const bytes = canonicalSnapshotBytes(entry.measured, entry.maxBytes);
      hashes[entry.name] = sha256(bytes);
      const file = path.join(stage, entry.name);
      fs.writeFileSync(file, bytes, { flag: "wx" });
      fsyncFile(file);
    }
    merkleRootSha256 = bundleDigest(hashes);
    runDigest = sha256(Buffer.from(stableJson({ runManifest: canonicalRunManifest, hashes, merkleRootSha256 }), "utf8"));
    const checksumBody = Buffer.from(`${Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right)).map(([name, hash]) => `${hash}  ${name}`).join("\n")}\n`, "ascii");
    requireCondition(checksumBody.length > 0 && checksumBody.length <= BUNDLE_RESOURCE_LIMITS.maxChecksumBytes, "EVALUATION_BUNDLE_FILE_SIZE");
    reserveBytes(budget, checksumBody.length);
    fs.writeFileSync(path.join(stage, "checksums.sha256"), checksumBody, { flag: "wx" });
    fsyncFile(path.join(stage, "checksums.sha256"));
    const signature = crypto.sign(null, Buffer.from(merkleRootSha256, "ascii"), publication.signingPrivateKeyPem).toString("base64");
    const signatureEnvelope = canonicalJsonBytes({ schema: "ekg-evaluation-bundle-signature-v1", algorithm: "Ed25519", signerKeyId: publication.signerKeyId, merkleRootSha256, signatureBase64: signature }, BUNDLE_RESOURCE_LIMITS.maxSignatureBytes);
    reserveBytes(budget, signatureEnvelope.length);
    fs.writeFileSync(path.join(stage, "signature.json"), signatureEnvelope, { flag: "wx" });
    fsyncFile(path.join(stage, "signature.json"));
    fsyncDirectory(stage);
    fs.renameSync(stage, finalDir);
    fsyncDirectory(parent);
  } catch (error) {
    removeStage(stage);
    throw error;
  }
  return { schema: "ekg-evaluation-bundle-receipt-v1", runId, path: finalDir, runDigest, merkleRootSha256, gateStatus: canonicalRunManifest.state, writeOnce: false, applicationCollisionProtected: true, externalObjectLockAttested: false, storageMode: publication.storageMode, bundleResourceLimits: BUNDLE_RESOURCE_LIMITS, ...CLAIM_BOUNDARY };
}

function verifyEvaluationBundle(bundlePath, publicKeyPem, options = {}) {
  const directory = path.resolve(bundlePath);
  const requestedArtifactNames = options.requestedArtifactNames === undefined ? [] : options.requestedArtifactNames;
  requireCondition(Array.isArray(requestedArtifactNames) && requestedArtifactNames.every(name => REQUIRED_ARTIFACTS.includes(name)) && new Set(requestedArtifactNames).size === requestedArtifactNames.length, "EVALUATION_BUNDLE_ARTIFACT_REQUEST");
  const limits = resolveResourceLimits(options.resourceLimits);
  const capturedNames = new Set(["run-manifest.json", ...requestedArtifactNames]);
  assertDirectoryChain(directory);
  const directoryBefore = fs.lstatSync(directory, { bigint: true });
  requireCondition(directoryBefore.isDirectory() && !directoryBefore.isSymbolicLink(), "EVALUATION_STORE_DIRECTORY");
  const budget = createByteBudget(limits.maxTotalBytes);
  const identities = {};
  const checksumFile = path.join(directory, "checksums.sha256");
  const signatureFile = path.join(directory, "signature.json");
  const checksumSnapshot = readFileSnapshot(checksumFile, limits.maxChecksumBytes, budget, "EVALUATION_BUNDLE_CONTROL_FILES");
  identities[checksumFile] = checksumSnapshot.identity;
  const signatureSnapshot = readFileSnapshot(signatureFile, limits.maxSignatureBytes, budget, "EVALUATION_BUNDLE_CONTROL_FILES");
  identities[signatureFile] = signatureSnapshot.identity;
  const rows = checksumSnapshot.bytes.toString("ascii").trim().split("\n");
  const hashes = {};
  for (const row of rows) {
    const match = /^([0-9a-f]{64})  ([a-z0-9][a-z0-9.-]*\.json)$/.exec(row.trim());
    requireCondition(match, "EVALUATION_BUNDLE_CHECKSUM_FORMAT");
    requireCondition(!Object.prototype.hasOwnProperty.call(hashes, match[2]), "EVALUATION_BUNDLE_CHECKSUM_DUPLICATE");
    hashes[match[2]] = match[1];
  }
  const expectedFiles = [...REQUIRED_ARTIFACTS, "run-manifest.json"].sort();
  requireCondition(JSON.stringify(Object.keys(hashes).sort()) === JSON.stringify(expectedFiles), "EVALUATION_BUNDLE_ARTIFACT_COVERAGE");
  let signature;
  try { signature = JSON.parse(signatureSnapshot.bytes.toString("utf8")); } catch (_) { throw new Error("EVALUATION_BUNDLE_SIGNATURE_ENVELOPE"); }
  requireCondition(signature && typeof signature === "object" && !Array.isArray(signature), "EVALUATION_BUNDLE_SIGNATURE_ENVELOPE");
  requireCondition(signature.schema === "ekg-evaluation-bundle-signature-v1" && signature.algorithm === "Ed25519", "EVALUATION_BUNDLE_SIGNATURE_METADATA");
  requireCondition(typeof signature.signerKeyId === "string" && signature.signerKeyId.length > 0, "EVALUATION_BUNDLE_SIGNER_KEY_ID");
  requireCondition(options.expectedSignerKeyId === undefined || signature.signerKeyId === options.expectedSignerKeyId, "EVALUATION_BUNDLE_UNTRUSTED_SIGNER");
  requireCondition(typeof signature.signatureBase64 === "string" && signature.signatureBase64.length > 0, "EVALUATION_BUNDLE_SIGNATURE_VALUE");
  const merkleRootSha256 = bundleDigest(hashes);
  requireCondition(signature.merkleRootSha256 === merkleRootSha256, "EVALUATION_BUNDLE_MERKLE_ROOT");
  requireCondition(crypto.verify(null, Buffer.from(merkleRootSha256, "ascii"), publicKeyPem, Buffer.from(signature.signatureBase64, "base64")), "EVALUATION_BUNDLE_SIGNATURE");
  const expectedInventory = [...expectedFiles, "checksums.sha256", "signature.json"].sort();
  requireCondition(JSON.stringify(readBoundedInventory(directory, expectedInventory.length)) === JSON.stringify(expectedInventory), "EVALUATION_BUNDLE_UNDECLARED_FILE");
  const parsed = {};
  for (const name of expectedFiles) {
    const file = path.join(directory, name);
    const maximum = name === "run-manifest.json" ? limits.maxRunManifestBytes : limits.maxArtifactBytes;
    const snapshot = readFileSnapshot(file, maximum, budget, "EVALUATION_BUNDLE_ARTIFACT_FILE");
    identities[file] = snapshot.identity;
    requireCondition(sha256(snapshot.bytes) === hashes[name], "EVALUATION_BUNDLE_ARTIFACT_HASH");
    let value;
    try { value = JSON.parse(snapshot.bytes.toString("utf8")); } catch (_) { throw new Error("EVALUATION_BUNDLE_ARTIFACT_JSON"); }
    if (capturedNames.has(name)) parsed[name] = value;
  }
  requireCondition(JSON.stringify(readBoundedInventory(directory, expectedInventory.length)) === JSON.stringify(expectedInventory), "EVALUATION_BUNDLE_UNDECLARED_FILE");
  const directoryAfter = fs.lstatSync(directory, { bigint: true });
  requireCondition(statIdentity(directoryBefore) === statIdentity(directoryAfter), "EVALUATION_BUNDLE_READ_RACE");
  for (const [file, identity] of Object.entries(identities)) {
    const current = fs.lstatSync(file, { bigint: true });
    requireCondition(current.isFile() && !current.isSymbolicLink() && statIdentity(current) === identity, "EVALUATION_BUNDLE_READ_RACE");
  }
  const runManifest = parsed["run-manifest.json"];
  requireCondition(runManifest && typeof runManifest === "object" && !Array.isArray(runManifest), "EVALUATION_BUNDLE_RUN_MANIFEST");
  requireCondition(runManifest.clinicalAccuracyClaimed === false && runManifest.capabilityNotClaim === true, "EVALUATION_BUNDLE_CLAIM_BOUNDARY");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(runManifest.startedAtUtc), "EVALUATION_BUNDLE_RUN_ID");
  requireCondition(typeof runManifest.runIdentityDigest === "string" && /^[0-9a-f]{64}$/.test(runManifest.runIdentityDigest), "EVALUATION_BUNDLE_RUN_ID");
  const expectedRunId = `${runManifest.startedAtUtc.replace(/[-:]/g, "")}_${runManifest.runIdentityDigest.slice(0, 16)}`;
  requireCondition(runManifest.runId === expectedRunId && path.basename(directory) === runManifest.runId, "EVALUATION_BUNDLE_RUN_ID");
  const artifacts = Object.fromEntries(requestedArtifactNames.map(name => [name, parsed[name]]));
  const runDigest = sha256(Buffer.from(stableJson({ runManifest, hashes, merkleRootSha256 }), "utf8"));
  return { schema: "ekg-evaluation-bundle-verification-v1", pass: true, runDigest, merkleRootSha256, signerKeyId: signature.signerKeyId, artifactCount: Object.keys(hashes).length, verifiedBytes: budget.totalBytes, bundleResourceLimits: limits, runManifest, artifacts };
}

module.exports = { BUNDLE_RESOURCE_LIMITS, REQUIRED_ARTIFACTS, bundleDigest, publishEvaluationBundle, verifyEvaluationBundle };
