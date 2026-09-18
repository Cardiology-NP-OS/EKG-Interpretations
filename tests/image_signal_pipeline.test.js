"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
const { analyzeExtractedImageLeads } = require("../lib/image_signal_pipeline");
const root=path.resolve(__dirname,".."), python=process.env.EKG_IMAGE_PYTHON || (process.platform==="win32"?"python":"python3");
const hash=raw=>crypto.createHash("sha256").update(raw).digest("hex");
let passed=0;
function test(name,fn){fn();passed++;console.log("PASS "+name);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-image-signal-"));
try {
  const prepare = [
    "import sys,json",
    "from pathlib import Path",
    "repo=Path(sys.argv[1]); folder=Path(sys.argv[2])",
    "sys.path.extend([str(repo/'tests'),str(repo/'lib')])",
    "import image_case_pipeline_test as f",
    "from image_case import ingest_file",
    "from image_trace_extraction import extract_case",
    "image,_=f.fixture_image(); source=folder/'signal.png'; image.save(source)",
    "manifest=ingest_file(source,folder/'cases'); artifact=extract_case(folder/'cases',manifest['caseId'],f.extraction_plan())",
    "import copy; from PIL import Image",
    "two=Image.new('RGB',(1020,560),'white'); two.paste(image,(0,0)); two.paste(image,(0,280)); source2=folder/'two.png'; two.save(source2)",
    "plan=f.extraction_plan(); second=copy.deepcopy(plan['leads'][0]); second['leadName']='I'; second['roi']['y']+=280; second['startTimeSeconds']=2; second['calibration']['pixelsPerSecond']=500; plan['leads'].append(second)",
    "manifest2=ingest_file(source2,folder/'cases'); artifact2=extract_case(folder/'cases',manifest2['caseId'],plan)",
    "print(json.dumps({'caseId':manifest['caseId'],'extractionId':artifact['extractionId'],'twoCaseId':manifest2['caseId'],'twoExtractionId':artifact2['extractionId']}))",
  ].join("\n");
  const result=cp.spawnSync(python,["-c",prepare,root,dir],{encoding:"utf8",timeout:60000});
  assert.strictEqual(result.status,0,result.stderr);
  const ids=JSON.parse(result.stdout), store=path.join(dir,"cases"), extractionPath=path.join(store,ids.caseId,"extractions",ids.extractionId,"extraction.json");
  const bytes=fs.readFileSync(extractionPath), fixture=require("../evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json");
  const config={measurement:fixture.measurement,phenotypes:fixture.phenotypes,thresholdAuthority:fixture.thresholdAuthority,maxAmplitudeUncertaintyMv:0.3,maxTimePixelUncertaintyMs:2};
  const altered=(mutate)=>{const obj=JSON.parse(bytes);mutate(obj);return Buffer.from(JSON.stringify(obj));};
  test("real image extraction connects to existing measurements and rhythm features",()=>{
    const out=analyzeExtractedImageLeads(bytes,config);
    assert.strictEqual(out.leadAnalyses.length,1); assert.strictEqual(out.leadAnalyses[0].leadName,"II");
    assert.strictEqual(out.leadAnalyses[0].features.beatCount,4);
    assert.ok(Math.abs(out.leadAnalyses[0].features.intervals.ventricularRateFromMedianRrBpm-75)<1);
    assert.strictEqual(out.status,"COMPLETE"); assert.deepStrictEqual(out.failures,[]);
    assert.strictEqual(out.extractionSha256,hash(bytes));
    assert.strictEqual(out.sourceSha256,JSON.parse(bytes).sourceSha256);
    assert.strictEqual(out.leadAnalyses[0].extractionQuality.maxStrokeThicknessPx,41);
  });
  test("analysis never treats extracted leads as simultaneous or provides diagnosis",()=>{
    const out=analyzeExtractedImageLeads(bytes,config);
    assert.strictEqual(out.simultaneousLeadComparisonPerformed,false); assert.strictEqual(out.completeTwelveLead,false);
    assert.strictEqual(out.diagnosticInterpretationIncluded,false); assert.strictEqual(out.runtimeAuthority,false);
    assert.strictEqual(out.projectGold,false); assert.strictEqual(out.metrics,"NOT_REPORTABLE");
    assert.strictEqual(out.activation,"NOT_ELIGIBLE"); assert.ok(!("diagnosis" in out));
  });
  test("immutable raw artifact identity is verified rather than trusting declared hashes",()=>{
    assert.throws(()=>analyzeExtractedImageLeads(Buffer.concat([bytes,Buffer.from(" ")]),config),/IMAGE_EXTRACTION_IDENTITY/);
    assert.throws(()=>analyzeExtractedImageLeads(altered(x=>{x.extractionId="extract-"+"0".repeat(64);}),config),/IMAGE_EXTRACTION_IDENTITY/);
  });
  test("sample geometry units and calibration cannot be substituted",()=>{
    for(const mutate of [x=>{x.leads[0].samples.pop();},x=>{x.leads[0].samples[0]=null;},x=>{x.leads[0].unit="pixel";},x=>{x.leads[0].sampleRateHz=0;},x=>{x.leads[0].calibration.confirmed=false;},x=>{x.leads[0].samples[0]=100;}])
      assert.throws(()=>analyzeExtractedImageLeads(altered(mutate),config),/IMAGE_/);
  });
  test("authority overrides fail closed before measurement",()=>{
    assert.throws(()=>analyzeExtractedImageLeads(altered(x=>{x.runtimeAuthority=true;}),config),/IMAGE_EXTRACTION_GOVERNANCE/);
    assert.throws(()=>analyzeExtractedImageLeads(bytes,{...config,runtimeAuthority:true}),/IMAGE_CONFIG_FIELDS/);
  });
  test("configuration getters and proxies are rejected without executing them",()=>{
    let invoked=false;const cfg={...config};
    Object.defineProperty(cfg,"measurement",{enumerable:true,get(){invoked=true;throw Error("getter");}});
    assert.throws(()=>analyzeExtractedImageLeads(bytes,cfg),/IMAGE_CONFIG_DATA/);assert.strictEqual(invoked,false);
    const proxy=new Proxy(config,{ownKeys(){invoked=true;throw Error("proxy");}});
    assert.throws(()=>analyzeExtractedImageLeads(bytes,proxy),/IMAGE_CONFIG_DATA/);assert.strictEqual(invoked,false);
  });
  test("uncertainty gates cannot silently accept oversized trace uncertainty",()=>{
    assert.throws(()=>analyzeExtractedImageLeads(bytes,{...config,maxAmplitudeUncertaintyMv:.01}),/IMAGE_MEASUREMENT_NO_USABLE_LEADS.*IMAGE_MEASUREMENT_QUALITY_GATE/);
    assert.throws(()=>analyzeExtractedImageLeads(bytes,{...config,maxTimePixelUncertaintyMs:1}),/IMAGE_MEASUREMENT_NO_USABLE_LEADS.*IMAGE_MEASUREMENT_QUALITY_GATE/);
  });
  test("two paper lead regions retain independent timing and explicit partial results",()=>{
    const two=fs.readFileSync(path.join(store,ids.twoCaseId,"extractions",ids.twoExtractionId,"extraction.json"));
    const complete=analyzeExtractedImageLeads(two,config);
    assert.strictEqual(complete.leadAnalyses.length,2);assert.deepStrictEqual(complete.leadAnalyses.map(x=>x.startTimeSeconds),[0,2]);
    assert.strictEqual(complete.simultaneousLeadComparisonPerformed,false);
    assert.ok(Math.abs(complete.leadAnalyses[1].features.intervals.ventricularRateFromMedianRrBpm-150)<1);
    const partial=analyzeExtractedImageLeads(two,{...config,maxTimePixelUncertaintyMs:1.5});
    assert.strictEqual(partial.status,"PARTIAL");assert.strictEqual(partial.leadAnalyses.length,1);assert.strictEqual(partial.failures.length,1);
  });
  test("nested configuration authority cannot enter the saved processing record",()=>{
    assert.throws(()=>analyzeExtractedImageLeads(bytes,{...config,measurement:{...config.measurement,runtimeAuthority:true}}),/IMAGE_CONFIG_GOVERNANCE/);
  });
  test("persistence rejects injected clinical fields and nested authority",()=>{
    for(const change of [out=>{out.diagnosis="unsupported";},out=>{out.leadAnalyses[0].features.runtimeAuthority=true;}]){
      const out=analyzeExtractedImageLeads(bytes,config);change(out);
      const saved=cp.spawnSync(python,[path.join(root,"tools/image_ecg.py"),"save-analysis","--store",store,"--case-id",ids.caseId],{input:JSON.stringify(out),encoding:"utf8",timeout:75000});
      assert.strictEqual(saved.status,1);assert.strictEqual(JSON.parse(saved.stdout).pass,false);
      assert.ok(!fs.existsSync(path.join(store,ids.caseId,"analyses")));
    }
  });
  test("analysis operator saves a result that reopens in a fresh process",()=>{
    const cfg=path.join(dir,"config.json");fs.writeFileSync(cfg,JSON.stringify(config));
    const operator=cp.spawnSync(process.execPath,[path.join(root,"tools/analyze_image_case.js"),"--store",store,"--case-id",ids.caseId,"--extraction-id",ids.extractionId,"--config",cfg,"--python",python],{encoding:"utf8",timeout:75000});
    assert.strictEqual(operator.status,0,operator.stderr);
    const saved=JSON.parse(operator.stdout);assert.match(saved.analysisId,/^analysis-[0-9a-f]{64}$/);
    const reopened=cp.spawnSync(python,[path.join(root,"tools/image_ecg.py"),"show-analysis","--store",store,"--case-id",ids.caseId,"--analysis-id",saved.analysisId],{encoding:"utf8",timeout:75000});
    assert.strictEqual(reopened.status,0,reopened.stderr);const data=JSON.parse(reopened.stdout).analysis;
    assert.strictEqual(data.extractionSha256,hash(bytes));assert.strictEqual(data.diagnosticInterpretationIncluded,false);
    assert.strictEqual(data.leadAnalyses[0].features.beatCount,4);assert.strictEqual(data.analysisId,saved.analysisId);
    assert.ok(!operator.stdout.includes(dir));
  });
  test("saved analysis corruption is rejected",()=>{
    const caseDir=path.join(store,ids.caseId,"analyses"), id=fs.readdirSync(caseDir).find(x=>x.startsWith("analysis-"));
    const filename=path.join(caseDir,id,"analysis.json");const original=fs.readFileSync(filename), changed=JSON.parse(original);
    changed.leadAnalyses[0].features.beatCount=999;fs.writeFileSync(filename,JSON.stringify(changed));
    const reopened=cp.spawnSync(python,[path.join(root,"tools/image_ecg.py"),"show-analysis","--store",store,"--case-id",ids.caseId,"--analysis-id",id],{encoding:"utf8",timeout:75000});
    assert.strictEqual(reopened.status,1);assert.strictEqual(JSON.parse(reopened.stdout).pass,false);fs.writeFileSync(filename,original);
  });
  console.log(JSON.stringify({schema:"ekg-image-signal-pipeline-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticInterpretationIncluded:false}));
} finally {
  // The resolved target is the unique directory created above inside the OS temp root.
  const resolved=fs.realpathSync(dir), parent=fs.realpathSync(os.tmpdir());
  assert.strictEqual(path.dirname(resolved),parent);assert.ok(path.basename(resolved).startsWith("ekg-image-signal-"));
  fs.rmSync(resolved,{recursive:true,force:true});
}
