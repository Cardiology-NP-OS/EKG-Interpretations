"use strict";

const { payloadSha256, validateSha256 } = require("./evaluation_signatures");
const { stableJson } = require("./evaluation_runtime");

const PARTITION_ROLES = Object.freeze(["development", "selection", "locked-holdout"]);
const ROW_FIELDS = Object.freeze(["recordHmacSha256", "patientHmacSha256", "parentRecordHmacSha256", "splitRole", "patientIndependence", "taskEligibility", "sourceFileSha256", "nearDuplicateGroupSha256"]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, allowed, code) {
  const allowedKeys = new Set(allowed);
  requireCondition(Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowedKeys.has(key)), code);
}

function text(value, code) {
  requireCondition(typeof value === "string" && value.trim().length > 0, code);
  return value.trim();
}

function normalizedRows(partitionIndex) {
  return partitionIndex.rows.map(row => ({ ...row })).sort((left, right) => left.recordHmacSha256.localeCompare(right.recordHmacSha256));
}

function identityMemberships(rows, field) {
  const memberships = new Map();
  for (const row of rows) {
    const identity = row[field];
    if (identity === null) continue;
    if (!memberships.has(identity)) memberships.set(identity, { roles: new Set(), recordCount: 0 });
    const membership = memberships.get(identity);
    membership.roles.add(row.splitRole);
    membership.recordCount += 1;
  }
  return [...memberships.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([identitySha256, membership]) => ({ identitySha256, roles: [...membership.roles].sort(), recordCount: membership.recordCount }));
}

function patientRoleSets(rows) {
  const sets = Object.fromEntries(PARTITION_ROLES.map(role => [role, []]));
  for (const role of PARTITION_ROLES) sets[role] = [...new Set(rows.filter(row => row.splitRole === role).map(row => row.patientHmacSha256))].sort();
  return sets;
}

function partitionDigests(partitionIndex) {
  const rows = normalizedRows(partitionIndex);
  return {
    fullPartitionSha256: payloadSha256(partitionIndex),
    patientRoleSetsSha256: payloadSha256(patientRoleSets(rows)),
    waveformDuplicateAuditSha256: payloadSha256({
      exactWaveforms: identityMemberships(rows, "sourceFileSha256"),
      nearDuplicateGroups: identityMemberships(rows, "nearDuplicateGroupSha256"),
    }),
  };
}

function crossRoleOverlapCount(rows, field) {
  return identityMemberships(rows, field).filter(membership => membership.roles.length > 1).length;
}

function manifestPartitionRows(manifest) {
  return manifest.records.map(record => Object.fromEntries(ROW_FIELDS.map(field => [field, record[field]]))).sort((left, right) => left.recordHmacSha256.localeCompare(right.recordHmacSha256));
}

function validatePartitionRow(row) {
  requireCondition(plain(row), "DEVELOPMENT_PARTITION_ROW_OBJECT");
  exactKeys(row, ROW_FIELDS, "DEVELOPMENT_PARTITION_ROW_FIELDS");
  validateSha256(row.recordHmacSha256, "DEVELOPMENT_PARTITION_RECORD_HMAC");
  validateSha256(row.patientHmacSha256, "DEVELOPMENT_PARTITION_PATIENT_HMAC");
  if (row.parentRecordHmacSha256 !== null) validateSha256(row.parentRecordHmacSha256, "DEVELOPMENT_PARTITION_PARENT_HMAC");
  requireCondition(PARTITION_ROLES.includes(row.splitRole), "DEVELOPMENT_PARTITION_ROLE");
  requireCondition(["VERIFIED", "UNVERIFIED"].includes(row.patientIndependence), "DEVELOPMENT_PARTITION_PATIENT_INDEPENDENCE");
  requireCondition(["ELIGIBLE", "EXCLUDED"].includes(row.taskEligibility), "DEVELOPMENT_PARTITION_TASK_ELIGIBILITY");
  validateSha256(row.sourceFileSha256, "DEVELOPMENT_PARTITION_SOURCE_HASH");
  validateSha256(row.nearDuplicateGroupSha256, "DEVELOPMENT_PARTITION_NEAR_DUPLICATE_HASH");
}

function verifyDevelopmentPartition(partitionIndex, manifest) {
  requireCondition(plain(partitionIndex), "DEVELOPMENT_PARTITION_OBJECT");
  exactKeys(partitionIndex, ["schema", "benchmarkId", "benchmarkVersion", "clinicalAccuracyClaimed", "patientHmacKeyId", "patientCanonicalizationVersion", "waveformFingerprintVersion", "rows"], "DEVELOPMENT_PARTITION_FIELDS");
  requireCondition(partitionIndex.schema === "ekg-development-partition-index-v1", "DEVELOPMENT_PARTITION_SCHEMA");
  requireCondition(partitionIndex.benchmarkId === manifest.benchmarkId && partitionIndex.benchmarkVersion === manifest.benchmarkVersion, "DEVELOPMENT_PARTITION_BENCHMARK");
  requireCondition(partitionIndex.clinicalAccuracyClaimed === false, "DEVELOPMENT_PARTITION_CLINICAL_CLAIM");
  text(partitionIndex.patientHmacKeyId, "DEVELOPMENT_PARTITION_PATIENT_HMAC_KEY_ID");
  text(partitionIndex.patientCanonicalizationVersion, "DEVELOPMENT_PARTITION_PATIENT_CANONICALIZATION_VERSION");
  text(partitionIndex.waveformFingerprintVersion, "DEVELOPMENT_PARTITION_WAVEFORM_FINGERPRINT_VERSION");
  requireCondition(Array.isArray(partitionIndex.rows) && partitionIndex.rows.length > 0, "DEVELOPMENT_PARTITION_ROWS");
  partitionIndex.rows.forEach(validatePartitionRow);
  const rows = normalizedRows(partitionIndex);
  requireCondition(stableJson(rows) === stableJson(partitionIndex.rows), "DEVELOPMENT_PARTITION_SORT_ORDER");
  requireCondition(new Set(rows.map(row => row.recordHmacSha256)).size === rows.length, "DEVELOPMENT_PARTITION_DUPLICATE_RECORD");
  const records = new Map(rows.map(row => [row.recordHmacSha256, row]));
  for (const row of rows) {
    if (row.parentRecordHmacSha256 === null) continue;
    requireCondition(row.parentRecordHmacSha256 !== row.recordHmacSha256, "DEVELOPMENT_PARTITION_SELF_PARENT");
    const parent = records.get(row.parentRecordHmacSha256);
    requireCondition(parent, "DEVELOPMENT_PARTITION_PARENT_MISSING");
    requireCondition(parent.patientHmacSha256 === row.patientHmacSha256 && parent.splitRole === row.splitRole, "DEVELOPMENT_PARTITION_PARENT_ROLE_MISMATCH");
  }
  const roleRecordCounts = {
    development: rows.filter(row => row.splitRole === "development").length,
    selection: rows.filter(row => row.splitRole === "selection").length,
    lockedHoldout: rows.filter(row => row.splitRole === "locked-holdout").length,
  };
  const protectedIdentityVerified = rows.filter(row => row.splitRole !== "development").every(row => row.patientIndependence === "VERIFIED");
  requireCondition(protectedIdentityVerified, "DEVELOPMENT_PARTITION_PROTECTED_IDENTITY_UNVERIFIED");
  const patientOverlapCount = crossRoleOverlapCount(rows, "patientHmacSha256");
  const exactWaveformOverlapCount = crossRoleOverlapCount(rows, "sourceFileSha256");
  const nearDuplicateOverlapCount = crossRoleOverlapCount(rows, "nearDuplicateGroupSha256");
  requireCondition(patientOverlapCount === 0, "DEVELOPMENT_PARTITION_PATIENT_LEAKAGE");
  requireCondition(exactWaveformOverlapCount === 0, "DEVELOPMENT_PARTITION_WAVEFORM_LEAKAGE");
  requireCondition(nearDuplicateOverlapCount === 0, "DEVELOPMENT_PARTITION_NEAR_DUPLICATE_LEAKAGE");
  const developmentRows = rows.filter(row => row.splitRole === "development");
  requireCondition(stableJson(developmentRows) === stableJson(manifestPartitionRows(manifest)), "DEVELOPMENT_PARTITION_MANIFEST_MISMATCH");
  requireCondition(Object.values(roleRecordCounts).every(count => count > 0), "DEVELOPMENT_PARTITION_ROLE_EMPTY");
  const digests = partitionDigests(partitionIndex);
  requireCondition(digests.fullPartitionSha256 === manifest.partitionAttestation.fullPartitionSha256, "DEVELOPMENT_FULL_PARTITION_DIGEST_MISMATCH");
  requireCondition(digests.patientRoleSetsSha256 === manifest.partitionAttestation.patientRoleSetsSha256, "DEVELOPMENT_PATIENT_ROLE_SETS_DIGEST_MISMATCH");
  requireCondition(digests.waveformDuplicateAuditSha256 === manifest.partitionAttestation.waveformDuplicateAuditSha256, "DEVELOPMENT_DUPLICATE_AUDIT_DIGEST_MISMATCH");
  requireCondition(manifest.partitionAttestation.crossRolePatientOverlapCount === patientOverlapCount, "DEVELOPMENT_PATIENT_OVERLAP_ATTESTATION_MISMATCH");
  requireCondition(manifest.partitionAttestation.crossRoleExactWaveformOverlapCount === exactWaveformOverlapCount, "DEVELOPMENT_WAVEFORM_OVERLAP_ATTESTATION_MISMATCH");
  requireCondition(manifest.partitionAttestation.crossRoleNearDuplicateOverlapCount === nearDuplicateOverlapCount, "DEVELOPMENT_NEAR_DUPLICATE_OVERLAP_ATTESTATION_MISMATCH");
  requireCondition(manifest.partitionAttestation.selectionAndHoldoutPatientIdentityVerified === protectedIdentityVerified, "DEVELOPMENT_PROTECTED_IDENTITY_ATTESTATION_MISMATCH");
  requireCondition(plain(manifest.partitionAttestation.roleRecordCounts), "DEVELOPMENT_PARTITION_ROLE_COUNTS_REQUIRED");
  requireCondition(stableJson(manifest.partitionAttestation.roleRecordCounts) === stableJson(roleRecordCounts), "DEVELOPMENT_PARTITION_ROLE_COUNTS_MISMATCH");
  return {
    schema: "ekg-development-partition-verification-v1",
    pass: true,
    totalRecordCount: rows.length,
    developmentRecordCount: roleRecordCounts.development,
    selectionRecordCount: roleRecordCounts.selection,
    lockedHoldoutRecordCount: roleRecordCounts.lockedHoldout,
    patientOverlapCount,
    exactWaveformOverlapCount,
    nearDuplicateOverlapCount,
    protectedIdentityVerified,
    ...digests,
    clinicalAccuracyClaimed: false,
  };
}

module.exports = { PARTITION_ROLES, partitionDigests, verifyDevelopmentPartition };
