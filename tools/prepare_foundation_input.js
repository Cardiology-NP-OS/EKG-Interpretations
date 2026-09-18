"use strict";
const fs=require("fs");
const path=require("path");
const {buildPreprocessingArtifact}=require("./preprocess_wfdb");
const {packPipelineSegment}=require("../lib/foundation_representation_adapter");

function parseArgs(argv){
  const args={};
  for(let i=0;i<argv.length;i+=2){
    const key=argv[i],value=argv[i+1];
    if(!key||!key.startsWith("--")||!value||value.startsWith("--"))throw new Error("FOUNDATION_INPUT_ARG_FORMAT");
    args[key.slice(2)]=value;
  }
  for(const key of ["header","data","config","spec","source-id"])
    if(!args[key])throw new Error("FOUNDATION_INPUT_ARG_REQUIRED:"+key);
  if(args["segment-index"]!==undefined){
    const n=Number(args["segment-index"]);
    if(!Number.isInteger(n)||n<0)throw new Error("FOUNDATION_INPUT_SEGMENT_INDEX_INVALID");
    args.segmentIndex=n;
  }else args.segmentIndex=0;
  return args;
}
function buildFoundationInputArtifact(args){
  const pipeline=buildPreprocessingArtifact({
    header:args.header,
    data:args.data,
    config:args.config,
    "source-id":args["source-id"],
  });
  const spec=JSON.parse(fs.readFileSync(path.resolve(args.spec),"utf8").replace(/^\uFEFF/,""));
  const packed=packPipelineSegment(pipeline,{spec,segmentIndex:args.segmentIndex});
  return {
    ...packed,
    profileId:spec.profileId||null,
    compatibility:spec.compatibility||null,
    sourceFiles:pipeline.sourceFiles,
    preprocessing:{
      schema:pipeline.schema,
      targetSamplingRateHz:pipeline.targetSamplingRateHz,
      resampling:pipeline.resampling,
      preprocessingConfigSha256:pipeline.preprocessingConfigSha256||null,
    },
    workflow:"tools/prepare_foundation_input.js",
  };
}
if(require.main===module){
  try{
    const args=parseArgs(process.argv.slice(2));
    const artifact=buildFoundationInputArtifact(args);
    const json=JSON.stringify(artifact,null,2)+"\n";
    if(args.out){
      const out=path.resolve(args.out);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,json,"utf8");
      console.log(JSON.stringify({schema:"ekg-foundation-input-write-v1",pass:true,outputWritten:true,diagnosticRuntime:"GOVERNED_INACTIVE"}));
    }else process.stdout.write(json);
  }catch(e){
    console.error(JSON.stringify({schema:"ekg-foundation-input-write-v1",pass:false,error:String(e.message||e),diagnosticRuntime:"GOVERNED_INACTIVE"}));
    process.exit(1);
  }
}
module.exports={buildFoundationInputArtifact,parseArgs};
