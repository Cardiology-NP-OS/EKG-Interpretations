"use strict";
const crypto=require("crypto");
const fs=require("fs");
const path=require("path");
const {validateSplitManifest}=require("./evaluation_contract");

const LOADER_GOVERNANCE=Object.freeze({authorityClass:"NONCLINICAL_ENGINEERING",runtimeAuthority:false,diagnosticRuntime:"GOVERNED_INACTIVE",evidenceAdmission:"NOT_ADMITTED",projectGold:false,sourceLabelsAreProjectGold:false,metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinicalValidityInferred:false});
const SPLITS=new Set(["train","validation","test"]);
function requireCondition(condition,code){if(!condition)throw new Error(code);}
function plain(value){return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function text(value,code){requireCondition(typeof value==="string"&&value.trim(),code);return value.trim();}
function safeRelativeFile(value){
  const p=text(value,"DATASET_LOADER_PATH_REQUIRED");
  requireCondition(!path.isAbsolute(p)&&!/^[A-Za-z]:/.test(p),"DATASET_LOADER_ABSOLUTE_PATH");
  const normalized=p.replace(/\\/g,"/");
  requireCondition(!normalized.split("/").includes("..")&&!normalized.startsWith("/"),"DATASET_LOADER_PATH_TRAVERSAL");
  return normalized;
}
function sha256(bytes){return crypto.createHash("sha256").update(bytes).digest("hex");}
function validateHash(value,code){requireCondition(typeof value==="string"&&/^[0-9a-f]{64}$/.test(value),code);return value;}
function resolveWithin(root,relative){
  const base=path.resolve(root), target=path.resolve(base,relative);
  const prefix=base.endsWith(path.sep)?base:base+path.sep;
  requireCondition(target.startsWith(prefix),"DATASET_LOADER_RESOLUTION_ESCAPE");
  return target;
}function validateLocalDatasetManifest(manifest){
  requireCondition(plain(manifest),"DATASET_LOADER_MANIFEST");
  const datasetId=text(manifest.datasetId,"DATASET_LOADER_DATASET_ID");
  requireCondition(/^ECG-DATASET-[A-Z0-9-]+$/.test(datasetId),"DATASET_LOADER_DATASET_ID_FORMAT");
  requireCondition(manifest.projectGold===false,"DATASET_LOADER_PROJECT_GOLD");
  requireCondition(manifest.sourceLabelsAreProjectGold===false,"DATASET_LOADER_SOURCE_LABEL_GOLD");
  requireCondition(Array.isArray(manifest.records)&&manifest.records.length>0,"DATASET_LOADER_RECORDS");
  const seen=new Set();
  const records=manifest.records.map(record=>{
    requireCondition(plain(record),"DATASET_LOADER_RECORD_OBJECT");
    const recordId=text(record.recordId,"DATASET_LOADER_RECORD_ID");
    requireCondition(!seen.has(recordId),"DATASET_LOADER_DUPLICATE_RECORD"); seen.add(recordId);
    requireCondition(SPLITS.has(record.split),"DATASET_LOADER_SPLIT");
    const patientId=record.patientId===undefined||record.patientId===null?null:text(String(record.patientId),"DATASET_LOADER_PATIENT_ID");
    const headerFile=safeRelativeFile(record.headerFile), dataFile=safeRelativeFile(record.dataFile);
    requireCondition(headerFile!==dataFile,"DATASET_LOADER_FILE_COLLISION");
    requireCondition(Number.isInteger(record.headerBytes)&&record.headerBytes>0,"DATASET_LOADER_HEADER_BYTES");
    requireCondition(Number.isInteger(record.dataBytes)&&record.dataBytes>0,"DATASET_LOADER_DATA_BYTES");
    return {recordId,patientId,split:record.split,headerFile,dataFile,headerBytes:record.headerBytes,dataBytes:record.dataBytes,headerSha256:validateHash(record.headerSha256,"DATASET_LOADER_HEADER_HASH"),dataSha256:validateHash(record.dataSha256,"DATASET_LOADER_DATA_HASH")};
  });
  validateSplitManifest({records:records.map(r=>({recordId:r.recordId,patientId:r.patientId,split:r.split})),sourceLabelsAreProjectGold:false,projectGold:false});
  return {datasetId,records};
}
function readExactFile(file,expectedBytes,expectedHash,codePrefix){
  const stat=fs.lstatSync(file);
  requireCondition(stat.isFile()&&!stat.isSymbolicLink(),`${codePrefix}_NOT_REGULAR_FILE`);
  requireCondition(stat.size===expectedBytes,`${codePrefix}_BYTE_COUNT_MISMATCH`);
  const bytes=fs.readFileSync(file);
  requireCondition(sha256(bytes)===expectedHash,`${codePrefix}_HASH_MISMATCH`);
  return bytes;
}
function loadLocalDatasetRecord(root,manifest,recordId){
  const normalized=validateLocalDatasetManifest(manifest);
  const id=text(recordId,"DATASET_LOADER_RECORD_ID");
  const record=normalized.records.find(r=>r.recordId===id);
  requireCondition(record,"DATASET_LOADER_RECORD_NOT_FOUND");
  const headerPath=resolveWithin(root,record.headerFile), dataPath=resolveWithin(root,record.dataFile);
  const headerBytes=readExactFile(headerPath,record.headerBytes,record.headerSha256,"DATASET_LOADER_HEADER");
  const dataBytes=readExactFile(dataPath,record.dataBytes,record.dataSha256,"DATASET_LOADER_DATA");
  return {
    schema:"ekg-local-dataset-record-v1",
    datasetId:normalized.datasetId,recordId:record.recordId,patientId:record.patientId,split:record.split,
    headerText:headerBytes.toString("utf8"),dataBuffer:dataBytes,
    sourceFiles:{headerFile:record.headerFile,dataFile:record.dataFile,headerSha256:record.headerSha256,dataSha256:record.dataSha256,pathsAreManifestRelative:true},
    ...LOADER_GOVERNANCE,
  };
}
module.exports={LOADER_GOVERNANCE,loadLocalDatasetRecord,resolveWithin,safeRelativeFile,sha256,validateLocalDatasetManifest};
