"use strict";
const crypto=require("crypto");

const REQUIRED_GOVERNED_STATE=Object.freeze({
  specialistState:"SPECIALIST_COMPLETE_INACTIVE",
  diagnosticRuntime:"GOVERNED_INACTIVE",
  evidenceAdmission:"NOT_ADMITTED",
  approvedAdjudicatedGoldCount:0,
  metrics:"NOT_REPORTABLE",
  activation:"NOT_ELIGIBLE",
  clinicalValidity:"NOT_INFERRED",
});
function requireCondition(condition,code){if(!condition)throw new Error(code);}
function plain(value){return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function text(value,code){requireCondition(typeof value==="string"&&value.trim(),code);return value.trim();}
function sha256(bytes){return crypto.createHash("sha256").update(bytes).digest("hex");}
function stableJson(value){
  if(Array.isArray(value))return `[${value.map(stableJson).join(",")}]`;
  if(plain(value))return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function assertGovernedInactiveState(state){
  requireCondition(plain(state),"GOVERNANCE_STATE_REQUIRED");
  for(const [key,value] of Object.entries(REQUIRED_GOVERNED_STATE)) requireCondition(state[key]===value,`GOVERNANCE_STATE_MISMATCH:${key}`);
  return {schema:"ekg-governed-state-validation-v1",pass:true,...REQUIRED_GOVERNED_STATE};
}
function validateSourceIdentity(identity){
  requireCondition(plain(identity),"GOVERNANCE_SOURCE_IDENTITY_REQUIRED");
  const commit=text(identity.commit,"GOVERNANCE_SOURCE_COMMIT");
  const tree=text(identity.tree,"GOVERNANCE_SOURCE_TREE");
  requireCondition(/^[0-9a-f]{40}$/.test(commit),"GOVERNANCE_SOURCE_COMMIT_FORMAT");
  requireCondition(/^[0-9a-f]{40}$/.test(tree),"GOVERNANCE_SOURCE_TREE_FORMAT");
  if(identity.sha256!==undefined)requireCondition(typeof identity.sha256==="string"&&/^[0-9a-f]{64}$/.test(identity.sha256),"GOVERNANCE_SOURCE_SHA256_FORMAT");
  if(identity.locator!==undefined){const locator=text(identity.locator,"GOVERNANCE_SOURCE_LOCATOR");requireCondition(!/^(?:https?|ftp|s3|gs):\/\//i.test(locator),"GOVERNANCE_MUTABLE_REMOTE_REJECTED");}
  return {commit,tree,sha256:identity.sha256||null,locator:identity.locator||null};
}
function unresolvedStatus(value){return typeof value!=="string"||/LICENSE_REVIEW_REQUIRED|UNKNOWN|NOT_ESTABLISHED/i.test(value);}
function validateLicenseLedger(ledger){
  requireCondition(plain(ledger)&&ledger.schema==="ecg-license-ledger-v1","GOVERNANCE_LICENSE_LEDGER_SCHEMA");
  requireCondition(ledger.fail_closed_on_unknown_license===true,"GOVERNANCE_LICENSE_FAIL_CLOSED_REQUIRED");
  requireCondition(Array.isArray(ledger.entries)&&ledger.entries.length>0,"GOVERNANCE_LICENSE_ENTRIES");
  const seen=new Set(),unresolved=[];
  for(const entry of ledger.entries){
    requireCondition(plain(entry),"GOVERNANCE_LICENSE_ENTRY");
    const id=text(entry.donor_id,"GOVERNANCE_LICENSE_DONOR_ID");requireCondition(!seen.has(id),"GOVERNANCE_LICENSE_DUPLICATE_DONOR");seen.add(id);
    text(entry.repository,"GOVERNANCE_LICENSE_REPOSITORY");
    const sourceStatus=entry.source_code_license&&entry.source_code_license.status;
    if(unresolvedStatus(sourceStatus))unresolved.push({donorId:id,assetClass:"source_code",status:sourceStatus||"UNSPECIFIED"});
    const data=entry.dataset_fixture_license;if(data&&data.imported===true)requireCondition(!unresolvedStatus(data.status),"GOVERNANCE_UNLICENSED_DATA_IMPORTED");
    const model=entry.model_weight_license;if(model&&model.weights_imported===true)requireCondition(!unresolvedStatus(model.status),"GOVERNANCE_UNLICENSED_MODEL_IMPORTED");
    if(entry.copied_source_code===true)requireCondition(!unresolvedStatus(sourceStatus),"GOVERNANCE_UNLICENSED_SOURCE_COPIED");
  }
  return {schema:"ekg-license-ledger-validation-v1",pass:true,entryCount:seen.size,unresolved,failClosedOnUnknownLicense:true};
}
function buildDependencyFingerprint(input){
  requireCondition(plain(input),"GOVERNANCE_DEPENDENCY_INPUT");
  requireCondition(Buffer.isBuffer(input.packageJsonBytes),"GOVERNANCE_PACKAGE_BYTES");
  requireCondition(plain(input.runtimeVersions)&&Object.keys(input.runtimeVersions).length>0,"GOVERNANCE_RUNTIME_VERSIONS");
  requireCondition(plain(input.artifactHashes),"GOVERNANCE_ARTIFACT_HASHES");
  for(const [name,hash] of Object.entries(input.artifactHashes)){
    text(name,"GOVERNANCE_ARTIFACT_NAME");
    requireCondition(typeof hash==="string"&&/^[0-9a-f]{64}$/.test(hash),`GOVERNANCE_ARTIFACT_HASH:${name}`);
  }
  const payload={
    packageJsonSha256:sha256(input.packageJsonBytes),
    packageLockSha256:input.packageLockBytes?sha256(input.packageLockBytes):null,
    runtimeVersions:input.runtimeVersions,
    artifactHashes:input.artifactHashes,
    mutableRemoteResolution:false,
  };
  return {schema:"ekg-dependency-fingerprint-v1",fingerprintSha256:sha256(Buffer.from(stableJson(payload),"utf8")),payload};
}
module.exports={
  REQUIRED_GOVERNED_STATE,
  assertGovernedInactiveState,
  buildDependencyFingerprint,
  sha256,
  stableJson,
  validateLicenseLedger,
  validateSourceIdentity,
};
