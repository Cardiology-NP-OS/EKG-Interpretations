"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
const checkpoint=read("ECG_SIGNAL_INTELLIGENCE_WORKFLOW_CHECKPOINT.json");
const capabilities=read("ECG_CAPABILITY_REGISTRY.json");
const donorRegistry=read("ECG_DONOR_REGISTRY.json");
const contract=read("evaluation/protocols/RHYTHM_FEATURE_AND_CANDIDATE_CONTRACT.json");
const pkg=read("package.json");
let passed=0;
const check=(name,fn)=>{fn();passed+=1;console.log(`PASS ${name}`);};

check("checkpoint is anchored to accepted fiducial workflow main",()=>{
  assert.strictEqual(checkpoint.parentMainCommit,"5450bc23bfcab536a77f88ee28d4488a22c29204");
  assert.strictEqual(checkpoint.parentMainTree,"3dfea69a0f824fdfd3f589d42ad6a6e520a706dd");
});
check("all declared implementation artifacts exist",()=>{
  for(const p of checkpoint.implementation) assert.ok(fs.existsSync(path.join(root,p)),p);
});
check("canonical beat rhythm capability points to executable evaluation workflow",()=>{
  const c=capabilities.capabilities.find(x=>x.capability_id==="ECG-CAP-EVENT-BEAT-RHYTHM-REPRESENTATION");
  assert.strictEqual(c.canonical_target_path,"lib/signal_intelligence_workflow.js");
  assert.strictEqual(c.implementation_status,"TARGET_OWNED_EVALUATION_IMPLEMENTATION");
  assert.strictEqual(c.runtime_status,"INACTIVE_EVALUATION_ONLY");
});
check("HRV research capability is backed by target-owned feature implementation",()=>{
  const c=capabilities.capabilities.find(x=>x.capability_id==="ECG-CAP-RESEARCH-HRV");
  assert.strictEqual(c.canonical_target_path,"lib/rhythm_feature_contract.js");
  assert.strictEqual(c.implementation_status,"TARGET_OWNED_EVALUATION_IMPLEMENTATION");
  assert.strictEqual(c.runtime_status,"INACTIVE_EVALUATION_ONLY");
});
check("evaluation contract remains explicitly non-diagnostic",()=>{
  assert.strictEqual(contract.authorityClass,"EVALUATION_NONRUNTIME");
  assert.strictEqual(contract.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(contract.projectGold,false);
  assert.strictEqual(contract.metrics,"NOT_REPORTABLE");
  assert.ok(contract.rules.some(x=>x.includes("not diagnoses")));
});
check("donor frontier remains paused without changing completion",()=>{
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier,"DONOR-010");
  assert.ok(donorRegistry.completed_donors>=9);
  if(donorRegistry.completed_donors>9)assert.notStrictEqual(donorRegistry.next_donor_id,checkpoint.donorProgram.pausedFrontier);
});
check("governed clinical state remains unchanged",()=>{
  assert.strictEqual(checkpoint.candidatePhenotypesAreDiagnoses,false);
  assert.strictEqual(checkpoint.clinicalControlChanged,false);
  assert.strictEqual(checkpoint.clinicalAuthorityAdded,false);
  assert.strictEqual(checkpoint.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(checkpoint.evidenceAdmission,"NOT_ADMITTED");
  assert.strictEqual(checkpoint.approvedAdjudicatedGoldCount,0);
  assert.strictEqual(checkpoint.metrics,"NOT_REPORTABLE");
  assert.strictEqual(checkpoint.activation,"NOT_ELIGIBLE");
  assert.strictEqual(checkpoint.clinicalValidity,"NOT_INFERRED");
});
check("CLI and tests are wired into package scripts",()=>{
  assert.strictEqual(pkg.scripts["analyze:wfdb"],"node tools/analyze_wfdb.js");
  assert.ok(pkg.scripts["test:ci"].includes("tests/rhythm_feature_contract.test.js"));
  assert.ok(pkg.scripts["test:ci"].includes("tests/signal_intelligence_workflow.test.js"));
  assert.ok(pkg.scripts["test:ci"].includes("tests/signal_intelligence_checkpoint.test.js"));
});
check("implementation verification is exact and successful",()=>{
  const v=checkpoint.verification;
  assert.strictEqual(v.implementationCandidateCommit,"f058b332f59b7550b4a22243d2fdcee985949401");
  assert.strictEqual(v.implementationCandidateTree,"474e1a3a6d229e3be2b817efb2649486cf118032");
  assert.strictEqual(v.candidateCiRunId,35270180054);
  assert.strictEqual(v.candidateCiConclusion,"success");
  assert.strictEqual(v.independentVerification,"PASS");
  assert.strictEqual(v.independentRhythmFeatures,"14/14 PASS");
  assert.strictEqual(v.independentWorkflow,"9/9 PASS");
  assert.strictEqual(v.independentCheckpoint,"9/9 PASS");
  assert.strictEqual(v.independentFullTargetSuite,"PASS");
});
check("accepted checkpoint binds promotion and target-main CI",()=>{
  if(checkpoint.status!=="ACCEPTED_ON_MAIN") return;
  const v=checkpoint.verification,p=checkpoint.promotion;
  assert.strictEqual(v.promotionCandidateCommit,"c56547ff9127a9f01d27681da5757c019cbebb95");
  assert.strictEqual(v.promotionCandidateTree,"759097960d3c0e05036ec820d43676d33144169a");
  assert.strictEqual(v.promotionCandidateCiRunId,35270550674);
  assert.strictEqual(v.promotionCandidateCiConclusion,"success");
  assert.strictEqual(v.promotionCandidateIndependentVerification,"PASS");
  assert.strictEqual(p.mergeCommit,"e620790a2a0e90c495051d3a616828480f0a1d9b");
  assert.strictEqual(p.mergeTree,"759097960d3c0e05036ec820d43676d33144169a");
  assert.deepStrictEqual(p.parents,["5450bc23bfcab536a77f88ee28d4488a22c29204","c56547ff9127a9f01d27681da5757c019cbebb95"]);
  assert.strictEqual(p.targetMainCiRunId,35270846939);
  assert.strictEqual(p.targetMainCiConclusion,"success");
});
check("checkpoint status is stage-safe",()=>{
  assert.ok(new Set(["IMPLEMENTATION_CANDIDATE_UNVERIFIED","VERIFIED_IMPLEMENTATION_EVIDENCE_BOUND","ACCEPTED_ON_MAIN"]).has(checkpoint.status));
});
console.log(JSON.stringify({
  schema:"ekg-signal-intelligence-checkpoint-tests-v1",
  pass:true,
  passed,
  total:passed,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  clinicalAuthorityAdded:false
}));
