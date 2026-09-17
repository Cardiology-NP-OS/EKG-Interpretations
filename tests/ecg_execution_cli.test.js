"use strict";
const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const cp=require("child_process");
const fx=require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const config=require("../evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json");
const {parseArgs}=require("../tools/run_ecg_pipeline");

let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}
const leads=["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
function fill(a,s,e,v){for(let i=s;i<=e;i+=1)a[i]=v;}
function fixture(){
  const samples=Array(fx.sampleCount).fill(0),r=fx.relativeFiducials,a=fx.amplitudesMv;
  for(const peak of fx.rPeaks){fill(samples,peak+r.pOnset,peak+r.pOffset,a.p);samples[peak+r.pPeak]=a.pPeak;fill(samples,peak+r.qrsOnset,peak+r.qrsOffset,a.qrs);samples[peak]=a.rPeak;fill(samples,peak+r.tOnset,peak+r.tOffset,a.t);samples[peak+r.tPeak]=a.tPeak;}
  const record="synthetic12";
  const header=[`${record} 12 ${fx.sampleRateHz} ${fx.sampleCount}`].concat(leads.map(l=>`${record}.dat 16 1000.0(0)/mV 16 0 0 0 0 ${l}`)).join("\n")+"\n";
  const data=Buffer.alloc(12*fx.sampleCount*2);
  for(let i=0;i<fx.sampleCount;i+=1)for(let l=0;l<12;l+=1)data.writeInt16LE(Math.round((leads[l]==="II"?samples[i]:0)*1000),(i*12+l)*2);
  return {header,data};
}
function sha256(b){return crypto.createHash("sha256").update(b).digest("hex");}
test("operator CLI writes path-minimized analysis and exact rendering",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-exec-cli-"));
  const f=fixture(),hp=path.join(dir,"synthetic12.hea"),dp=path.join(dir,"synthetic12.dat"),cfg=path.join(dir,"config.json"),out=path.join(dir,"out");
  fs.writeFileSync(hp,f.header);fs.writeFileSync(dp,f.data);fs.writeFileSync(cfg,JSON.stringify(config));
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,"..","tools","run_ecg_pipeline.js"),"--header",hp,"--data",dp,"--config",cfg,"--source-id","fixture:exec-cli","--out-dir",out],{encoding:"utf8"});
  assert.strictEqual(result.status,0,result.stderr);
  const artifact=JSON.parse(fs.readFileSync(path.join(out,"analysis.json"),"utf8"));
  const svg=fs.readFileSync(path.join(out,"waveform.svg"));
  assert.strictEqual(artifact.schema,"ekg-executable-signal-pipeline-v1");
  assert.strictEqual(artifact.provenanceChain.locator,"fixture:exec-cli");
  assert.strictEqual(artifact.rendering.svgSha256,sha256(svg));
  assert.strictEqual(artifact.rendering.svgFile,"waveform.svg");
  assert.strictEqual(artifact.localPathsEmbedded,false);
  assert.strictEqual(JSON.stringify(artifact).includes(dir),false);
});

test("operator CLI source identifier boundary is fail closed",()=>{
  assert.strictEqual(parseArgs(["--header","a.hea","--data","a.dat","--config","c.json","--source-id","fixture:001","--out-dir","out"])["source-id"],"fixture:001");
  assert.throws(()=>parseArgs(["--header","a.hea","--data","a.dat","--config","c.json","--source-id","../patient/path","--out-dir","out"]),/EXECUTE_SOURCE_ID_UNSAFE/);
});

test("operator artifact never claims diagnostic authority",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-exec-cli-governance-"));
  const f=fixture(),hp=path.join(dir,"synthetic12.hea"),dp=path.join(dir,"synthetic12.dat"),cfg=path.join(dir,"config.json"),out=path.join(dir,"out");
  fs.writeFileSync(hp,f.header);fs.writeFileSync(dp,f.data);fs.writeFileSync(cfg,JSON.stringify(config));
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,"..","tools","run_ecg_pipeline.js"),"--header",hp,"--data",dp,"--config",cfg,"--source-id","fixture:governance","--out-dir",out],{encoding:"utf8"});
  assert.strictEqual(result.status,0,result.stderr);
  const artifact=JSON.parse(fs.readFileSync(path.join(out,"analysis.json"),"utf8"));
  assert.strictEqual(artifact.runtimeAuthority,false);
  assert.strictEqual(artifact.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(artifact.evidenceAdmission,"NOT_ADMITTED");
  assert.strictEqual(artifact.metrics,"NOT_REPORTABLE");
  assert.strictEqual(artifact.activation,"NOT_ELIGIBLE");
  assert.strictEqual(JSON.stringify(artifact).toLowerCase().includes('"diagnosis"'),false);
});

if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-executable-signal-pipeline-cli-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,realCliSurfaceTested:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));