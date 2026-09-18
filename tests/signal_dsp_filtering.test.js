"use strict";
const assert = require("assert");
const {
  DSP_GOVERNANCE,
  FOUNDATION_PROFILE_V1,
  applyFoundationPretrainingProfile,
  designNotch,
  globalZScore,
  medianFilterZeroPad,
  zeroPhaseBiquad,
} = require("../lib/signal_dsp_filtering");
const { runSignalPreprocessingPipeline } = require("../lib/signal_preprocessing_pipeline");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
function amplitude(values, frequencyHz, sampleRateHz, trim = 0) {
  const start = trim, end = values.length - trim;
  let s = 0, c = 0, n = 0;
  for (let i = start; i < end; i += 1) {
    const w = 2*Math.PI*frequencyHz*i/sampleRateHz;
    s += values[i]*Math.sin(w);
    c += values[i]*Math.cos(w);
    n += 1;
  }
  return 2*Math.sqrt(s*s+c*c)/n;
}
function syntheticLead(fs=500, n=5000) {
  return Array.from({length:n}, (_,i) => {
    const t=i/fs;
    return 0.8*Math.sin(2*Math.PI*0.2*t)
      + 1.0*Math.sin(2*Math.PI*10*t)
      + 0.6*Math.sin(2*Math.PI*50*t);
  });
}
test("DSP governance remains inactive and non-diagnostic", () => {
  assert.strictEqual(DSP_GOVERNANCE.runtimeAuthority,false);
  assert.strictEqual(DSP_GOVERNANCE.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(DSP_GOVERNANCE.metrics,"NOT_REPORTABLE");
});
test("50 Hz notch executes as a stable zero-phase biquad", () => {
  const fs=500, source=syntheticLead(fs);
  const out=zeroPhaseBiquad(source, designNotch(fs,50,30));
  assert.strictEqual(out.length,source.length);
  assert.ok(amplitude(out,50,fs,250) < amplitude(source,50,fs,250)*0.35);
  assert.ok(amplitude(out,10,fs,250) > amplitude(source,10,fs,250)*0.8);
});
test("sliding median baseline uses deterministic zero padding", () => {
  assert.deepStrictEqual(medianFilterZeroPad([1,9,2,8,3],3),[1,2,8,3,3]);
});
test("global z-score matches donor matrix-wide normalization semantics", () => {
  const x=globalZScore([[1,2,3],[4,5,6]],1e-8);
  const flat=x.leads.flat();
  const mean=flat.reduce((a,b)=>a+b,0)/flat.length;
  const sd=Math.sqrt(flat.reduce((a,b)=>a+b*b,0)/flat.length);
  assert.ok(Math.abs(mean) < 1e-12);
  assert.ok(Math.abs(sd-1) < 1e-7);
});
test("foundation profile attenuates baseline and line noise while preserving passband", () => {
  const fs=500, source=syntheticLead(fs);
  const matrix=Array.from({length:12},(_,i)=>source.map(v=>v*(1+i/100)));
  const out=applyFoundationPretrainingProfile(matrix,fs);
  const y=out.leads[0];
  assert.strictEqual(y.length,source.length);
  assert.ok(amplitude(y,50,fs,500) < amplitude(y,10,fs,500)*0.2);
  assert.ok(amplitude(y,0.2,fs,500) < amplitude(y,10,fs,500)*0.2);
  assert.strictEqual(out.metadata.profileId,FOUNDATION_PROFILE_V1.profileId);
  assert.strictEqual(out.metadata.sourceCompatibility,"DONOR_ALIGNED_CLEAN_REIMPLEMENTATION");
});
test("foundation profile is byte-deterministic for identical numeric input", () => {
  const fs=500, lead=syntheticLead(fs,600);
  const a=applyFoundationPretrainingProfile([lead,lead],fs);
  const b=applyFoundationPretrainingProfile([lead,lead],fs);
  assert.strictEqual(JSON.stringify(a),JSON.stringify(b));
});
test("profile fails closed on nonfinite samples and incompatible sample rates", () => {
  const bad=Array.from({length:50},(_,i)=>i); bad[2]=NaN;
  assert.throws(()=>applyFoundationPretrainingProfile([bad],500),/DSP_NONFINITE_SAMPLE/);
  assert.throws(()=>applyFoundationPretrainingProfile([Array(100).fill(1)],100),/DSP_SAMPLE_RATE_TOO_LOW_FOR_PROFILE/);
});
const canonical=["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
function syntheticWfdb(sampleRateHz=500,sampleCount=600) {
  const header=[`fdsp ${canonical.length} ${sampleRateHz} ${sampleCount}`]
    .concat(canonical.map(lead=>`fdsp.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`)).join("\n")+"\n";
  const buffer=Buffer.alloc(canonical.length*sampleCount*2);
  for(let i=0;i<sampleCount;i+=1) {
    const t=i/sampleRateHz;
    const v=Math.round((Math.sin(2*Math.PI*10*t)+0.3*Math.sin(2*Math.PI*50*t))*1000);
    for(let j=0;j<canonical.length;j+=1) buffer.writeInt16LE(v,(i*canonical.length+j)*2);
  }
  return {header,buffer};
}
test("existing WFDB pipeline executes the foundation DSP profile end to end", () => {
  const fx=syntheticWfdb();
  const out=runSignalPreprocessingPipeline({
    headerText:fx.header,
    dataBuffer:fx.buffer,
    config:{
      requireCompleteTwelveLead:true,
      targetSamplingRateHz:500,
      segmentSamples:600,
      resamplingMethod:null,
      remainderPolicy:"drop",
      engineeringTransformProfile:"foundation-pretraining-dsp-v1",
    },
    provenance:{sourceKind:"SYNTHETIC_FIXTURE",locator:"foundation-dsp-test"},
  });
  assert.strictEqual(out.segments.length,1);
  assert.strictEqual(out.segments[0].engineeringTransform.profileId,"foundation-pretraining-dsp-v1");
  assert.strictEqual(out.segments[0].leads.length,12);
  assert.strictEqual(out.segments[0].leads[0].samples.length,600);
  assert.strictEqual(out.runtimeAuthority,false);
  assert.strictEqual(out.metrics,"NOT_REPORTABLE");
});
test("unknown engineering transform profiles fail closed", () => {
  const fx=syntheticWfdb(500,100);
  assert.throws(()=>runSignalPreprocessingPipeline({
    headerText:fx.header,dataBuffer:fx.buffer,
    config:{requireCompleteTwelveLead:true,targetSamplingRateHz:500,segmentSamples:100,resamplingMethod:null,engineeringTransformProfile:"unknown-v9"},
    provenance:{sourceKind:"SYNTHETIC_FIXTURE",locator:"unknown-profile"},
  }),/PREPROCESS_ENGINEERING_PROFILE_UNIMPLEMENTED/);
});
if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-signal-dsp-filtering-tests-v1",
  pass:true,passed,total:passed,syntheticOnly:true,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  metrics:"NOT_REPORTABLE",
  clinicalAuthorityAdded:false,
}));
