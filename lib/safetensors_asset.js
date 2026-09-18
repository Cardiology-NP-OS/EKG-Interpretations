"use strict";
const crypto=require("crypto");
const fs=require("fs");

const SAFETENSORS_GOVERNANCE=Object.freeze({
  authorityClass:"CHALLENGER_SAFETY_NONRUNTIME",
  runtimeAuthority:false,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  evidenceAdmission:"NOT_ADMITTED",
  projectGold:false,
  metrics:"NOT_REPORTABLE",
  activation:"NOT_ELIGIBLE",
  clinicalValidityInferred:false,
});
const MAX_HEADER_BYTES=16*1024*1024;
const DTYPE_BYTES=Object.freeze({
  BOOL:1,U8:1,I8:1,
  U16:2,I16:2,F16:2,BF16:2,
  U32:4,I32:4,F32:4,
  U64:8,I64:8,F64:8,
  F8_E4M3:1,F8_E5M2:1,
});
function req(ok,code){if(!ok)throw new Error(code);}
function plain(x){return x!==null&&typeof x==="object"&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function product(shape){
  if(shape.length===0)return 1;
  let p=1n;
  for(const n of shape){req(Number.isSafeInteger(n)&&n>=0,"SAFETENSORS_SHAPE_INVALID");p*=BigInt(n);}
  return p;
}
function sha256File(filePath,chunkBytes=1024*1024){
  req(Number.isInteger(chunkBytes)&&chunkBytes>=4096,"SAFETENSORS_CHUNK_BYTES_INVALID");
  const h=crypto.createHash("sha256"),fd=fs.openSync(filePath,"r"),buf=Buffer.allocUnsafe(chunkBytes);
  let pos=0;
  try{
    const size=fs.fstatSync(fd).size;
    while(pos<size){const n=fs.readSync(fd,buf,0,Math.min(buf.length,size-pos),pos);req(n>0,"SAFETENSORS_FILE_READ_FAILURE");h.update(buf.subarray(0,n));pos+=n;}
  }finally{fs.closeSync(fd);}
  return h.digest("hex");
}
function inspectSafetensorsFile(filePath,expected={}){
  req(typeof filePath==="string"&&filePath.length>0,"SAFETENSORS_PATH_REQUIRED");
  const stat=fs.statSync(filePath);req(stat.isFile(),"SAFETENSORS_FILE_REQUIRED");
  req(stat.size>=10,"SAFETENSORS_FILE_TOO_SMALL");
  if(expected.bytes!==undefined)req(Number.isSafeInteger(expected.bytes)&&stat.size===expected.bytes,"SAFETENSORS_BYTE_COUNT_MISMATCH");
  if(expected.sha256!==undefined){
    req(typeof expected.sha256==="string"&&/^[0-9a-f]{64}$/.test(expected.sha256),"SAFETENSORS_EXPECTED_SHA256_INVALID");
    req(sha256File(filePath)===expected.sha256,"SAFETENSORS_HASH_MISMATCH");
  }
  const fd=fs.openSync(filePath,"r");
  let headerLength,headerBuffer;
  try{
    const prefix=Buffer.alloc(8);req(fs.readSync(fd,prefix,0,8,0)===8,"SAFETENSORS_PREFIX_READ_FAILURE");
    const n=prefix.readBigUInt64LE(0);req(n>0n&&n<=BigInt(MAX_HEADER_BYTES),"SAFETENSORS_HEADER_LENGTH_INVALID");
    req(n<=BigInt(Number.MAX_SAFE_INTEGER),"SAFETENSORS_HEADER_LENGTH_UNSAFE");
    headerLength=Number(n);req(8+headerLength<=stat.size,"SAFETENSORS_HEADER_TRUNCATED");
    headerBuffer=Buffer.alloc(headerLength);req(fs.readSync(fd,headerBuffer,0,headerLength,8)===headerLength,"SAFETENSORS_HEADER_READ_FAILURE");
  }finally{fs.closeSync(fd);}
  let header;try{header=JSON.parse(headerBuffer.toString("utf8"));}catch{throw new Error("SAFETENSORS_HEADER_JSON_INVALID");}
  req(plain(header),"SAFETENSORS_HEADER_OBJECT_REQUIRED");
  const metadata=header.__metadata__===undefined?{}:header.__metadata__;
  req(plain(metadata),"SAFETENSORS_METADATA_INVALID");
  for(const [k,v] of Object.entries(metadata)){req(typeof k==="string"&&typeof v==="string","SAFETENSORS_METADATA_STRING_REQUIRED");}
  const dataStart=8+headerLength,dataBytes=stat.size-dataStart;
  const tensors=[];
  for(const [name,entry] of Object.entries(header)){
    if(name==="__metadata__")continue;
    req(typeof name==="string"&&name.length>0&&plain(entry),"SAFETENSORS_TENSOR_ENTRY_INVALID");
    req(Object.prototype.hasOwnProperty.call(DTYPE_BYTES,entry.dtype),"SAFETENSORS_DTYPE_UNSUPPORTED");
    req(Array.isArray(entry.shape),"SAFETENSORS_SHAPE_REQUIRED");
    req(Array.isArray(entry.data_offsets)&&entry.data_offsets.length===2,"SAFETENSORS_OFFSETS_REQUIRED");
    const [start,end]=entry.data_offsets;
    req(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start,"SAFETENSORS_OFFSETS_INVALID");
    req(end<=dataBytes,"SAFETENSORS_OFFSET_OUT_OF_BOUNDS");
    const elements=product(entry.shape),expectedBytes=elements*BigInt(DTYPE_BYTES[entry.dtype]);
    req(BigInt(end-start)===expectedBytes,"SAFETENSORS_TENSOR_BYTE_SIZE_MISMATCH");
    tensors.push({name,dtype:entry.dtype,shape:entry.shape.slice(),start,end,elements:elements.toString()});
  }
  req(tensors.length>0,"SAFETENSORS_NO_TENSORS");
  const ordered=tensors.slice().sort((a,b)=>a.start-b.start||a.end-b.end||a.name.localeCompare(b.name));
  let cursor=0;
  for(const t of ordered){req(t.start===cursor,"SAFETENSORS_DATA_GAP_OR_OVERLAP");cursor=t.end;}
  req(cursor===dataBytes,"SAFETENSORS_DATA_NOT_FULLY_INDEXED");
  const canonical=tensors.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(t=>({name:t.name,dtype:t.dtype,shape:t.shape,start:t.start,end:t.end}));
  const fingerprint=crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  const dtypeCounts={};let totalElements=0n;
  for(const t of tensors){dtypeCounts[t.dtype]=(dtypeCounts[t.dtype]||0)+1;totalElements+=BigInt(t.elements);}
  return {
    schema:"ekg-safetensors-inspection-v1",pass:true,
    bytes:stat.size,sha256:expected.sha256||sha256File(filePath),
    headerBytes:headerLength,dataBytes,tensorCount:tensors.length,
    totalElements:totalElements.toString(),dtypeCounts,
    metadataKeys:Object.keys(metadata).sort(),
    tensorLayoutSha256:fingerprint,
    localPathEmbedded:false,deserializationPerformed:false,
    tensorValuesRead:false,...SAFETENSORS_GOVERNANCE,
  };
}
module.exports={DTYPE_BYTES,MAX_HEADER_BYTES,SAFETENSORS_GOVERNANCE,inspectSafetensorsFile,sha256File};
