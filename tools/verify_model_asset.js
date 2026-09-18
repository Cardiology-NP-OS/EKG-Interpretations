"use strict";
const fs=require("fs");
const path=require("path");
const {verifyModelAssetFile}=require("../lib/model_asset_safety");

function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i], value=argv[i+1];
    if(!key || !key.startsWith("--") || !value || value.startsWith("--")) throw new Error("MODEL_ASSET_ARG_FORMAT");
    args[key.slice(2)]=value;
  }
  for(const key of ["spec","asset"]) if(!args[key]) throw new Error("MODEL_ASSET_ARG_REQUIRED:"+key);
  return args;
}
function verifyFromFiles(args){
  const spec=JSON.parse(fs.readFileSync(path.resolve(args.spec),"utf8").replace(/^\uFEFF/,""));
  return verifyModelAssetFile(spec,path.resolve(args.asset));
}
if(require.main===module){
  try{
    const args=parseArgs(process.argv.slice(2));
    const result=verifyFromFiles(args);
    const json=JSON.stringify(result,null,2)+"\n";
    if(args.out){
      const out=path.resolve(args.out);
      fs.mkdirSync(path.dirname(out),{recursive:true});
      fs.writeFileSync(out,json,"utf8");
      console.log(JSON.stringify({schema:"ekg-model-asset-file-write-v1",pass:true,outputWritten:true,diagnosticRuntime:"GOVERNED_INACTIVE"}));
    } else process.stdout.write(json);
  }catch(error){
    console.error(JSON.stringify({schema:"ekg-model-asset-file-write-v1",pass:false,error:String(error.message||error),diagnosticRuntime:"GOVERNED_INACTIVE"}));
    process.exit(1);
  }
}
module.exports={parseArgs,verifyFromFiles};
