"use strict";
const crypto=require("crypto");

const FOUNDATION_ADAPTER_GOVERNANCE=Object.freeze({
  authorityClass:"EVALUATION_CHALLENGER_ADAPTER",
  runtimeAuthority:false,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  evidenceAdmission:"NOT_ADMITTED",
  projectGold:false,
  metrics:"NOT_REPORTABLE",
  activation:"NOT_ELIGIBLE",
  clinicalValidityInferred:false,
});
const CANONICAL_12_LEADS=Object.freeze(["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]);
function req(ok,code){if(!ok)throw new Error(code);}
function validateSpec(spec){
  req(spec&&typeof spec==="object"&&!Array.isArray(spec),"FOUNDATION_ADAPTER_SPEC_REQUIRED");
  req(spec.packing==="lead-major-contiguous-v1","FOUNDATION_ADAPTER_PACKING_UNSUPPORTED");
  req(Number.isFinite(spec.inputSampleRateHz)&&spec.inputSampleRateHz>0,"FOUNDATION_ADAPTER_SAMPLE_RATE");
  req(Number.isFinite(spec.windowSeconds)&&spec.windowSeconds>0,"FOUNDATION_ADAPTER_WINDOW_SECONDS");
  req(Number.isInteger(spec.samplesPerLead)&&spec.samplesPerLead>0,"FOUNDATION_ADAPTER_SAMPLES_PER_LEAD");
  req(Number.isInteger(spec.leadCount)&&spec.leadCount>0,"FOUNDATION_ADAPTER_LEAD_COUNT");
  req(Array.isArray(spec.leadOrder)&&spec.leadOrder.length===spec.leadCount,"FOUNDATION_ADAPTER_LEAD_ORDER");
  req(new Set(spec.leadOrder).size===spec.leadOrder.length,"FOUNDATION_ADAPTER_LEAD_ORDER_DUPLICATE");
  req(spec.samplesPerLead===Math.round(spec.inputSampleRateHz*spec.windowSeconds),"FOUNDATION_ADAPTER_WINDOW_GEOMETRY");
  req(spec.vectorLength===spec.samplesPerLead*spec.leadCount,"FOUNDATION_ADAPTER_VECTOR_LENGTH");
  return {...spec,leadOrder:spec.leadOrder.slice()};
}
function vectorSha256(values){
  const b=Buffer.allocUnsafe(values.length*4);
  values.forEach((v,i)=>b.writeFloatLE(v,i*4));
  return crypto.createHash("sha256").update(b).digest("hex");
}
function packLeadMajor(input){
  req(input&&typeof input==="object","FOUNDATION_ADAPTER_INPUT_REQUIRED");
  const spec=validateSpec(input.spec);
  req(Array.isArray(input.leads)&&input.leads.length===spec.leadCount,"FOUNDATION_ADAPTER_LEADS_REQUIRED");
  const vector=[];
  input.leads.forEach((lead,i)=>{
    req(lead&&typeof lead==="object","FOUNDATION_ADAPTER_LEAD_INVALID");
    req(lead.leadName===spec.leadOrder[i],"FOUNDATION_ADAPTER_LEAD_ORDER_MISMATCH");
    req(Array.isArray(lead.samples)&&lead.samples.length===spec.samplesPerLead,"FOUNDATION_ADAPTER_LEAD_LENGTH");
    for(const v of lead.samples){req(typeof v==="number"&&Number.isFinite(v),"FOUNDATION_ADAPTER_NONFINITE_SAMPLE");vector.push(v);}
  });
  req(vector.length===spec.vectorLength,"FOUNDATION_ADAPTER_PACKED_LENGTH");
  return {
    schema:"ekg-foundation-representation-input-v1",
    packing:spec.packing,
    inputSampleRateHz:spec.inputSampleRateHz,
    windowSeconds:spec.windowSeconds,
    samplesPerLead:spec.samplesPerLead,
    leadOrder:spec.leadOrder,
    vectorLength:vector.length,
    vectorSha256:vectorSha256(vector),
    values:vector,
    sourceProvenance:input.sourceProvenance||null,
    diagnosticInterpretationIncluded:false,
    ...FOUNDATION_ADAPTER_GOVERNANCE,
  };
}
function packPipelineSegment(pipeline,options){
  req(pipeline&&typeof pipeline==="object","FOUNDATION_ADAPTER_PIPELINE_REQUIRED");
  req(pipeline.schema==="ekg-signal-preprocessing-pipeline-v1","FOUNDATION_ADAPTER_PIPELINE_SCHEMA");
  req(pipeline.runtimeAuthority===false&&pipeline.projectGold===false,"FOUNDATION_ADAPTER_PIPELINE_AUTHORITY");
  const spec=validateSpec(options&&options.spec);
  req(pipeline.targetSamplingRateHz===spec.inputSampleRateHz,"FOUNDATION_ADAPTER_PIPELINE_SAMPLE_RATE");
  const index=options.segmentIndex===undefined?0:options.segmentIndex;
  req(Number.isInteger(index)&&index>=0&&index<pipeline.segments.length,"FOUNDATION_ADAPTER_SEGMENT_INDEX");
  const segment=pipeline.segments[index];
  req(segment.paddedSamples===0,"FOUNDATION_ADAPTER_PADDED_SEGMENT_REJECTED");
  return packLeadMajor({
    spec,
    leads:segment.leads,
    sourceProvenance:{
      preprocessingSchema:pipeline.schema,
      record:pipeline.record,
      segmentIndex:index,
      sourceKind:pipeline.provenance&&pipeline.provenance.sourceKind||null,
      assetSha256:pipeline.provenance&&pipeline.provenance.assetSha256||null,
    },
  });
}
module.exports={CANONICAL_12_LEADS,FOUNDATION_ADAPTER_GOVERNANCE,packLeadMajor,packPipelineSegment,validateSpec,vectorSha256};
