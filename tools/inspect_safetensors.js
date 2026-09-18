"use strict";
const fs=require("fs");
const path=require("path");
const {inspectSafetensorsFile}=require("../lib/safetensors_asset");
function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const k=argv[i],v=argv[i+1];
    if(!k||!k.startsWith("--")||!v||v.startsWith("--"))throw new Error("SAFETENSORS_ARG_FORMAT");
    args[k.slice(2)]=v;
  }
  if(!args.asset)throw new Error("SAFETENSORS_ARG_REQUIRED:asset");
  if(args["expected-bytes"]!==undefined){
    const n=Number(args["expected-bytes"]);if(!Number.isSafeInteger(n)||n<0)throw new Error("SAFETENSORS_EXPECTED_BYTES_INVALID");args.expectedBytes=n;
  }
  if(args["expected-sha256"]!==undefined&&!/^[0-9a-f]{64}$/.test(args["expected-sha256"]))throw new Error("SAFETENSORS_EXPECTED_SHA256_INVALID");
  return args;
}
function buildInspection(args){
  return inspectSafetensorsFile(path.resolve(args.asset),{
    bytes:args.expectedBytes,
    sha256:args["expected-sha256"],
  });
}
if(require.main===module){
  try{
    const args=parseArgs(process.argv.slice(2)),result=buildInspection(args),json=JSON.stringify(result,null,2)+"\n";
    if(args.out){const out=path.resolve(args.out);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,json,"utf8");console.log(JSON.stringify({schema:"ekg-safetensors-inspection-write-v1",pass:true,outputWritten:true,diagnosticRuntime:"GOVERNED_INACTIVE"}));}
    else process.stdout.write(json);
  }catch(e){console.error(JSON.stringify({schema:"ekg-safetensors-inspection-write-v1",pass:false,error:String(e.message||e),diagnosticRuntime:"GOVERNED_INACTIVE"}));process.exit(1);}
}
module.exports={buildInspection,parseArgs};
