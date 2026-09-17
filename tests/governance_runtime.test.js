"use strict";
const assert=require("assert");
const fs=require("fs");
const ledger=require("../ECG_LICENSE_LEDGER.json");
const {REQUIRED_GOVERNED_STATE,assertGovernedInactiveState,buildDependencyFingerprint,sha256,validateLicenseLedger,validateSourceIdentity}=require("../lib/governance_runtime");
let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}

test("governed inactive state validates exactly",()=>{
  const out=assertGovernedInactiveState({...REQUIRED_GOVERNED_STATE});assert.strictEqual(out.pass,true);assert.strictEqual(out.activation,"NOT_ELIGIBLE");
});
test("any authority-state drift fails closed",()=>{
  for(const [key,value] of [["diagnosticRuntime","ACTIVE"],["evidenceAdmission","ADMITTED"],["approvedAdjudicatedGoldCount",1],["metrics","REPORTABLE"],["activation","ELIGIBLE"],["clinicalValidity","INFERRED"]]){
    assert.throws(()=>assertGovernedInactiveState({...REQUIRED_GOVERNED_STATE,[key]:value}),new RegExp(`GOVERNANCE_STATE_MISMATCH:${key}`));
  }
});
test("exact source identity validates immutable git fields",()=>{
  const out=validateSourceIdentity({commit:"a".repeat(40),tree:"b".repeat(40),sha256:"c".repeat(64),locator:"donors/example/manifest.json"});
  assert.strictEqual(out.commit,"a".repeat(40));
});
test("mutable remote and malformed source identity fail closed",()=>{
  assert.throws(()=>validateSourceIdentity({commit:"a".repeat(40),tree:"b".repeat(40),locator:"https://example.com/main"}),/GOVERNANCE_MUTABLE_REMOTE_REJECTED/);
  assert.throws(()=>validateSourceIdentity({commit:"bad",tree:"b".repeat(40)}),/GOVERNANCE_SOURCE_COMMIT_FORMAT/);
});test("live license ledger validates while surfacing unresolved boundaries",()=>{
  const out=validateLicenseLedger(ledger);
  assert.strictEqual(out.pass,true);
  assert.strictEqual(out.entryCount,ledger.entries.length);
  assert.ok(out.unresolved.some(x=>x.donorId==="DONOR-006"&&x.assetClass==="source_code"));
  assert.strictEqual(out.failClosedOnUnknownLicense,true);
});
test("unresolved imported data and weights are rejected",()=>{
  const data=JSON.parse(JSON.stringify(ledger));
  const d=data.entries.find(x=>x.dataset_fixture_license&&/LICENSE_REVIEW_REQUIRED/.test(x.dataset_fixture_license.status));
  d.dataset_fixture_license.imported=true;
  assert.throws(()=>validateLicenseLedger(data),/GOVERNANCE_UNLICENSED_DATA_IMPORTED/);
  const model=JSON.parse(JSON.stringify(ledger));
  const m=model.entries.find(x=>x.model_weight_license&&/LICENSE_REVIEW_REQUIRED/.test(x.model_weight_license.status));
  m.model_weight_license.weights_imported=true;
  assert.throws(()=>validateLicenseLedger(model),/GOVERNANCE_UNLICENSED_MODEL_IMPORTED/);
});
test("source code cannot be copied through unresolved licensing",()=>{
  const copy=JSON.parse(JSON.stringify(ledger));const row=copy.entries.find(x=>x.donor_id==="DONOR-006");row.copied_source_code=true;
  assert.throws(()=>validateLicenseLedger(copy),/GOVERNANCE_UNLICENSED_SOURCE_COPIED/);
});test("dependency fingerprint is deterministic and drift-sensitive",()=>{
  const packageBytes=fs.readFileSync(require.resolve("../package.json"));
  const base={packageJsonBytes:packageBytes,runtimeVersions:{node:process.version},artifactHashes:{registry:sha256(Buffer.from("registry"))}};
  const one=buildDependencyFingerprint(base),two=buildDependencyFingerprint(base);
  const changed=buildDependencyFingerprint({...base,runtimeVersions:{node:"v0.0.0"}});
  assert.strictEqual(one.fingerprintSha256,two.fingerprintSha256);
  assert.notStrictEqual(one.fingerprintSha256,changed.fingerprintSha256);
  assert.strictEqual(one.payload.mutableRemoteResolution,false);
});
test("dependency fingerprint rejects malformed artifact hashes",()=>{
  assert.throws(()=>buildDependencyFingerprint({packageJsonBytes:Buffer.from("{}"),runtimeVersions:{node:"x"},artifactHashes:{x:"bad"}}),/GOVERNANCE_ARTIFACT_HASH:x/);
});
if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-governance-runtime-tests-v1",pass:true,passed,total:passed,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
