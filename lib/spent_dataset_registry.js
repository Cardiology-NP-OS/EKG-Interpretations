"use strict";

const { validateSha256, verifySignedPayload } = require("./evaluation_signatures");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function text(value, code) {
  requireCondition(typeof value === "string" && value.trim().length > 0, code);
  return value.trim();
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function identityTokens(identity) {
  const tokens = new Set();
  for (const value of [identity.datasetId, identity.datasetFamily, identity.datasetName, identity.datasetRelease, identity.canonicalSource, ...(identity.aliases || [])]) {
    const token = normalizedText(value);
    if (token) tokens.add(token);
  }
  return tokens;
}

function identityHashes(identity) {
  const hashes = new Set();
  for (const value of [identity.archiveSha256, identity.sourceManifestSha256, identity.recordSetSha256, identity.patientSetSha256, ...(identity.contentSha256 || [])]) {
    if (value !== undefined && value !== null) hashes.add(validateSha256(value, "SPENT_REGISTRY_IDENTITY_HASH"));
  }
  return hashes;
}

function validateEntry(entry) {
  requireCondition(plain(entry), "SPENT_REGISTRY_ENTRY_OBJECT");
  text(entry.benchmarkId, "SPENT_REGISTRY_BENCHMARK_ID");
  requireCondition(["SPENT", "FAILED_SPENT"].includes(entry.state), "SPENT_REGISTRY_STATE");
  requireCondition(entry.mayExecute === false && entry.mayUseForParameterSelection === false, "SPENT_REGISTRY_DENIAL_FLAGS");
  requireCondition(Array.isArray(entry.aliases) && entry.aliases.length > 0, "SPENT_REGISTRY_ALIASES");
  requireCondition(Array.isArray(entry.deniedIdentities) && entry.deniedIdentities.length > 0, "SPENT_REGISTRY_IDENTITIES");
  entry.deniedIdentities.forEach(identity => {
    requireCondition(plain(identity), "SPENT_REGISTRY_IDENTITY_OBJECT");
    requireCondition(identityTokens(identity).size > 0 || identityHashes(identity).size > 0, "SPENT_REGISTRY_EMPTY_IDENTITY");
  });
  text(entry.spendReason, "SPENT_REGISTRY_REASON");
  return true;
}

function validateSpentRegistry(registry, signature, trustStore, options = {}) {
  requireCondition(plain(registry), "SPENT_REGISTRY_OBJECT");
  requireCondition(registry.schema === "ekg-spent-registry-v1", "SPENT_REGISTRY_SCHEMA");
  requireCondition(Number.isInteger(registry.sequence) && registry.sequence >= 1, "SPENT_REGISTRY_SEQUENCE");
  requireCondition(registry.appendOnly === true, "SPENT_REGISTRY_APPEND_ONLY");
  requireCondition(registry.clinicalAccuracyClaimed === false, "SPENT_REGISTRY_CLINICAL_CLAIM");
  requireCondition(Array.isArray(registry.entries) && registry.entries.length >= 2, "SPENT_REGISTRY_ENTRIES");
  const ids = new Set();
  for (const entry of registry.entries) {
    validateEntry(entry);
    requireCondition(!ids.has(entry.benchmarkId), "SPENT_REGISTRY_DUPLICATE_BENCHMARK");
    ids.add(entry.benchmarkId);
  }
  requireCondition(ids.has("MIT-BIH-RPEAK-FULL-V1"), "SPENT_REGISTRY_MITBIH_REQUIRED");
  requireCondition([...ids].some(id => id.includes("LUDB")), "SPENT_REGISTRY_LUDB_REQUIRED");
  const verification = verifySignedPayload(registry, signature, trustStore, options);
  return { schema: "ekg-spent-registry-validation-v1", pass: true, sequence: registry.sequence, entryCount: registry.entries.length, ...verification };
}

function matchSpentIdentity(requested, entry) {
  const requestedTokens = identityTokens(requested);
  const requestedHashes = identityHashes(requested);
  const entryTokens = new Set([normalizedText(entry.benchmarkId), ...entry.aliases.map(normalizedText)]);
  for (const identity of entry.deniedIdentities) {
    for (const token of identityTokens(identity)) entryTokens.add(token);
  }
  const tokenMatch = [...requestedTokens].some(token => entryTokens.has(token));
  const hashMatch = entry.deniedIdentities.some(identity => [...identityHashes(identity)].some(hash => requestedHashes.has(hash)));
  return tokenMatch || hashMatch;
}

function assertDevelopmentIdentityAllowed(requested, registry) {
  requireCondition(plain(requested), "SPENT_REGISTRY_REQUEST_OBJECT");
  requireCondition(identityTokens(requested).size > 0 || identityHashes(requested).size > 0, "SPENT_REGISTRY_REQUEST_IDENTITY_REQUIRED");
  const blocked = registry.entries.find(entry => matchSpentIdentity(requested, entry));
  requireCondition(!blocked, `SPENT_DATASET_DENIED:${blocked ? blocked.benchmarkId : "UNKNOWN"}`);
  return true;
}

module.exports = { assertDevelopmentIdentityAllowed, matchSpentIdentity, validateSpentRegistry };
