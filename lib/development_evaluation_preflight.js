"use strict";

const { payloadSha256, validateSha256, verifySignedPayload } = require("./evaluation_signatures");
const { assertDevelopmentIdentityAllowed, validateSpentRegistry } = require("./spent_dataset_registry");
const { safeRelativeFile } = require("./local_dataset_loader");

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

function exactKeys(value, allowed, code) {
  const allowedKeys = new Set(allowed);
  requireCondition(Object.keys(value).every(key => allowedKeys.has(key)), code);
}

function canonicalManifestPayload(manifest) {
  const copy = { ...manifest };
  delete copy.manifestPayloadSha256;
  return copy;
}

function validateRights(rights) {
  requireCondition(plain(rights), "DEVELOPMENT_RIGHTS_REQUIRED");
  exactKeys(rights, ["verificationStatus", "commercialProductImprovement", "rawRedistributionInRepository", "licenseSpdxOrName", "sourceUri", "licenseFileSha256", "verifiedAtUtc"], "DEVELOPMENT_RIGHTS_UNKNOWN_FIELD");
  requireCondition(rights.verificationStatus === "VERIFIED", "DEVELOPMENT_RIGHTS_UNVERIFIED");
  requireCondition(rights.commercialProductImprovement === "PERMITTED", "DEVELOPMENT_RIGHTS_COMMERCIAL_USE_DENIED");
  requireCondition(rights.rawRedistributionInRepository === false, "DEVELOPMENT_RIGHTS_RAW_REPOSITORY_DATA");
  text(rights.licenseSpdxOrName, "DEVELOPMENT_RIGHTS_LICENSE");
  text(rights.sourceUri, "DEVELOPMENT_RIGHTS_SOURCE_URI");
  validateSha256(rights.licenseFileSha256, "DEVELOPMENT_RIGHTS_LICENSE_HASH");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(rights.verifiedAtUtc), "DEVELOPMENT_RIGHTS_TIMESTAMP");
}

function validatePartitionAttestation(attestation) {
  requireCondition(plain(attestation), "DEVELOPMENT_PARTITION_ATTESTATION");
  exactKeys(attestation, ["fullPartitionSha256", "patientRoleSetsSha256", "waveformDuplicateAuditSha256", "splitAlgorithmNameAndVersion", "independentApprover", "crossRolePatientOverlapCount", "crossRoleExactWaveformOverlapCount", "crossRoleNearDuplicateOverlapCount", "selectionAndHoldoutPatientIdentityVerified"], "DEVELOPMENT_PARTITION_UNKNOWN_FIELD");
  validateSha256(attestation.fullPartitionSha256, "DEVELOPMENT_FULL_PARTITION_HASH");
  validateSha256(attestation.patientRoleSetsSha256, "DEVELOPMENT_PATIENT_ROLE_SETS_HASH");
  validateSha256(attestation.waveformDuplicateAuditSha256, "DEVELOPMENT_DUPLICATE_AUDIT_HASH");
  text(attestation.splitAlgorithmNameAndVersion, "DEVELOPMENT_SPLIT_ALGORITHM");
  text(attestation.independentApprover, "DEVELOPMENT_PARTITION_APPROVER");
  requireCondition(attestation.crossRolePatientOverlapCount === 0, "DEVELOPMENT_PATIENT_LEAKAGE");
  requireCondition(attestation.crossRoleExactWaveformOverlapCount === 0, "DEVELOPMENT_WAVEFORM_LEAKAGE");
  requireCondition(attestation.crossRoleNearDuplicateOverlapCount === 0, "DEVELOPMENT_NEAR_DUPLICATE_LEAKAGE");
  requireCondition(attestation.selectionAndHoldoutPatientIdentityVerified === true, "DEVELOPMENT_PROTECTED_IDENTITY_UNVERIFIED");
}

function validateRecord(record, seenRecords, patients, waveformHashes) {
  requireCondition(plain(record), "DEVELOPMENT_RECORD_OBJECT");
  const recordFields = ["recordHmacSha256", "patientHmacSha256", "parentRecordHmacSha256", "splitRole", "patientIndependence", "taskEligibility", "exclusionCode", "sourceFileSha256", "labelSnapshotSha256", "signalPath", "referencePath", "signalBytes", "referenceBytes", "referenceEventCount", "nearDuplicateGroupSha256", "sampleRateHz", "durationSeconds", "subgroups"];
  exactKeys(record, recordFields, "DEVELOPMENT_RECORD_UNKNOWN_FIELD");
  requireCondition(recordFields.every(key => Object.hasOwn(record, key)), "DEVELOPMENT_RECORD_CANONICAL_FIELDS");
  const recordHmac = validateSha256(record.recordHmacSha256, "DEVELOPMENT_RECORD_HMAC");
  const patientHmac = validateSha256(record.patientHmacSha256, "DEVELOPMENT_PATIENT_HMAC");
  requireCondition(!seenRecords.has(recordHmac), "DEVELOPMENT_DUPLICATE_RECORD");
  seenRecords.add(recordHmac);
  requireCondition(record.splitRole === "development", "DEVELOPMENT_ROLE_ONLY");
  requireCondition(record.patientIndependence === "VERIFIED", "DEVELOPMENT_PATIENT_IDENTITY_UNVERIFIED");
  requireCondition(["ELIGIBLE", "EXCLUDED"].includes(record.taskEligibility), "DEVELOPMENT_TASK_ELIGIBILITY");
  if (record.taskEligibility === "EXCLUDED") text(record.exclusionCode, "DEVELOPMENT_EXCLUSION_CODE");
  else requireCondition(record.exclusionCode === null, "DEVELOPMENT_ELIGIBLE_EXCLUSION_CODE");
  validateSha256(record.sourceFileSha256, "DEVELOPMENT_SOURCE_HASH");
  validateSha256(record.labelSnapshotSha256, "DEVELOPMENT_LABEL_HASH");
  safeRelativeFile(record.signalPath);
  safeRelativeFile(record.referencePath);
  requireCondition(Number.isInteger(record.signalBytes) && record.signalBytes > 0, "DEVELOPMENT_SIGNAL_BYTES");
  requireCondition(Number.isInteger(record.referenceBytes) && record.referenceBytes > 0, "DEVELOPMENT_REFERENCE_BYTES");
  requireCondition(Number.isInteger(record.referenceEventCount) && record.referenceEventCount >= 0, "DEVELOPMENT_REFERENCE_EVENT_COUNT");
  if (record.nearDuplicateGroupSha256 !== null && record.nearDuplicateGroupSha256 !== undefined) validateSha256(record.nearDuplicateGroupSha256, "DEVELOPMENT_NEAR_DUPLICATE_HASH");
  requireCondition(Number.isFinite(record.sampleRateHz) && record.sampleRateHz > 0, "DEVELOPMENT_SAMPLE_RATE");
  requireCondition(Number.isFinite(record.durationSeconds) && record.durationSeconds > 0, "DEVELOPMENT_DURATION");
  requireCondition(plain(record.subgroups), "DEVELOPMENT_SUBGROUPS");
  requireCondition(Object.values(record.subgroups).every(value => value === null || ["string", "number", "boolean"].includes(typeof value)), "DEVELOPMENT_SUBGROUP_VALUE");
  patients.add(patientHmac);
  for (const hash of [record.sourceFileSha256, record.nearDuplicateGroupSha256].filter(Boolean)) {
    requireCondition(!waveformHashes.has(hash), "DEVELOPMENT_DUPLICATE_WAVEFORM");
    waveformHashes.add(hash);
  }
  if (record.parentRecordHmacSha256 !== null && record.parentRecordHmacSha256 !== undefined) validateSha256(record.parentRecordHmacSha256, "DEVELOPMENT_PARENT_RECORD_HMAC");
  return { recordHmac, patientHmac };
}

function computedManifestIdentity(manifest) {
  const eligible = manifest.records.filter(record => record.taskEligibility === "ELIGIBLE");
  return {
    ...manifest.datasetIdentity,
    benchmarkId: manifest.benchmarkId,
    aliases: [...(manifest.datasetIdentity.aliases || []), manifest.benchmarkId],
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    recordSetSha256: payloadSha256(eligible.map(record => record.recordHmacSha256).sort()),
    patientSetSha256: payloadSha256([...new Set(eligible.map(record => record.patientHmacSha256))].sort()),
    contentSha256: eligible.flatMap(record => [record.sourceFileSha256, record.labelSnapshotSha256]),
  };
}

function validateDevelopmentManifest(manifest) {
  requireCondition(plain(manifest), "DEVELOPMENT_MANIFEST_OBJECT");
  exactKeys(manifest, ["schema", "benchmarkId", "benchmarkVersion", "splitRole", "clinicalAccuracyClaimed", "leadPolicy", "createdAtUtc", "cohortCutoff", "creator", "independentApprover", "sourceInventorySha256", "licenceBundleSha256", "ontologyMappingSha256", "previousManifestSha256", "datasetIdentity", "rights", "partitionAttestation", "sealedCounts", "records", "manifestPayloadSha256"], "DEVELOPMENT_MANIFEST_UNKNOWN_FIELD");
  requireCondition(manifest.schema === "ekg-development-manifest-v1", "DEVELOPMENT_MANIFEST_SCHEMA");
  requireCondition(manifest.splitRole === "development", "DEVELOPMENT_MANIFEST_ROLE");
  requireCondition(manifest.clinicalAccuracyClaimed === false, "DEVELOPMENT_MANIFEST_CLINICAL_CLAIM");
  text(manifest.benchmarkId, "DEVELOPMENT_BENCHMARK_ID");
  text(manifest.benchmarkVersion, "DEVELOPMENT_BENCHMARK_VERSION");
  text(manifest.leadPolicy, "DEVELOPMENT_LEAD_POLICY");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.createdAtUtc), "DEVELOPMENT_CREATED_AT");
  requireCondition(/^\d{4}-\d{2}-\d{2}$/.test(manifest.cohortCutoff), "DEVELOPMENT_COHORT_CUTOFF");
  text(manifest.creator, "DEVELOPMENT_CREATOR");
  text(manifest.independentApprover, "DEVELOPMENT_APPROVER");
  validateSha256(manifest.sourceInventorySha256, "DEVELOPMENT_SOURCE_INVENTORY_HASH");
  validateSha256(manifest.licenceBundleSha256, "DEVELOPMENT_LICENCE_BUNDLE_HASH");
  validateSha256(manifest.ontologyMappingSha256, "DEVELOPMENT_ONTOLOGY_HASH");
  if (manifest.previousManifestSha256 !== null) validateSha256(manifest.previousManifestSha256, "DEVELOPMENT_PREVIOUS_MANIFEST_HASH");
  requireCondition(plain(manifest.datasetIdentity), "DEVELOPMENT_DATASET_IDENTITY");
  exactKeys(manifest.datasetIdentity, ["datasetId", "datasetFamily", "datasetRelease", "canonicalSource", "sourceManifestSha256", "aliases"], "DEVELOPMENT_DATASET_IDENTITY_UNKNOWN_FIELD");
  text(manifest.datasetIdentity.datasetId, "DEVELOPMENT_DATASET_ID");
  text(manifest.datasetIdentity.datasetFamily, "DEVELOPMENT_DATASET_FAMILY");
  text(manifest.datasetIdentity.datasetRelease, "DEVELOPMENT_DATASET_RELEASE");
  text(manifest.datasetIdentity.canonicalSource, "DEVELOPMENT_CANONICAL_SOURCE");
  requireCondition(Array.isArray(manifest.datasetIdentity.aliases) && manifest.datasetIdentity.aliases.every(value => typeof value === "string" && value.trim().length > 0) && new Set(manifest.datasetIdentity.aliases).size === manifest.datasetIdentity.aliases.length, "DEVELOPMENT_DATASET_ALIASES");
  validateSha256(manifest.datasetIdentity.sourceManifestSha256, "DEVELOPMENT_SOURCE_MANIFEST_HASH");
  validateRights(manifest.rights);
  validatePartitionAttestation(manifest.partitionAttestation);
  requireCondition(Array.isArray(manifest.records) && manifest.records.length > 0, "DEVELOPMENT_RECORDS_REQUIRED");
  const seenRecords = new Set();
  const patients = new Set();
  const waveformHashes = new Set();
  manifest.records.forEach(record => validateRecord(record, seenRecords, patients, waveformHashes));
  const recordMap = new Map(manifest.records.map(record => [record.recordHmacSha256, record]));
  for (const record of manifest.records) {
    if (record.parentRecordHmacSha256 === null || record.parentRecordHmacSha256 === undefined) continue;
    const parent = recordMap.get(record.parentRecordHmacSha256);
    requireCondition(parent, "DEVELOPMENT_PARENT_RECORD_MISSING");
    requireCondition(parent.patientHmacSha256 === record.patientHmacSha256 && parent.splitRole === record.splitRole, "DEVELOPMENT_PARENT_ROLE_MISMATCH");
  }
  const eligible = manifest.records.filter(record => record.taskEligibility === "ELIGIBLE");
  requireCondition(plain(manifest.sealedCounts), "DEVELOPMENT_SEALED_COUNTS");
  exactKeys(manifest.sealedCounts, ["patients", "records", "referenceEvents", "durationSeconds"], "DEVELOPMENT_SEALED_COUNTS_UNKNOWN_FIELD");
  requireCondition(Number.isInteger(manifest.sealedCounts.patients) && manifest.sealedCounts.patients >= 0, "DEVELOPMENT_SEALED_PATIENTS_VALUE");
  requireCondition(Number.isInteger(manifest.sealedCounts.records) && manifest.sealedCounts.records >= 0, "DEVELOPMENT_SEALED_RECORDS_VALUE");
  requireCondition(Number.isInteger(manifest.sealedCounts.referenceEvents) && manifest.sealedCounts.referenceEvents >= 0, "DEVELOPMENT_SEALED_EVENTS_VALUE");
  requireCondition(Number.isFinite(manifest.sealedCounts.durationSeconds) && manifest.sealedCounts.durationSeconds >= 0, "DEVELOPMENT_SEALED_DURATION_VALUE");
  requireCondition(manifest.sealedCounts.patients === new Set(eligible.map(record => record.patientHmacSha256)).size, "DEVELOPMENT_SEALED_PATIENT_COUNT");
  requireCondition(manifest.sealedCounts.records === eligible.length, "DEVELOPMENT_SEALED_RECORD_COUNT");
  requireCondition(manifest.sealedCounts.referenceEvents === eligible.reduce((sum, record) => sum + record.referenceEventCount, 0), "DEVELOPMENT_SEALED_EVENT_COUNT");
  requireCondition(manifest.sealedCounts.durationSeconds === eligible.reduce((sum, record) => sum + record.durationSeconds, 0), "DEVELOPMENT_SEALED_DURATION");
  validateSha256(manifest.manifestPayloadSha256, "DEVELOPMENT_MANIFEST_PAYLOAD_HASH");
  requireCondition(payloadSha256(canonicalManifestPayload(manifest)) === manifest.manifestPayloadSha256, "DEVELOPMENT_MANIFEST_PAYLOAD_MISMATCH");
  return { recordCount: eligible.length, patientCount: new Set(eligible.map(record => record.patientHmacSha256)).size, excludedCount: manifest.records.length - eligible.length };
}

function validateManifestSignerAuthority(manifest, signature, trustStore) {
  requireCondition(plain(signature) && typeof signature.keyId === "string" && signature.keyId.length > 0, "DEVELOPMENT_MANIFEST_SIGNATURE");
  requireCondition(plain(trustStore) && Array.isArray(trustStore.keys), "DEVELOPMENT_MANIFEST_TRUST_STORE");
  const key = trustStore.keys.find(row => plain(row) && row.keyId === signature.keyId);
  requireCondition(key && key.rightsAuthority === true && key.patientPartitionAuthority === true, "DEVELOPMENT_MANIFEST_SIGNER_AUTHORITY");
  requireCondition(Array.isArray(key.allowedDatasetIds) && key.allowedDatasetIds.includes(manifest.datasetIdentity.datasetId), "DEVELOPMENT_MANIFEST_SIGNER_SCOPE");
}

function preflightDevelopmentRun(input) {
  requireCondition(plain(input), "DEVELOPMENT_PREFLIGHT_INPUT");
  const registryVerification = validateSpentRegistry(input.spentRegistry, input.spentRegistrySignature, input.spentTrustStore, {
    minimumSequence: input.minimumSpentRegistrySequence,
    expectedPayloadSha256: input.expectedSpentRegistrySha256,
  });
  requireCondition(plain(input.manifest), "DEVELOPMENT_MANIFEST_REQUIRED");
  const counts = validateDevelopmentManifest(input.manifest);
  validateManifestSignerAuthority(input.manifest, input.manifestSignature, input.manifestTrustStore);
  const manifestVerification = verifySignedPayload(canonicalManifestPayload(input.manifest), input.manifestSignature, input.manifestTrustStore, {
    expectedPayloadSha256: input.manifest.manifestPayloadSha256,
  });
  assertDevelopmentIdentityAllowed(computedManifestIdentity(input.manifest), input.spentRegistry);
  return {
    schema: "ekg-development-preflight-v1",
    pass: true,
    benchmarkId: input.manifest.benchmarkId,
    benchmarkVersion: input.manifest.benchmarkVersion,
    recordCount: counts.recordCount,
    patientCount: counts.patientCount,
    excludedCount: counts.excludedCount,
    spentRegistry: registryVerification,
    manifestSignature: manifestVerification,
    ...CLAIM_BOUNDARY,
  };
}

module.exports = { CLAIM_BOUNDARY, canonicalManifestPayload, computedManifestIdentity, preflightDevelopmentRun, validateDevelopmentManifest, validateManifestSignerAuthority, validatePartitionAttestation, validateRights };
