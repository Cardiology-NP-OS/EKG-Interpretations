"use strict";
const assert=require("assert");
const {IMAGE_ROBUSTNESS_GOVERNANCE,addDeterministicNoise,applyImageDegradation,cropImage,normalizeImage,padImage,resizeNearest,rotate90,thresholdImage}=require("../lib/image_robustness");
let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}
const image=[[0,64,128],[192,224,255]];
test("image robustness governance remains evaluation-only",()=>{
  assert.strictEqual(IMAGE_ROBUSTNESS_GOVERNANCE.runtimeAuthority,false);assert.strictEqual(IMAGE_ROBUSTNESS_GOVERNANCE.metrics,"NOT_REPORTABLE");
});
test("rectangular grayscale image validates exactly",()=>{
  assert.deepStrictEqual(normalizeImage(image),image);
});
test("crop is deterministic and bounded",()=>{
  assert.deepStrictEqual(cropImage(image,{x:1,y:0,width:2,height:2}),[[64,128],[224,255]]);
  assert.throws(()=>cropImage(image,{x:2,y:0,width:2,height:1}),/IMAGE_ROBUSTNESS_CROP_BOUNDS/);
});
test("rotation preserves every pixel",()=>{
  assert.deepStrictEqual(rotate90([[1,2,3],[4,5,6]]),[[4,1],[5,2],[6,3]]);
});
test("padding is explicit and deterministic",()=>{
  assert.deepStrictEqual(padImage([[1,2]],{top:1,bottom:1,left:1,right:1,value:9}),[[9,9,9,9],[9,1,2,9],[9,9,9,9]]);
});test("nearest-neighbor resize has exact expected mapping",()=>{
  assert.deepStrictEqual(resizeNearest([[1,2],[3,4]],{width:4,height:4}),[[1,1,2,2],[1,1,2,2],[3,3,4,4],[3,3,4,4]]);
});
test("deterministic noise clamps into grayscale range",()=>{
  assert.deepStrictEqual(addDeterministicNoise([[10,250]],[[ -20,20 ]]),[[0,255]]);
});
test("monochrome threshold is explicit",()=>{
  assert.deepStrictEqual(thresholdImage([[0,127,128,255]],128),[[0,0,255,255]]);
});
test("dispatcher executes every implemented degradation method",()=>{
  assert.deepStrictEqual(applyImageDegradation([[1,2],[3,4]],{method:"rotate90-v1"}),[[3,1],[4,2]]);
  assert.deepStrictEqual(applyImageDegradation([[1,2]],{method:"crop-v1",x:0,y:0,width:1,height:1}),[[1]]);
  assert.deepStrictEqual(applyImageDegradation([[1]],{method:"pad-v1",right:1,value:0}),[[1,0]]);
  assert.deepStrictEqual(applyImageDegradation([[1]],{method:"resize-nearest-v1",width:2,height:1}),[[1,1]]);
  assert.deepStrictEqual(applyImageDegradation([[10]],{method:"deterministic-noise-v1",noise:[[1]]}),[[11]]);
  assert.deepStrictEqual(applyImageDegradation([[100]],{method:"monochrome-threshold-v1",threshold:50}),[[255]]);
});
test("malformed image and unknown method fail closed",()=>{
  assert.throws(()=>normalizeImage([[1],[2,3]]),/IMAGE_ROBUSTNESS_RECTANGULAR_REQUIRED/);
  assert.throws(()=>normalizeImage([[256]]),/IMAGE_ROBUSTNESS_PIXEL_RANGE/);
  assert.throws(()=>applyImageDegradation([[1]],{method:"magic"}),/IMAGE_ROBUSTNESS_METHOD_UNIMPLEMENTED/);
});if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-image-robustness-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
