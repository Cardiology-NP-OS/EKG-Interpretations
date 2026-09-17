"use strict";
const assert=require("assert");
const {ADAPTER_GOVERNANCE,adaptSignal,fromWfdbFormat16,normalizeCanonicalSignal}=require("../lib/signal_adapter");
let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}
function wfdb(){
  const header=["rec 2 100 3","rec.dat 16 1000(0)/mV 16 0 0 0 0 I","rec.dat 16 2000(0)/mV 16 0 0 0 0 II"].join("\n")+"\n";
  const data=Buffer.alloc(12); const values=[[1000,2000],[2000,4000],[3000,6000]];
  values.forEach((row,i)=>row.forEach((v,j)=>data.writeInt16LE(v,(i*2+j)*2)));
  return {header,data};
}
test("adapter governance stays nonclinical",()=>{
  assert.strictEqual(ADAPTER_GOVERNANCE.runtimeAuthority,false);
  assert.strictEqual(ADAPTER_GOVERNANCE.activation,"NOT_ELIGIBLE");
});
test("WFDB format-16 adapts to calibrated canonical signal",()=>{
  const x=wfdb(); const out=fromWfdbFormat16(x.header,x.data);
  assert.strictEqual(out.record,"rec"); assert.strictEqual(out.sampleRateHz,100); assert.strictEqual(out.sampleCount,3);
  assert.deepStrictEqual(out.leads[0].samples,[1,2,3]); assert.deepStrictEqual(out.leads[1].samples,[1,2,3]);
});
test("canonical JSON adapter preserves exact finite samples",()=>{
  const out=adaptSignal({adapter:"canonical-json-v1",signal:{record:"x",sampleRateHz:50,sampleCount:2,leads:[{leadName:"I",unit:"mV",samples:[0.1,0.2]}]}});
  assert.deepStrictEqual(out.leads[0].samples,[0.1,0.2]);
});test("adapter rejects duplicate leads, wrong lengths, and nonfinite samples",()=>{
  assert.throws(()=>normalizeCanonicalSignal({record:"x",sampleRateHz:50,sampleCount:1,leads:[{leadName:"I",unit:"mV",samples:[1]},{leadName:"I",unit:"mV",samples:[2]}]}),/SIGNAL_ADAPTER_DUPLICATE_LEAD/);
  assert.throws(()=>normalizeCanonicalSignal({record:"x",sampleRateHz:50,sampleCount:2,leads:[{leadName:"I",unit:"mV",samples:[1]}]}),/SIGNAL_ADAPTER_LEAD_LENGTH/);
  assert.throws(()=>normalizeCanonicalSignal({record:"x",sampleRateHz:50,sampleCount:1,leads:[{leadName:"I",unit:"mV",samples:[NaN]}]}),/SIGNAL_ADAPTER_NONFINITE/);
});
test("unsupported adapters fail closed",()=>{
  assert.throws(()=>adaptSignal({adapter:"magic"}),/SIGNAL_ADAPTER_UNSUPPORTED/);
});
test("WFDB byte-size mismatch fails through source decoder",()=>{
  const x=wfdb(); assert.throws(()=>fromWfdbFormat16(x.header,Buffer.alloc(2)),/WFDB_DATA_SIZE/);
});
test("adapter output contains no diagnostic surface",()=>{
  const x=wfdb(); const out=fromWfdbFormat16(x.header,x.data); const text=JSON.stringify(out).toLowerCase();
  assert.strictEqual(text.includes('"diagnosis"'),false); assert.strictEqual(out.metrics,"NOT_REPORTABLE");
});
if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-signal-adapter-tests-v1",pass:true,passed,total:passed,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
