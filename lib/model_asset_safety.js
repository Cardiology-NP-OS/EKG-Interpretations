"use strict";
const crypto = require("crypto");
const fs = require("fs");

const ASSET_GOVERNANCE = Object.freeze({
  authorityClass: "CHALLENGER_SAFETY_NONRUNTIME",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});
const ALLOWED_LICENSE_STATES = new Set(["COMPATIBLE","COMPATIBLE_WITH_ATTRIBUTION","APPROVED_INTERNAL_USE_ONLY"]);
function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function text(value, code) { requireCondition(typeof value === "string" && value.trim(), code); return value.trim(); }
function stringArray(value, code) {
  requireCondition(Array.isArray(value) && value.length > 0, code);
  return value.map(item => text(item, code));
}
function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
function validateAssetLocator(locator) {
  const value=text(locator,"MODEL_ASSET_LOCATOR_REQUIRED");
  requireCondition(!/^(?:https?|ftp|s3|gs):\/\//i.test(value),"MODEL_ASSET_MUTABLE_REMOTE_REJECTED");
  requireCondition(!value.includes("..") && !/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith("/"),"MODEL_ASSET_LOCATOR_UNSAFE");
  return value;
}
function validateModelAssetSpec(spec) {
  requireCondition(plain(spec),"MODEL_ASSET_SPEC_REQUIRED");
  const checkpointId=text(spec.checkpointId,"MODEL_ASSET_CHECKPOINT_ID");
  requireCondition(/^[A-Za-z0-9._:-]{3,160}$/.test(checkpointId),"MODEL_ASSET_CHECKPOINT_ID_FORMAT");
  requireCondition(typeof spec.sha256==="string" && /^[0-9a-f]{64}$/.test(spec.sha256),"MODEL_ASSET_SHA256");
  requireCondition(Number.isInteger(spec.bytes) && spec.bytes >= 0,"MODEL_ASSET_BYTES");
  const locator=validateAssetLocator(spec.locator);
  const codeLicense=text(spec.codeLicense,"MODEL_ASSET_CODE_LICENSE");
  const weightLicense=text(spec.weightLicense,"MODEL_ASSET_WEIGHT_LICENSE");
  const weightLicenseStatus=text(spec.weightLicenseStatus,"MODEL_ASSET_WEIGHT_LICENSE_STATUS");
  requireCondition(ALLOWED_LICENSE_STATES.has(weightLicenseStatus),"MODEL_ASSET_WEIGHT_LICENSE_NOT_ADMITTED");
  const preprocessingContract=text(spec.preprocessingContract,"MODEL_ASSET_PREPROCESSING_CONTRACT");
  const leads=stringArray(spec.leads,"MODEL_ASSET_LEADS");
  requireCondition(Number.isFinite(spec.sampleRateHz)&&spec.sampleRateHz>0,"MODEL_ASSET_SAMPLE_RATE");
  requireCondition(Number.isFinite(spec.durationSeconds)&&spec.durationSeconds>0,"MODEL_ASSET_DURATION");
  const trainingPopulations=stringArray(spec.trainingPopulations,"MODEL_ASSET_TRAINING_POPULATIONS");
  const labels=stringArray(spec.labels,"MODEL_ASSET_LABELS");
  const validationEvidence=text(spec.validationEvidence,"MODEL_ASSET_VALIDATION_EVIDENCE");
  const calibrationOrThresholdAssumptions=text(spec.calibrationOrThresholdAssumptions,"MODEL_ASSET_CALIBRATION_ASSUMPTIONS");
  const computeBurden=text(spec.computeBurden,"MODEL_ASSET_COMPUTE_BURDEN");
  const unsupportedPopulations=stringArray(spec.unsupportedPopulations,"MODEL_ASSET_UNSUPPORTED_POPULATIONS");
  const reproducibilityLimits=text(spec.reproducibilityLimits,"MODEL_ASSET_REPRODUCIBILITY_LIMITS");
  requireCondition(spec.serializationPolicy==="IDENTITY_ONLY_NO_DESERIALIZATION","MODEL_ASSET_UNSAFE_DESERIALIZATION_POLICY");
  return {checkpointId,sha256:spec.sha256,bytes:spec.bytes,locator,codeLicense,weightLicense,weightLicenseStatus,preprocessingContract,leads,sampleRateHz:spec.sampleRateHz,durationSeconds:spec.durationSeconds,trainingPopulations,labels,validationEvidence,calibrationOrThresholdAssumptions,computeBurden,unsupportedPopulations,reproducibilityLimits,serializationPolicy:spec.serializationPolicy};
}

function verifyModelAssetFile(spec, filePath, chunkBytes = 1024 * 1024) {
  const normalized=validateModelAssetSpec(spec);
  requireCondition(typeof filePath==="string" && filePath.length>0,"MODEL_ASSET_LOCAL_PATH_REQUIRED");
  requireCondition(Number.isInteger(chunkBytes) && chunkBytes>=4096,"MODEL_ASSET_CHUNK_BYTES_INVALID");
  const stat=fs.statSync(filePath);
  requireCondition(stat.isFile(),"MODEL_ASSET_LOCAL_FILE_REQUIRED");
  requireCondition(stat.size===normalized.bytes,"MODEL_ASSET_BYTE_COUNT_MISMATCH");
  const hash=crypto.createHash("sha256");
  const fd=fs.openSync(filePath,"r");
  const buffer=Buffer.allocUnsafe(Math.min(chunkBytes,Math.max(1,stat.size)));
  let position=0;
  try {
    while(position<stat.size){
      const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,stat.size-position),position);
      requireCondition(count>0,"MODEL_ASSET_FILE_READ_FAILURE");
      hash.update(buffer.subarray(0,count));
      position+=count;
    }
  } finally { fs.closeSync(fd); }
  const observed=hash.digest("hex");
  requireCondition(observed===normalized.sha256,"MODEL_ASSET_HASH_MISMATCH");
  return {
    schema:"ekg-model-asset-file-verification-v1",
    pass:true,
    checkpointId:normalized.checkpointId,
    locator:normalized.locator,
    sha256:observed,
    bytes:stat.size,
    streamedVerification:true,
    localPathEmbedded:false,
    executionStatus:"IDENTITY_VERIFIED_CHALLENGER_ONLY",
    deserializationPerformed:false,
    runtimeAuthority:false,
    ...ASSET_GOVERNANCE,
  };
}

function verifyModelAssetBytes(spec, bytes) {
  const normalized=validateModelAssetSpec(spec);
  requireCondition(Buffer.isBuffer(bytes),"MODEL_ASSET_BYTES_BUFFER_REQUIRED");
  requireCondition(bytes.length===normalized.bytes,"MODEL_ASSET_BYTE_COUNT_MISMATCH");
  const observed=sha256(bytes);
  requireCondition(observed===normalized.sha256,"MODEL_ASSET_HASH_MISMATCH");
  return {
    schema:"ekg-model-asset-verification-v1",
    pass:true,
    checkpointId:normalized.checkpointId,
    locator:normalized.locator,
    sha256:observed,
    bytes:bytes.length,
    executionStatus:"IDENTITY_VERIFIED_CHALLENGER_ONLY",
    deserializationPerformed:false,
    runtimeAuthority:false,
    ...ASSET_GOVERNANCE,
  };
}

module.exports={
  ALLOWED_LICENSE_STATES,
  ASSET_GOVERNANCE,
  sha256,
  validateAssetLocator,
  validateModelAssetSpec,
  verifyModelAssetBytes,
  verifyModelAssetFile,
};
