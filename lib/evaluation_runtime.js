"use strict";
const crypto = require("crypto");
const { validateDatasetDescriptor, validateProvenance, validateSplitManifest } = require("./evaluation_contract");

const EVALUATION_GOVERNANCE = Object.freeze({
  authorityClass: "EVALUATION_NONRUNTIME",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  sourceLabelsAreProjectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});
function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function nonempty(value, code) { requireCondition(typeof value === "string" && value.trim(), code); return value.trim(); }
function finiteSeries(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "EVAL_RUNTIME_VALUES_REQUIRED");
  return values.map(v => { requireCondition(typeof v === "number" && Number.isFinite(v), "EVAL_RUNTIME_NONFINITE"); return v; });
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function hashObject(value) { return sha256(Buffer.from(stableJson(value), "utf8")); }
function validateAnnotationContracts(contract) {
  requireCondition(plain(contract), "EVAL_ANNOTATION_CONTRACT_OBJECT");
  requireCondition(contract.projectGold === false, "EVAL_ANNOTATION_PROJECT_GOLD");
  requireCondition(contract.sourceLabelsAreProjectGold === false, "EVAL_ANNOTATION_SOURCE_LABEL_GOLD");
  requireCondition(Array.isArray(contract.annotationTypes) && contract.annotationTypes.length > 0, "EVAL_ANNOTATION_TYPES_REQUIRED");
  const types = new Set();
  for (const row of contract.annotationTypes) {
    requireCondition(plain(row), "EVAL_ANNOTATION_TYPE_OBJECT");
    const type = nonempty(row.type, "EVAL_ANNOTATION_TYPE");
    requireCondition(!types.has(type), "EVAL_ANNOTATION_TYPE_DUPLICATE");
    types.add(type);
    requireCondition(Array.isArray(row.uses) && row.uses.length > 0, "EVAL_ANNOTATION_USES_REQUIRED");
  }
  return types;
}
function ingestAnnotations(input, contract) {
  requireCondition(plain(input), "EVAL_ANNOTATION_INPUT");
  const types = validateAnnotationContracts(contract);
  const type = nonempty(input.type, "EVAL_ANNOTATION_TYPE");
  requireCondition(types.has(type), "EVAL_ANNOTATION_TYPE_UNSUPPORTED");
  validateProvenance(input.provenance);
  requireCondition(Array.isArray(input.annotations), "EVAL_ANNOTATIONS_REQUIRED");
  const rows = input.annotations.map((row, index) => {
    requireCondition(plain(row), "EVAL_ANNOTATION_ROW_OBJECT");
    const recordId = nonempty(row.recordId, "EVAL_ANNOTATION_RECORD_ID");
    requireCondition(Number.isInteger(row.sampleIndex) && row.sampleIndex >= 0, "EVAL_ANNOTATION_SAMPLE_INDEX");
    return { annotationId: row.annotationId || `${recordId}:${type}:${index}`, recordId, sampleIndex: row.sampleIndex, value: row.value ?? null };
  });
  return { schema:"ekg-annotation-ingestion-v1", type, rows, provenance:{...input.provenance}, ...EVALUATION_GOVERNANCE };
}
function validateCatalogCompatibilityEntry(entry) {
  requireCondition(plain(entry), "EVAL_CATALOG_ENTRY_OBJECT");
  nonempty(entry.datasetId, "EVAL_CATALOG_ENTRY_ID");
  nonempty(entry.name, "EVAL_CATALOG_ENTRY_NAME");
  nonempty(entry.canonicalSource, "EVAL_CATALOG_ENTRY_SOURCE");
  requireCondition(entry.projectGold === false, "EVAL_CATALOG_ENTRY_PROJECT_GOLD");
  requireCondition(entry.sourceLabelsAreProjectGold === false, "EVAL_CATALOG_ENTRY_SOURCE_LABEL_GOLD");
  requireCondition(entry.runtimeAuthority === false, "EVAL_CATALOG_ENTRY_RUNTIME_AUTHORITY");
  requireCondition(entry.clinicalValidityInferred === false, "EVAL_CATALOG_ENTRY_CLINICAL_VALIDITY");
  requireCondition(Array.isArray(entry.provenanceSources) && entry.provenanceSources.length > 0, "EVAL_CATALOG_ENTRY_PROVENANCE");
  entry.provenanceSources.forEach(validateProvenance);
  if (entry.datasetId.startsWith("ECG-DATASET-")) validateDatasetDescriptor(entry);
  else requireCondition(/^ECG-(?:ASSET-BUNDLE|SOURCE-CATALOG|DERIVED-ASSET)-[A-Z0-9-]+$/.test(entry.datasetId), "EVAL_CATALOG_COMPATIBILITY_ID_FORMAT");
  return true;
}
function validateDatasetCatalog(catalog) {
  requireCondition(plain(catalog), "EVAL_CATALOG_OBJECT");
  requireCondition(catalog.projectGold === false, "EVAL_CATALOG_PROJECT_GOLD");
  requireCondition(catalog.sourceLabelsAreProjectGold === false, "EVAL_CATALOG_SOURCE_LABEL_GOLD");
  requireCondition(catalog.runtimeAuthority === false, "EVAL_CATALOG_RUNTIME_AUTHORITY");
  requireCondition(Array.isArray(catalog.entries), "EVAL_CATALOG_ENTRIES");
  requireCondition(Number.isInteger(catalog.datasetCount) && catalog.datasetCount === catalog.entries.length, "EVAL_CATALOG_COUNT_MISMATCH");
  const ids = new Set(); let canonicalDatasetCount = 0, compatibilityCount = 0;
  for (const entry of catalog.entries) {
    validateCatalogCompatibilityEntry(entry);
    requireCondition(!ids.has(entry.datasetId), "EVAL_CATALOG_DUPLICATE_DATASET"); ids.add(entry.datasetId);
    if (entry.datasetId.startsWith("ECG-DATASET-")) canonicalDatasetCount += 1; else compatibilityCount += 1;
  }
  requireCondition(catalog.canonicalDatasetCount === canonicalDatasetCount, "EVAL_CATALOG_CANONICAL_COUNT_MISMATCH");
  requireCondition(catalog.sourceAssetCompatibilityCount === compatibilityCount, "EVAL_CATALOG_COMPATIBILITY_COUNT_MISMATCH");
  return { schema:"ekg-dataset-catalog-validation-v1", pass:true, datasetCount:ids.size, canonicalDatasetCount, compatibilityCount, ...EVALUATION_GOVERNANCE };
}
function validateDatasetBundle(descriptor, splitManifest) {
  validateDatasetDescriptor(descriptor);
  const split = validateSplitManifest(splitManifest);
  return { schema:"ekg-dataset-bundle-validation-v1", pass:true, datasetId:descriptor.datasetId, split, ...EVALUATION_GOVERNANCE };
}
function findDataset(catalog, datasetId) {
  validateDatasetCatalog(catalog);
  const id = nonempty(datasetId, "EVAL_CATALOG_DATASET_ID");
  const matches = catalog.entries.filter(row => row.datasetId === id);
  requireCondition(matches.length === 1, matches.length ? "EVAL_CATALOG_DUPLICATE_DATASET" : "EVAL_CATALOG_DATASET_NOT_FOUND");
  return matches[0];
}
function harmonizeLabels(labels, mapping) {
  requireCondition(Array.isArray(labels), "EVAL_LABELS_REQUIRED");
  requireCondition(plain(mapping) && Object.keys(mapping).length > 0, "EVAL_LABEL_MAPPING_REQUIRED");
  const normalized = {};
  for (const [source, target] of Object.entries(mapping)) normalized[nonempty(source,"EVAL_LABEL_SOURCE")] = nonempty(target,"EVAL_LABEL_TARGET");
  return labels.map(label => {
    const source = nonempty(label, "EVAL_LABEL_VALUE");
    requireCondition(Object.prototype.hasOwnProperty.call(normalized, source), `EVAL_LABEL_UNMAPPED:${source}`);
    return normalized[source];
  });
}
function safeRatio(numerator, denominator) { return denominator === 0 ? null : numerator / denominator; }
function computeBinaryMetrics(input) {
  requireCondition(plain(input), "EVAL_METRIC_INPUT");
  requireCondition(input.projectGold === false, "EVAL_METRIC_PROJECT_GOLD");
  requireCondition(input.sourceLabelsAreProjectGold === false, "EVAL_METRIC_SOURCE_LABEL_GOLD");
  requireCondition(Array.isArray(input.truth) && Array.isArray(input.predictions) && input.truth.length > 0, "EVAL_METRIC_ARRAYS_REQUIRED");
  requireCondition(input.truth.length === input.predictions.length, "EVAL_METRIC_LENGTH_MISMATCH");
  let tp=0,tn=0,fp=0,fn=0;
  input.truth.forEach((truth,index)=>{
    const pred=input.predictions[index];
    requireCondition(typeof truth === "boolean" && typeof pred === "boolean", "EVAL_METRIC_BOOLEAN_REQUIRED");
    if(truth&&pred) tp+=1; else if(!truth&&!pred) tn+=1; else if(!truth&&pred) fp+=1; else fn+=1;
  });
  const precision=safeRatio(tp,tp+fp), sensitivity=safeRatio(tp,tp+fn);
  const f1=precision===null||sensitivity===null||precision+sensitivity===0?null:2*precision*sensitivity/(precision+sensitivity);
  return { schema:"ekg-nonreportable-binary-metrics-v1", counts:{tp,tn,fp,fn,total:input.truth.length}, precision, sensitivity, f1, accuracy:safeRatio(tp+tn,input.truth.length), reportable:false, ...EVALUATION_GOVERNANCE };
}
function failureModeById(catalog, id) {
  requireCondition(plain(catalog) && Array.isArray(catalog.items), "EVAL_FAILURE_CATALOG");
  const key=nonempty(id,"EVAL_FAILURE_ID");
  const matches=catalog.items.filter(row=>row.id===key);
  requireCondition(matches.length===1, matches.length?"EVAL_FAILURE_DUPLICATE":"EVAL_FAILURE_NOT_FOUND");
  return matches[0];
}
function validateBenchmarkPlan(plan, catalog) {
  requireCondition(plain(plan) && plain(catalog) && Array.isArray(catalog.contracts), "EVAL_BENCHMARK_PLAN");
  const id=nonempty(plan.contractId,"EVAL_BENCHMARK_CONTRACT_ID");
  const contract=catalog.contracts.find(row=>row.id===id);
  requireCondition(contract,"EVAL_BENCHMARK_CONTRACT_NOT_FOUND");
  requireCondition(Array.isArray(plan.requirementsSatisfied),"EVAL_BENCHMARK_REQUIREMENTS");
  const satisfied=new Set(plan.requirementsSatisfied);
  const missing=contract.requirements.filter(req=>!satisfied.has(req));
  requireCondition(missing.length===0,`EVAL_BENCHMARK_REQUIREMENT_MISSING:${missing.join("|")}`);
  return { schema:"ekg-benchmark-plan-validation-v1", pass:true, contractId:id, reportable:false, ...EVALUATION_GOVERNANCE };
}
function buildReproducibilityFingerprint(input) {
  requireCondition(plain(input), "EVAL_REPRO_INPUT");
  const sourceCommit=nonempty(input.sourceCommit,"EVAL_REPRO_SOURCE_COMMIT");
  const sourceTree=nonempty(input.sourceTree,"EVAL_REPRO_SOURCE_TREE");
  requireCondition(/^[0-9a-f]{40}$/.test(sourceCommit),"EVAL_REPRO_SOURCE_COMMIT_FORMAT");
  requireCondition(/^[0-9a-f]{40}$/.test(sourceTree),"EVAL_REPRO_SOURCE_TREE_FORMAT");
  requireCondition(plain(input.config),"EVAL_REPRO_CONFIG_REQUIRED");
  requireCondition(plain(input.artifacts),"EVAL_REPRO_ARTIFACTS_REQUIRED");
  for(const [name,hash] of Object.entries(input.artifacts)){
    nonempty(name,"EVAL_REPRO_ARTIFACT_NAME");
    requireCondition(typeof hash==="string" && /^[0-9a-f]{64}$/.test(hash),`EVAL_REPRO_ARTIFACT_HASH:${name}`);
  }
  requireCondition(Number.isInteger(input.seed) || typeof input.seed === "string", "EVAL_REPRO_SEED_REQUIRED");
  const payload={sourceCommit,sourceTree,seed:input.seed,config:input.config,artifacts:input.artifacts,preprocessingContract:input.preprocessingContract||null};
  return { schema:"ekg-reproducibility-fingerprint-v1", fingerprintSha256:hashObject(payload), payload, mutableRemoteResolution:false, ...EVALUATION_GOVERNANCE };
}
function perturbSignal(values, operation) {
  const source=finiteSeries(values);
  requireCondition(plain(operation),"EVAL_ROBUST_OPERATION");
  const method=nonempty(operation.method,"EVAL_ROBUST_METHOD");
  if(method==="add-offset-v1"){
    requireCondition(Number.isFinite(operation.value),"EVAL_ROBUST_OFFSET");
    return source.map(v=>v+operation.value);
  }
  if(method==="scale-v1"){
    requireCondition(Number.isFinite(operation.factor),"EVAL_ROBUST_SCALE");
    return source.map(v=>v*operation.factor);
  }
  if(method==="mask-range-v1"){
    requireCondition(Number.isInteger(operation.start)&&Number.isInteger(operation.end)&&operation.start>=0&&operation.end>operation.start&&operation.end<=source.length,"EVAL_ROBUST_MASK_RANGE");
    requireCondition(Number.isFinite(operation.fill),"EVAL_ROBUST_MASK_FILL");
    return source.map((v,i)=>i>=operation.start&&i<operation.end?operation.fill:v);
  }
  if(method==="crop-v1"){
    requireCondition(Number.isInteger(operation.start)&&Number.isInteger(operation.end)&&operation.start>=0&&operation.end>operation.start&&operation.end<=source.length,"EVAL_ROBUST_CROP_RANGE");
    return source.slice(operation.start,operation.end);
  }
  if(method==="deterministic-additive-noise-v1"){
    const noise=finiteSeries(operation.noise);
    requireCondition(noise.length===source.length,"EVAL_ROBUST_NOISE_LENGTH");
    return source.map((v,i)=>v+noise[i]);
  }
  throw new Error("EVAL_ROBUST_METHOD_UNIMPLEMENTED");
}
function compareFeatureRows(input) {
  requireCondition(plain(input), "EVAL_FEATURE_INPUT");
  requireCondition(Array.isArray(input.reference) && Array.isArray(input.candidate), "EVAL_FEATURE_ROWS_REQUIRED");
  requireCondition(Array.isArray(input.featureNames) && input.featureNames.length > 0, "EVAL_FEATURE_NAMES_REQUIRED");
  const makeMap=(rows,label)=>{ const map=new Map(); for(const row of rows){ requireCondition(plain(row), "EVAL_FEATURE_ROW_OBJECT"); const id=nonempty(row.recordId,"EVAL_FEATURE_RECORD_ID"); requireCondition(!map.has(id),"EVAL_FEATURE_DUPLICATE_"+label); requireCondition(plain(row.features),"EVAL_FEATURE_VALUES_OBJECT"); map.set(id,row.features); } return map; };
  const reference=makeMap(input.reference,"REFERENCE"), candidate=makeMap(input.candidate,"CANDIDATE");
  const recordIds=[...reference.keys()].filter(id=>candidate.has(id)).sort();
  requireCondition(recordIds.length > 0, "EVAL_FEATURE_NO_COHORT_INTERSECTION");
  const features={};
  for(const name of input.featureNames){ nonempty(name,"EVAL_FEATURE_NAME"); let count=0, missing=0, abs=0, sq=0, delta=0;
    for(const id of recordIds){ const a=reference.get(id)[name], b=candidate.get(id)[name]; if(!(typeof a==="number"&&Number.isFinite(a)&&typeof b==="number"&&Number.isFinite(b))){ missing+=1; continue; } const d=b-a; count+=1; abs+=Math.abs(d); sq+=d*d; delta+=d; }
    features[name]={count,missing,mae:count?abs/count:null,rmse:count?Math.sqrt(sq/count):null,meanDelta:count?delta/count:null};
  }
  return { schema:"ekg-feature-benchmark-v1", sameRecordCohortCount:recordIds.length, recordIds, missingReferenceRecords:[...candidate.keys()].filter(id=>!reference.has(id)).sort(), missingCandidateRecords:[...reference.keys()].filter(id=>!candidate.has(id)).sort(), features, reportable:false, ...EVALUATION_GOVERNANCE };
}

module.exports = {
  EVALUATION_GOVERNANCE,
  buildReproducibilityFingerprint,
  compareFeatureRows,
  computeBinaryMetrics,
  failureModeById,
  findDataset,
  harmonizeLabels,
  hashObject,
  ingestAnnotations,
  perturbSignal,
  sha256,
  stableJson,
  validateAnnotationContracts,
  validateBenchmarkPlan,
  validateCatalogCompatibilityEntry,
  validateDatasetBundle,
  validateDatasetCatalog,
};
