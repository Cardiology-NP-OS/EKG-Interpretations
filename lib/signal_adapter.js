"use strict";
const { parseHeaderDetailed, decodeInt16Interleaved, toPhysical } = require("./wfdb_signal");

const ADAPTER_GOVERNANCE=Object.freeze({
  authorityClass:"NONCLINICAL_ENGINEERING",
  runtimeAuthority:false,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  evidenceAdmission:"NOT_ADMITTED",
  projectGold:false,
  metrics:"NOT_REPORTABLE",
  activation:"NOT_ELIGIBLE",
  clinicalValidityInferred:false,
});
function requireCondition(condition,code){if(!condition)throw new Error(code);}
function normalizeCanonicalSignal(input){
  requireCondition(input&&typeof input==="object"&&!Array.isArray(input),"SIGNAL_ADAPTER_INPUT");
  requireCondition(typeof input.record==="string"&&input.record.trim(),"SIGNAL_ADAPTER_RECORD");
  requireCondition(Number.isFinite(input.sampleRateHz)&&input.sampleRateHz>0,"SIGNAL_ADAPTER_SAMPLE_RATE");
  requireCondition(Number.isInteger(input.sampleCount)&&input.sampleCount>0,"SIGNAL_ADAPTER_SAMPLE_COUNT");
  requireCondition(Array.isArray(input.leads)&&input.leads.length>0,"SIGNAL_ADAPTER_LEADS");
  const names=new Set();
  const leads=input.leads.map(lead=>{
    requireCondition(lead&&typeof lead==="object"&&!Array.isArray(lead),"SIGNAL_ADAPTER_LEAD_OBJECT");
    requireCondition(typeof lead.leadName==="string"&&lead.leadName.trim(),"SIGNAL_ADAPTER_LEAD_NAME");
    requireCondition(!names.has(lead.leadName),"SIGNAL_ADAPTER_DUPLICATE_LEAD"); names.add(lead.leadName);
    requireCondition(typeof lead.unit==="string"&&lead.unit.trim(),"SIGNAL_ADAPTER_UNIT");
    requireCondition(Array.isArray(lead.samples)&&lead.samples.length===input.sampleCount,"SIGNAL_ADAPTER_LEAD_LENGTH");
    const samples=lead.samples.map(v=>{requireCondition(typeof v==="number"&&Number.isFinite(v),"SIGNAL_ADAPTER_NONFINITE");return v;});
    return {leadName:lead.leadName,unit:lead.unit,samples};
  });
  return {schema:"ekg-canonical-signal-v1",record:input.record.trim(),sampleRateHz:input.sampleRateHz,sampleCount:input.sampleCount,leads,...ADAPTER_GOVERNANCE};
}
function fromWfdbFormat16(headerText,dataBuffer){
  requireCondition(typeof headerText==="string"&&headerText.length>0,"SIGNAL_ADAPTER_WFDB_HEADER");
  requireCondition(Buffer.isBuffer(dataBuffer),"SIGNAL_ADAPTER_WFDB_DATA");
  const header=parseHeaderDetailed(headerText);
  const raw=decodeInt16Interleaved(dataBuffer,header.leadCount,header.sampleCount);
  return normalizeCanonicalSignal({
    record:header.record,
    sampleRateHz:header.sampleRate,
    sampleCount:header.sampleCount,
    leads:header.signals.map((signal,index)=>({
      leadName:signal.leadName,
      unit:signal.unit,
      samples:raw[index].map(value=>toPhysical(value,signal.gain,signal.baseline)),
    })),
  });
}
function adaptSignal(input){
  requireCondition(input&&typeof input==="object"&&!Array.isArray(input),"SIGNAL_ADAPTER_REQUEST");
  if(input.adapter==="canonical-json-v1") return normalizeCanonicalSignal(input.signal);
  if(input.adapter==="wfdb-format16-v1") return fromWfdbFormat16(input.headerText,input.dataBuffer);
  throw new Error("SIGNAL_ADAPTER_UNSUPPORTED");
}
module.exports={ADAPTER_GOVERNANCE,adaptSignal,fromWfdbFormat16,normalizeCanonicalSignal};
