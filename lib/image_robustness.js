"use strict";
const IMAGE_ROBUSTNESS_GOVERNANCE=Object.freeze({authorityClass:"EVALUATION_NONRUNTIME",runtimeAuthority:false,diagnosticRuntime:"GOVERNED_INACTIVE",evidenceAdmission:"NOT_ADMITTED",projectGold:false,metrics:"NOT_REPORTABLE",activation:"NOT_ELIGIBLE",clinicalValidityInferred:false});
function requireCondition(condition,code){if(!condition)throw new Error(code);}
function normalizeImage(image){
  requireCondition(Array.isArray(image)&&image.length>0,"IMAGE_ROBUSTNESS_ROWS_REQUIRED");
  requireCondition(Array.isArray(image[0])&&image[0].length>0,"IMAGE_ROBUSTNESS_COLUMNS_REQUIRED");
  const width=image[0].length;
  return image.map(row=>{
    requireCondition(Array.isArray(row)&&row.length===width,"IMAGE_ROBUSTNESS_RECTANGULAR_REQUIRED");
    return row.map(v=>{requireCondition(Number.isInteger(v)&&v>=0&&v<=255,"IMAGE_ROBUSTNESS_PIXEL_RANGE");return v;});
  });
}
function cropImage(image,{x,y,width,height}){
  const source=normalizeImage(image);const h=source.length,w=source[0].length;
  requireCondition([x,y,width,height].every(Number.isInteger)&&x>=0&&y>=0&&width>0&&height>0&&x+width<=w&&y+height<=h,"IMAGE_ROBUSTNESS_CROP_BOUNDS");
  return source.slice(y,y+height).map(row=>row.slice(x,x+width));
}
function rotate90(image){
  const source=normalizeImage(image),h=source.length,w=source[0].length;
  return Array.from({length:w},(_,x)=>Array.from({length:h},(_,y)=>source[h-1-y][x]));
}
function padImage(image,{top=0,bottom=0,left=0,right=0,value=255}={}){
  const source=normalizeImage(image);requireCondition([top,bottom,left,right].every(v=>Number.isInteger(v)&&v>=0),"IMAGE_ROBUSTNESS_PADDING");requireCondition(Number.isInteger(value)&&value>=0&&value<=255,"IMAGE_ROBUSTNESS_PAD_VALUE");
  const width=source[0].length+left+right;const row=()=>Array(width).fill(value);
  return [...Array.from({length:top},row),...source.map(r=>[...Array(left).fill(value),...r,...Array(right).fill(value)]),...Array.from({length:bottom},row)];
}function resizeNearest(image,{width,height}){
  const source=normalizeImage(image),srcH=source.length,srcW=source[0].length;
  requireCondition(Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0,"IMAGE_ROBUSTNESS_RESIZE_DIMENSIONS");
  return Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
    const sy=Math.min(srcH-1,Math.floor(y*srcH/height));
    const sx=Math.min(srcW-1,Math.floor(x*srcW/width));
    return source[sy][sx];
  }));
}
function addDeterministicNoise(image,noise){
  const source=normalizeImage(image);requireCondition(Array.isArray(noise)&&noise.length===source.length,"IMAGE_ROBUSTNESS_NOISE_SHAPE");
  return source.map((row,y)=>{requireCondition(Array.isArray(noise[y])&&noise[y].length===row.length,"IMAGE_ROBUSTNESS_NOISE_SHAPE");return row.map((v,x)=>{const n=noise[y][x];requireCondition(Number.isFinite(n),"IMAGE_ROBUSTNESS_NOISE_VALUE");return Math.max(0,Math.min(255,Math.round(v+n)));});});
}
function adjustIntensity(image,{gain=1,offset=0}={}){
  const source=normalizeImage(image);
  requireCondition(typeof gain==="number"&&Number.isFinite(gain)&&gain>=0.25&&gain<=4,"IMAGE_ROBUSTNESS_INTENSITY_GAIN");
  requireCondition(typeof offset==="number"&&Number.isFinite(offset)&&offset>=-255&&offset<=255,"IMAGE_ROBUSTNESS_INTENSITY_OFFSET");
  return source.map(row=>row.map(v=>Math.max(0,Math.min(255,Math.round(v*gain+offset)))));
}
function boxBlur(image,{radius=1}={}){
  const source=normalizeImage(image),h=source.length,w=source[0].length;
  requireCondition(Number.isInteger(radius)&&radius>=1&&radius<=3,"IMAGE_ROBUSTNESS_BLUR_RADIUS");
  return Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>{
    let sum=0,count=0;
    for(let yy=Math.max(0,y-radius);yy<=Math.min(h-1,y+radius);yy+=1){
      for(let xx=Math.max(0,x-radius);xx<=Math.min(w-1,x+radius);xx+=1){
        sum+=source[yy][xx];count+=1;
      }
    }
    return Math.round(sum/count);
  }));
}
function occludeRectangle(image,{x,y,width,height,value=255}){
  const source=normalizeImage(image),h=source.length,w=source[0].length;
  requireCondition([x,y,width,height].every(Number.isInteger)&&x>=0&&y>=0&&width>0&&height>0&&x+width<=w&&y+height<=h,"IMAGE_ROBUSTNESS_OCCLUSION_BOUNDS");
  requireCondition(Number.isInteger(value)&&value>=0&&value<=255,"IMAGE_ROBUSTNESS_OCCLUSION_VALUE");
  const out=source.map(row=>row.slice());
  for(let yy=y;yy<y+height;yy+=1)for(let xx=x;xx<x+width;xx+=1)out[yy][xx]=value;
  return out;
}
function deterministicNoiseField(width,height,{amplitude=8,period=17}={}){
  requireCondition(Number.isInteger(width)&&width>0&&Number.isInteger(height)&&height>0,"IMAGE_ROBUSTNESS_NOISE_DIMENSIONS");
  requireCondition(Number.isInteger(amplitude)&&amplitude>=0&&amplitude<=64,"IMAGE_ROBUSTNESS_NOISE_AMPLITUDE");
  requireCondition(Number.isInteger(period)&&period>=3&&period<=251,"IMAGE_ROBUSTNESS_NOISE_PERIOD");
  return Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
    const raw=((x*37+y*53)%period)-Math.floor(period/2);
    return amplitude===0?0:(raw/Math.max(1,Math.floor(period/2)))*amplitude;
  }));
}
function thresholdImage(image,threshold=128){
  const source=normalizeImage(image);requireCondition(Number.isInteger(threshold)&&threshold>=0&&threshold<=255,"IMAGE_ROBUSTNESS_THRESHOLD");
  return source.map(row=>row.map(v=>v>=threshold?255:0));
}
function applyImageDegradation(image,operation){
  requireCondition(operation&&typeof operation==="object"&&!Array.isArray(operation),"IMAGE_ROBUSTNESS_OPERATION");
  switch(operation.method){
    case "crop-v1":return cropImage(image,operation);
    case "rotate90-v1":return rotate90(image);
    case "pad-v1":return padImage(image,operation);
    case "resize-nearest-v1":return resizeNearest(image,operation);
    case "deterministic-noise-v1":return addDeterministicNoise(image,operation.noise);
    case "intensity-linear-v1":return adjustIntensity(image,operation);
    case "box-blur-v1":return boxBlur(image,operation);
    case "occlude-rectangle-v1":return occludeRectangle(image,operation);
    case "monochrome-threshold-v1":return thresholdImage(image,operation.threshold);
    default:throw new Error("IMAGE_ROBUSTNESS_METHOD_UNIMPLEMENTED");
  }
}module.exports={
  IMAGE_ROBUSTNESS_GOVERNANCE,
  addDeterministicNoise,
  adjustIntensity,
  applyImageDegradation,
  boxBlur,
  cropImage,
  deterministicNoiseField,
  normalizeImage,
  occludeRectangle,
  padImage,
  resizeNearest,
  rotate90,
  thresholdImage,
};
