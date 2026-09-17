"use strict";
const fs = require("fs");
const path = require("path");

const EXECUTABLE_STATUSES = new Set([
  "TARGET_OWNED_IMPLEMENTATION",
  "TARGET_OWNED_EVALUATION_IMPLEMENTATION",
]);
const CLASS_BY_STATUS = Object.freeze({
  TARGET_OWNED_EVALUATION_CONTRACT: "CONTRACT_ONLY_NONRUNTIME",
  TARGET_OWNED_RESEARCH_REPRESENTATION: "RESEARCH_REFERENCE_NONRUNTIME",
  TARGET_OWNED_GOVERNANCE_REPRESENTATION: "GOVERNANCE_ONLY",
  CHALLENGER_METADATA_ONLY: "CHALLENGER_METADATA_BLOCKED",
  TARGET_OWNED_PREPROCESSING_CONTRACT: "IMPLEMENTATION_REQUIRED_NOW",
});
function classifyCapability(capability) {
  if (EXECUTABLE_STATUSES.has(capability.implementation_status)) return "EXECUTABLE_TARGET_OWNED";
  const value = CLASS_BY_STATUS[capability.implementation_status];
  if (!value) throw new Error(`READINESS_UNKNOWN_IMPLEMENTATION_STATUS:${capability.implementation_status}`);
  return value;
}
function exists(root, relativePath) {
  return typeof relativePath === "string" && fs.existsSync(path.join(root, relativePath));
}
function validateExecutable(root, capability) {
  if (!exists(root, capability.canonical_target_path)) throw new Error(`READINESS_TARGET_MISSING:${capability.capability_id}`);
  if (!capability.canonical_target_path.startsWith("lib/") || !capability.canonical_target_path.endsWith(".js"))
    throw new Error(`READINESS_EXECUTABLE_TARGET_NOT_CODE:${capability.capability_id}`);
  if (!Array.isArray(capability.test_paths) || capability.test_paths.length === 0)
    throw new Error(`READINESS_EXECUTABLE_TESTS_REQUIRED:${capability.capability_id}`);
  for (const testPath of capability.test_paths)
    if (!exists(root, testPath)) throw new Error(`READINESS_EXECUTABLE_TEST_MISSING:${capability.capability_id}:${testPath}`);
}
function auditRegistry(root, registry) {
  const counts = {};
  const rows = registry.capabilities.map(capability => {
    const readiness = classifyCapability(capability);
    counts[readiness] = (counts[readiness] || 0) + 1;
    if (!exists(root, capability.canonical_target_path))
      throw new Error(`READINESS_TARGET_MISSING:${capability.capability_id}`);
    if (readiness === "EXECUTABLE_TARGET_OWNED") validateExecutable(root, capability);
    return {
      capabilityId: capability.capability_id,
      name: capability.name,
      readiness,
      implementationStatus: capability.implementation_status,
      canonicalTargetPath: capability.canonical_target_path,
      authorityClass: capability.authority_class,
      runtimeStatus: capability.runtime_status,
    };
  });
  for (const key of [
    "EXECUTABLE_TARGET_OWNED","IMPLEMENTATION_REQUIRED_NOW","CONTRACT_ONLY_NONRUNTIME",
    "RESEARCH_REFERENCE_NONRUNTIME","GOVERNANCE_ONLY","CHALLENGER_METADATA_BLOCKED",
  ]) if (counts[key] === undefined) counts[key] = 0;
  return { counts, rows };
}
function currentActionableGaps(audit) {
  return audit.rows.filter(row => row.readiness === "IMPLEMENTATION_REQUIRED_NOW").map(row => row.capabilityId).sort();
}
function donorResumeEligible(audit, safeQueue = []) {
  return currentActionableGaps(audit).length === 0 && Array.isArray(safeQueue) && safeQueue.length === 0;
}
if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const registry = JSON.parse(fs.readFileSync(path.join(root,"ECG_CAPABILITY_REGISTRY.json"),"utf8").replace(/^\uFEFF/,""));
  const audit = auditRegistry(root, registry);
  process.stdout.write(JSON.stringify({
    schema: "ekg-execution-readiness-audit-v2",
    canonicalCapabilityCount: registry.capability_count,
    ...audit,
    implementationRequiredNow: currentActionableGaps(audit),
    diagnosticRuntime: "GOVERNED_INACTIVE",
    evidenceAdmission: "NOT_ADMITTED",
    approvedAdjudicatedGoldCount: 0,
    metrics: "NOT_REPORTABLE",
    activation: "NOT_ELIGIBLE",
    clinicalValidity: "NOT_INFERRED"
  }, null, 2) + "\n");
}
module.exports = { auditRegistry, classifyCapability, currentActionableGaps, donorResumeEligible };
