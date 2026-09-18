"use strict";
const assert=require("assert"),crypto=require("crypto"),fs=require("fs"),os=require("os"),path=require("path");
const {spawnSync}=require("child_process");
let passed=0;function test(n,f){try{f();passed++;console.log("PASS "+n);}catch(e){console.error("FAIL "+n+": "+(e.stack||e));process.exitCode=1;}}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-safe-cli-")),asset=path.join(dir,"m.safetensors"),out=path.join(dir,"out.json");
  const h={a:{dtype:"F32",shape:[2],data_offsets:[0,8]}};let j=Buffer.from(JSON.stringify(h));const pad=(8-j.length%8)%8;j=Buffer.concat([j,Buffer.alloc(pad,32)]);
  const p=Buffer.alloc(8);p.writeBigUInt64LE(BigInt(j.length));fs.writeFileSync(asset,Buffer.concat([p,j,Buffer.alloc(8)]));
  const bytes=fs.statSync(asset).size,sha=crypto.createHash("sha256").update(fs.readFileSync(asset)).digest("hex");return{dir,asset,out,bytes,sha};
}
function run(fx,extra=[]){const tool=path.resolve(__dirname,"../tools/inspect_safetensors.js");return spawnSync(process.execPath,[tool,"--asset",fx.asset,"--expected-bytes",String(fx.bytes),"--expected-sha256",fx.sha,"--out",fx.out,...extra],{encoding:"utf8"});}
test("CLI writes path-neutral exact inspection",()=>{const fx=fixture(),r=run(fx);assert.strictEqual(r.status,0,r.stderr);const x=JSON.parse(fs.readFileSync(fx.out));assert.strictEqual(x.pass,true);assert.strictEqual(x.tensorCount,1);assert.strictEqual(JSON.stringify(x).includes(fx.dir),false);});
test("CLI rejects bad expected hash",()=>{const fx=fixture(),tool=path.resolve(__dirname,"../tools/inspect_safetensors.js"),r=spawnSync(process.execPath,[tool,"--asset",fx.asset,"--expected-sha256","0".repeat(64)],{encoding:"utf8"});assert.notStrictEqual(r.status,0);assert.match(r.stderr,/SAFETENSORS_HASH_MISMATCH/);});
test("CLI requires explicit asset",()=>{const tool=path.resolve(__dirname,"../tools/inspect_safetensors.js"),r=spawnSync(process.execPath,[tool],{encoding:"utf8"});assert.notStrictEqual(r.status,0);assert.match(r.stderr,/SAFETENSORS_ARG_REQUIRED/);});
if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-safetensors-cli-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
