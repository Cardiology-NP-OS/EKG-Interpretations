"use strict";
const fs=require("fs"), crypto=require("crypto"), {types}=require("util");
const {runPhysicalLeadMeasurementPipeline}=require("./signal_measurement_pipeline");
const {extractRhythmFeatures}=require("./rhythm_feature_contract");
const {evaluateCandidatePhenotypes}=require("./candidate_phenotype_engine");
const GOVERNANCE=Object.freeze({runtimeAuthority:false,projectGold:false,diagnosticRuntime:"GOVERNED_INACTIVE",evidenceAdmission:"NOT_ADMITTED",metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinicalValidityInferred:false});
const hash=raw=>crypto.createHash("sha256").update(raw).digest("hex");
function check(ok,code){if(!ok)throw Error(code);}
function exact(obj,keys,code){check(obj&&typeof obj==="object"&&!Array.isArray(obj)&&Object.keys(obj).sort().join("|")===keys.slice().sort().join("|"),code);}
function data(value,depth=0,budget={nodes:0}){
  check(depth<=32&&++budget.nodes<=100000,"IMAGE_CONFIG_DATA");
  if(value===null||typeof value==="string"||typeof value==="boolean")return;
  if(typeof value==="number"){check(Number.isFinite(value),"IMAGE_CONFIG_DATA");return;}
  check(typeof value==="object"&&!types.isProxy(value),"IMAGE_CONFIG_DATA");
  check(Object.getPrototypeOf(value)===(Array.isArray(value)?Array.prototype:Object.prototype),"IMAGE_CONFIG_DATA");
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors)){
    if(Array.isArray(value)&&key==="length")continue;
    check(typeof key==="string"&&Object.hasOwn(descriptors[key],"value")&&descriptors[key].enumerable,"IMAGE_CONFIG_DATA");
    if(depth>0&&Object.hasOwn(GOVERNANCE,key))check(descriptors[key].value===GOVERNANCE[key],"IMAGE_CONFIG_GOVERNANCE");
    data(descriptors[key].value,depth+1,budget);
  }
  if(Array.isArray(value))check(Object.keys(value).length===value.length,"IMAGE_CONFIG_DATA");
}
function positive(value){return typeof value==="number"&&Number.isFinite(value)&&value>0;}
function analyzeExtractedImageLeads(raw,config){
  data(config);
  exact(config,["measurement","phenotypes","thresholdAuthority","maxAmplitudeUncertaintyMv","maxTimePixelUncertaintyMs"],"IMAGE_CONFIG_FIELDS");
  check(typeof config.thresholdAuthority==="string"&&config.thresholdAuthority.trim().length>0&&config.thresholdAuthority.length<=1024,"IMAGE_THRESHOLD_AUTHORITY");
  check(positive(config.maxAmplitudeUncertaintyMv)&&positive(config.maxTimePixelUncertaintyMs),"IMAGE_QUALITY_CONFIG");
  check(Buffer.isBuffer(raw)&&raw.length<=32*1024*1024&&raw.every(byte=>byte<128),"IMAGE_EXTRACTION_BYTES");
  let extraction;try{extraction=JSON.parse(raw.toString("utf8"));}catch(_){throw Error("IMAGE_EXTRACTION_JSON");}
  for(const [key,value] of Object.entries(GOVERNANCE))check(extraction&&extraction[key]===value,"IMAGE_EXTRACTION_GOVERNANCE");
  check(extraction.schema==="ekg-image-extraction-v1"&&/^case-[a-f0-9]{64}$/.test(extraction.caseId)&&/^extract-[a-f0-9]{64}$/.test(extraction.extractionId),"IMAGE_EXTRACTION_IDENTITY");
  // Verify the exact Python canonical bytes, preserving its float representation.
  const token='"extractionId":"'+extraction.extractionId+'",', text=raw.toString("ascii");
  check(text.split(token).length===2&&hash(text.replace(token,""))===extraction.extractionId.slice(8),"IMAGE_EXTRACTION_IDENTITY");
  check(extraction.calibrationUserConfirmed===true&&extraction.automaticCalibration===false&&extraction.automaticLeadIdentification===false&&extraction.simultaneousLeadComparisonPerformed===false,"IMAGE_EXTRACTION_CALIBRATION");
  check(Array.isArray(extraction.leads)&&extraction.leads.length>=1&&extraction.leads.length<=12,"IMAGE_EXTRACTION_LEADS");
  const seen=new Set(),leadAnalyses=[],failures=[],extractionSha256=hash(raw);
  for(const lead of extraction.leads){
    check(["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"].includes(lead.leadName)&&!seen.has(lead.leadName),"IMAGE_EXTRACTION_LEAD_ID");seen.add(lead.leadName);
    check(lead.unit==="mV"&&positive(lead.sampleRateHz)&&lead.calibration&&lead.calibration.confirmed===true&&lead.sampleRateHz===lead.calibration.pixelsPerSecond&&positive(lead.calibration.pixelsPerMv),"IMAGE_EXTRACTION_CALIBRATION");
    check(Array.isArray(lead.samples)&&lead.sourceRegion&&lead.samples.length===lead.sourceRegion.width&&lead.samples.every(Number.isFinite)&&lead.durationSeconds===lead.samples.length/lead.sampleRateHz,"IMAGE_EXTRACTION_SAMPLES");
    const quality=lead.quality;
    check(quality&&quality.coverage===1&&quality.interpolatedColumns===0&&positive(quality.maxAmplitudeUncertaintyMv)&&positive(quality.timePixelUncertaintyMs)&&quality.maxAmplitudeUncertaintyMv===quality.maxStrokeThicknessPx/2/lead.calibration.pixelsPerMv&&quality.timePixelUncertaintyMs===500/lead.sampleRateHz,"IMAGE_EXTRACTION_QUALITY");
    if(quality.maxAmplitudeUncertaintyMv>config.maxAmplitudeUncertaintyMv||quality.timePixelUncertaintyMs>config.maxTimePixelUncertaintyMs){failures.push({leadName:lead.leadName,reason:"IMAGE_MEASUREMENT_QUALITY_GATE"});continue;}
    try{
      const measurement=runPhysicalLeadMeasurementPipeline({physicalLead:{record:extraction.caseId+":"+lead.leadName,leadName:lead.leadName,sampleRateHz:lead.sampleRateHz,samples:lead.samples,unit:"mV",calibration:lead.calibration},config:config.measurement,provenance:{sourceKind:"CALIBRATED_IMAGE_TRACE",locator:extraction.caseId+"/"+extraction.extractionId+"/"+lead.leadName,sourceSha256:extraction.sourceSha256,extractionSha256,thresholdAuthority:config.thresholdAuthority,...GOVERNANCE}});
      const features=extractRhythmFeatures(measurement),candidatePhenotypes=evaluateCandidatePhenotypes(features,config.phenotypes);
      leadAnalyses.push({leadName:lead.leadName,startTimeSeconds:lead.startTimeSeconds,durationSeconds:lead.durationSeconds,sourceRegion:lead.sourceRegion,calibration:lead.calibration,extractionQuality:quality,measurement,features,candidatePhenotypes});
    }catch(exc){const reason=/^[A-Z0-9_]+$/.test(exc.message)?exc.message:"IMAGE_MEASUREMENT_FAILED";failures.push({leadName:lead.leadName,reason});}
  }
  check(leadAnalyses.length>0,"IMAGE_MEASUREMENT_NO_USABLE_LEADS:"+failures.map(x=>x.reason).join(","));
  const implementations=[__filename,...["signal_measurement_pipeline","signal_measurement_contract","signal_delineation_contract","wfdb_signal","rhythm_feature_contract","candidate_phenotype_engine"].map(name=>require.resolve("./"+name))].map(filename=>({file:require("path").basename(filename),sha256:hash(fs.readFileSync(filename))}));
  return {schema:"ekg-image-signal-analysis-v1",caseId:extraction.caseId,extractionId:extraction.extractionId,sourceSha256:extraction.sourceSha256,extractionSha256,status:failures.length?"PARTIAL":"COMPLETE",attemptedLeadCount:extraction.leads.length,completeTwelveLead:leadAnalyses.length===12,leadAnalyses,failures,thresholdAuthority:config.thresholdAuthority,configuration:config,implementations,simultaneousLeadComparisonPerformed:false,diagnosticInterpretationIncluded:false,...GOVERNANCE};
}
module.exports={analyzeExtractedImageLeads,GOVERNANCE};
