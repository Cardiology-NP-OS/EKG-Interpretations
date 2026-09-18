"use strict";
const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {inspectSafetensorsFile,SAFETENSORS_GOVERNANCE}=require("../lib/safetensors_asset");

let passed=0;
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(e){console.error("FAIL "+name+": "+(e.stack||e));process.exitCode=1;}}
function makeFile(entries,metadata={source:"synthetic"}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-safetensors-")),p=path.join(dir,"model.safetensors");
  const header={__metadata__:metadata,...entries};
  let json=Buffer.from(JSON.stringify(header),"utf8");
  const pad=(8-(json.length%8))%8;if(pad)json=Buffer.concat([json,Buffer.alloc(pad,0x20)]);
  let max=0;for(const e of Object.values(entries))max=Math.max(max,e.data_offsets[1]);
  const prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(json.length));
  const body=Buffer.alloc(max);for(let i=0;i<body.length;i++)body[i]=(i*17+3)&255;
  fs.writeFileSync(p,Buffer.concat([prefix,json,body]));
  const bytes=fs.statSync(p).size,sha256=crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  return {p,dir,bytes,sha256};
}
test("governance remains challenger-only and inactive",()=>{assert.strictEqual(SAFETENSORS_GOVERNANCE.runtimeAuthority,false);assert.strictEqual(SAFETENSORS_GOVERNANCE.diagnosticRuntime,"GOVERNED_INACTIVE");});
test("valid safetensors structure verifies exact identity without tensor reads",()=>{
  const fx=makeFile({a:{dtype:"F32",shape:[2,3],data_offsets:[0,24]},b:{dtype:"I64",shape:[2],data_offsets:[24,40]}});
  const out=inspectSafetensorsFile(fx.p,{bytes:fx.bytes,sha256:fx.sha256});
  assert.strictEqual(out.tensorCount,2);assert.strictEqual(out.dataBytes,40);assert.strictEqual(out.totalElements,"8");
  assert.deepStrictEqual(out.dtypeCounts,{F32:1,I64:1});assert.strictEqual(out.deserializationPerformed,false);assert.strictEqual(out.tensorValuesRead,false);
});
test("layout fingerprint is deterministic and path neutral",()=>{
  const a=makeFile({z:{dtype:"F16",shape:[4],data_offsets:[0,8]}});
  const x=inspectSafetensorsFile(a.p),y=inspectSafetensorsFile(a.p);
  assert.strictEqual(x.tensorLayoutSha256,y.tensorLayoutSha256);assert.strictEqual(JSON.stringify(x).includes(a.dir),false);assert.strictEqual(x.localPathEmbedded,false);
});
test("hash and byte count drift fail closed",()=>{
  const fx=makeFile({a:{dtype:"U8",shape:[4],data_offsets:[0,4]}});
  assert.throws(()=>inspectSafetensorsFile(fx.p,{bytes:fx.bytes+1}),/SAFETENSORS_BYTE_COUNT_MISMATCH/);
  assert.throws(()=>inspectSafetensorsFile(fx.p,{sha256:"0".repeat(64)}),/SAFETENSORS_HASH_MISMATCH/);
});
test("shape byte mismatch fails closed",()=>{const fx=makeFile({a:{dtype:"F32",shape:[2],data_offsets:[0,4]}});assert.throws(()=>inspectSafetensorsFile(fx.p),/SAFETENSORS_TENSOR_BYTE_SIZE_MISMATCH/);});
test("gaps overlaps and trailing data fail closed",()=>{
  const gap=makeFile({a:{dtype:"U8",shape:[2],data_offsets:[0,2]},b:{dtype:"U8",shape:[2],data_offsets:[3,5]}});assert.throws(()=>inspectSafetensorsFile(gap.p),/SAFETENSORS_DATA_GAP_OR_OVERLAP/);
  const overlap=makeFile({a:{dtype:"U8",shape:[3],data_offsets:[0,3]},b:{dtype:"U8",shape:[2],data_offsets:[2,4]}});assert.throws(()=>inspectSafetensorsFile(overlap.p),/SAFETENSORS_DATA_GAP_OR_OVERLAP/);
  const trail=makeFile({a:{dtype:"U8",shape:[2],data_offsets:[0,2]},b:{dtype:"U8",shape:[1],data_offsets:[2,3]}});fs.appendFileSync(trail.p,Buffer.from([0]));assert.throws(()=>inspectSafetensorsFile(trail.p),/SAFETENSORS_DATA_NOT_FULLY_INDEXED/);
});
test("out of bounds and unsupported dtypes fail closed",()=>{
  const oob=makeFile({a:{dtype:"U8",shape:[5],data_offsets:[0,5]}});fs.truncateSync(oob.p,oob.bytes-1);assert.throws(()=>inspectSafetensorsFile(oob.p),/SAFETENSORS_OFFSET_OUT_OF_BOUNDS|SAFETENSORS_TENSOR_BYTE_SIZE_MISMATCH/);
  const bad=makeFile({a:{dtype:"X99",shape:[1],data_offsets:[0,1]}});assert.throws(()=>inspectSafetensorsFile(bad.p),/SAFETENSORS_DTYPE_UNSUPPORTED/);
});
test("metadata is strings only",()=>{const fx=makeFile({a:{dtype:"U8",shape:[1],data_offsets:[0,1]}},{bad:"ok"});const buf=fs.readFileSync(fx.p);assert.strictEqual(inspectSafetensorsFile(fx.p).metadataKeys[0],"bad");});
if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-safetensors-asset-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
