"use strict";
const fs=require("fs"),path=require("path"),cp=require("child_process");
const {analyzeExtractedImageLeads}=require("../lib/image_signal_pipeline");
function main(){
  const args=process.argv.slice(2),options={};
  const names=new Set(["--store","--case-id","--extraction-id","--config","--python"]);
  for(let i=0;i<args.length;i+=2){if(!names.has(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error("IMAGE_CLI_ARGUMENTS");options[args[i]]=args[i+1];}
  for(const name of ["--store","--case-id","--extraction-id","--config"])if(!options[name])throw Error("IMAGE_CLI_ARGUMENTS");
  const python=options["--python"]||process.env.EKG_IMAGE_PYTHON||(process.platform==="win32"?"python":"python3"),cli=path.join(__dirname,"image_ecg.py");
  function invoke(action,extra=[],input){
    const result=cp.spawnSync(python,[cli,action,"--store",options["--store"],"--case-id",options["--case-id"],...extra],{encoding:"utf8",input,timeout:75000,maxBuffer:40*1024*1024,windowsHide:true});
    if(result.error)throw Error("IMAGE_DECODER_PROCESS_FAILED");
    let output;try{output=JSON.parse(result.stdout);}catch(_){throw Error("IMAGE_DECODER_RESULT_INVALID");}
    if(result.status!==0||output.pass!==true)throw Error(/^[A-Z0-9_]+$/.test(output.reason)?output.reason:"IMAGE_DECODER_FAILED");
    return output;
  }
  const verified=invoke("show-extraction",["--extraction-id",options["--extraction-id"]]);
  // The Python worker validates source bytes, raster bytes and overlays before this read.
  const filename=path.join(options["--store"],options["--case-id"],"extractions",options["--extraction-id"],"extraction.json");
  if(fs.statSync(filename).size>32*1024*1024||fs.statSync(options["--config"]).size>256*1024)throw Error("IMAGE_CLI_BYTES_LIMIT");
  const raw=fs.readFileSync(filename);
  if(require("crypto").createHash("sha256").update(raw).digest("hex")!==verified.extractionSha256)throw Error("IMAGE_EXTRACTION_CHANGED");
  const analysis=analyzeExtractedImageLeads(raw,JSON.parse(fs.readFileSync(options["--config"],"utf8")));
  const saved=invoke("save-analysis",[],JSON.stringify(analysis));
  console.log(JSON.stringify({schema:"ekg-image-analysis-operator-result-v1",pass:true,caseId:analysis.caseId,extractionId:analysis.extractionId,analysisId:saved.analysis.analysisId,status:analysis.status,leadCount:analysis.leadAnalyses.length,diagnosticInterpretationIncluded:false,runtimeAuthority:false,projectGold:false}));
}
try{main();}catch(exc){console.log(JSON.stringify({schema:"ekg-image-analysis-operator-result-v1",pass:false,reason:/^[A-Z0-9_:,]+$/.test(exc.message)?exc.message:"IMAGE_ANALYSIS_OPERATION_FAILED"}));process.exitCode=1;}
