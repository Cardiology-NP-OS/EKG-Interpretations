"use strict";

const { payloadSha256, validateSha256, verifySignedPayload } = require("./evaluation_signatures");
const { assertDevelopmentIdentityAllowed, validateSpentRegistry } = require("./spent_dataset_registry");

const CLAIM_BOUNDARY = Object.freeze({
  clinicalAccuracyClaimed: false,
  capabilityNotClaim: true,
  reportable: false,
  runtimeAuthority: false,
  projectGold: false,
  sourceLabelsAreProjectGold: false,
});

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

function canonicalManifestPayload(manifest) {
  const copy = { ...manifest };
  delete copy.manifestPayloadSha256;
  return copy;
}

function validateRights(rights) {
  requireCondition(plain(rights), "DEVELOPMENT_RIGHTS_REQUIRED");
  requireCondition(rights.verificationStatus === "VERIFIED", "DEVELOPMENT_RIGHTS_UNVERIFIED");
  requireCondition(rights.commercialProductImprovement === "PERMITTED", "DEVELOPMENT_RIGHTS_COMMERCIAL_USE_DENIED");
  requireCondition(rights.rawRedistributionInRepository === false, "DEVELOPMENT_RIGHTS_RAW_REPOSITORY_DATA");
  text(rights.licenseSpdxOrName, "DEVELOPMENT_RIGHTS_LICENSE");
  text(rights.sourceUri, "DEVELOPMENT_RIGHTS_SOURCE_URI");
  validateSha256(rights.licenseFileSha256, "DEVELOPMENT_RIGHTS_LICENSE_HASH");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(rights.verifiedAtUtc), "DEVELOPMENT_RIGHTS_TIMESTAMP");
}

function validateRecord(record, seenRecords, patientRoles, waveformRoles) {
  requireCondition(plain(record), "DEVELOPMENT_RECORD_OBJECT");
  const recordHmac = validateSha256(record.recordHmacSha256, "DEVELOPMENT_RECORD_HMAC");
  const patientHmac = validateSha256(record.patientHmacSha256, "DEVELOPMENT_PATIENT_HMAC");
  requireCondition(!seenRecords.has(recordHmac), "DEVELOPMENT_DUPLICATE_RECORD");
  seenRecords.add(recordHmac);
  requireCondition(["development", "selection", "holdout"].includes(record.splitRole), "DEVELOPMENT_SPLIT_ROLE");
  requireCondition(record.patientIndependence === "VERIFIED", "DEVELOPMENT_PATIENT_IDENTITY_UNVERIFIED");
  requireCondition(record.taskEligibility === "ELIGIBLE", "DEVELOPMENT_RECORD_NOT_ELIGIBLE");
  validateSha256(record.sourceFileSha256, "DEVELOPMENT_SOURCE_HASH");
  validateSha256(record.labelSnapshotSha256, "DEVELOPMENT_LABEL_HASH");
  if (record.nearDuplicateGroupSha256 !== null && record.nearDuplicateGroupSha256 !== undefined) validateSha256(record.nearDuplicateGroupSha256, "DEVELOPMENT_NEAR_DUPLICATE_HASH");
  requireCondition(Number.isFinite(record.sampleRateHz) && record.sampleRateHz > 0, "DEVELOPMENT_SAMPLE_RATE");
  requireCondition(Number.isFinite(record.durationSeconds) && record.durationSeconds > 0, "DEVELOPMENT_DURATION");
  requireCondition(plain(record.subgroups), "DEVELOPMENT_SUBGROUPS");
  const priorRole = patientRoles.get(patientHmac);
  requireCondition(priorRole === undefined || priorRole === record.splitRole, "DEVELOPMENT_PATIENT_LEAKAGE");
  patientRoles.set(patientHmac, record.splitRole);
  for (const hash of [record.sourceFileSha256, record.nearDuplicateGroupSha256].filter(Boolean)) {
    const priorWaveformRole = waveformRoles.get(hash);
    requireCondition(priorWaveformRole === undefined || priorWaveformRole === record.splitRole, "DEVELOPMENT_WAVEFORM_LEAKAGE");
    waveformRoles.set(hash, record.splitRole);
  }
  if (record.parentRecordHmacSha256 !== null && record.parentRecordHmacSha256 !== undefined) validateSha256(record.parentRecordHmacSha256, "DEVELOPMENT_PARENT_RECORD_HMAC");
  return { recordHmac, patientHmac };
}

function validateDevelopmentManifest(manifest) {
  requireCondition(plain(manifest), "DEVELOPMENT_MANIFEST_OBJECT");
  requireCondition(manifest.schema === "ekg-development-manifest-v1", "DEVELOPMENT_MANIFEST_SCHEMA");
  requireCondition(manifest.splitRole === "development", "DEVELOPMENT_MANIFEST_ROLE");
  requireCondition(manifest.clinicalAccuracyClaimed === false, "DEVELOPMENT_MANIFEST_CLINICAL_CLAIM");
  text(manifest.benchmarkId, "DEVELOPMENT_BENCHMARK_ID");
  text(manifest.benchmarkVersion, "DEVELOPMENT_BENCHMARK_VERSION");
  requireCondition(plain(manifest.datasetIdentity), "DEVELOPMENT_DATASET_IDENTITY");
  text(manifest.datasetIdentity.datasetId, "DEVELOPMENT_DATASET_ID");
  text(manifest.datasetIdentity.datasetRelease, "DEVELOPMENT_DATASET_RELEASE");
  validateSha256(manifest.datasetIdentity.sourceManifestSha256, "DEVELOPMENT_SOURCE_MANIFEST_HASH");
  validateRights(manifest.rights);
  requireCondition(Array.isArray(manifest.records) && manifest.records.length > 0, "DEVELOPMENT_RECORDS_REQUIRED");
  const seenRecords = new Set();
  const patientRoles = new Map();
  const waveformRoles = new Map();
  manifest.records.forEach(record => validateRecord(record, seenRecords, patientRoles, waveformRoles));
  requireCondition(manifest.records.every(record => record.splitRole === "development"), "DEVELOPMENT_ROLE_ONLY");
  validateSha256(manifest.manifestPayloadSha256, "DEVELOPMENT_MANIFEST_PAYLOAD_HASH");
  requireCondition(payloadSha256(canonicalManifestPayload(manifest)) === manifest.manifestPayloadSha256, "DEVELOPMENT_MANIFEST_PAYLOAD_MISMATCH");
  return { recordCount: seenRecords.size, patientCount: patientRoles.size };
}

function preflightDevelopmentRun(input) {
  requireCondition(plain(input), "DEVELOPMENT_PREFLIGHT_INPUT");
  const registryVerification = validateSpentRegistry(input.spentRegistry, input.spentRegistrySignature, input.spentTrustStore, {
    minimumSequence: input.minimumSpentRegistrySequence,
    expectedPayloadSha256: input.expectedSpentRegistrySha256,
  });
  requireCondition(plain(input.manifest), "DEVELOPMENT_MANIFEST_REQUIRED");
  assertDevelopmentIdentityAllowed(input.manifest.datasetIdentity || {}, input.spentRegistry);
  const counts = validateDevelopmentManifest(input.manifest);
  const manifestVerification = verifySignedPayload(canonicalManifestPayload(input.manifest), input.manifestSignature, input.manifestTrustStore, {
    expectedPayloadSha256: input.manifest.manifestPayloadSha256,
  });
  return {
    schema: "ekg-development-preflight-v1",
    pass: true,
    benchmarkId: input.manifest.benchmarkId,
    benchmarkVersion: input.manifest.benchmarkVersion,
    recordCount: counts.recordCount,
    patientCount: counts.patientCount,
    spentRegistry: registryVerification,
    manifestSignature: manifestVerification,
    ...CLAIM_BOUNDARY,
  };
}

module.exports = { CLAIM_BOUNDARY, canonicalManifestPayload, preflightDevelopmentRun, validateDevelopmentManifest, validateRights };
