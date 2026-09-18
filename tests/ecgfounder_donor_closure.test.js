"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
const manifest=read("donors/pkudigitalhealth_ecgfounder/DONOR_MANIFEST.json");
const inventory=read("donors/pkudigitalhealth_ecgfounder/INVENTORY.json");
const gap=read("donors/pkudigitalhealth_ecgfounder/GAP_MATRIX.json");
const license=read("donors/pkudigitalhealth_ecgfounder/LICENSE_BOUNDARY.json");
const data=read("donors/pkudigitalhealth_ecgfounder/DATASET_BOUNDARY.json");
const model=read("donors/pkudigitalhealth_ecgfounder/MODEL_BOUNDARY.json");
const modelSpec12=read("donors/pkudigitalhealth_ecgfounder/MODEL_ASSET_SPEC_12LEAD.json");
const modelSpec1=read("donors/pkudigitalhealth_ecgfounder/MODEL_ASSET_SPEC_1LEAD.json");
const donorRegistry=read("ECG_DONOR_REGISTRY.json");
const donor=donorRegistry.donors.find(x=>x.donor_id==="DONOR-011");
const dcap=read("ECG_DONOR_CAPABILITY_REGISTRY.json");
const canon=read("ECG_CAPABILITY_REGISTRY.json");
const models=read("ECG_MODEL_CHALLENGER_REGISTRY.json");
const licenses=read("ECG_LICENSE_LEDGER.json");
const datasets=read("ECG_DATASET_REGISTRY.json");
const pkg=read("package.json");
let passed=0;const check=(n,f)=>{f();passed++;console.log("PASS "+n);};
const allowed=new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);

check("exact upstream commit tree and MIT source license are pinned",()=>{
  assert.strictEqual(manifest.audited_head.commit,"04edac702b61c91face519774ddcc0cd712fef23");
  assert.strictEqual(manifest.audited_head.tree,"dea32e6ad4755caed718f96df19b5a06171c48b1");
  assert.strictEqual(manifest.software_license.spdx,"MIT");
  assert.strictEqual(manifest.software_license.license_blob_sha,"689c66875909c6eb6eea1cc8fe82ee8d49d4a8c4");
});
check("whole donor repository inventory is exact and complete",()=>{
  assert.strictEqual(inventory.recursive_tree_audit.complete,true);
  assert.strictEqual(inventory.recursive_tree_audit.tracked_file_count,13);
  assert.strictEqual(inventory.recursive_tree_audit.tracked_bytes,25569159);
  assert.strictEqual(inventory.tracked_files.length,13);
  assert.strictEqual(inventory.package_summary.upstream_tests,0);
});
check("model repository revision and both external checkpoint hashes are exact",()=>{
  assert.strictEqual(model.huggingface.revision,"d9b1793951b2342f5f7e84f1ac03cd37f8a08724");
  assert.strictEqual(model.huggingface.license,"MIT");
  const xs=model.huggingface.checkpoints;
  assert.strictEqual(xs.length,2);
  assert.strictEqual(xs[0].sha256,"ee199f3781f4ae1f732973267f003da0a759ea12bddb0dd28a77faa60aca7997");
  assert.strictEqual(xs[1].sha256,"f863a38897fb49a27fec7e44008ea3c7bdbd29c77fa4a02ecbb8c56df4f37603");
  assert.strictEqual(model.weights_imported,false);
  assert.strictEqual(model.runtime_authority,false);
});
check("checkpoint identity specs are executable through the streaming verifier",()=>{
  assert.strictEqual(modelSpec12.sha256,"ee199f3781f4ae1f732973267f003da0a759ea12bddb0dd28a77faa60aca7997");
  assert.strictEqual(modelSpec12.bytes,369942585);
  assert.strictEqual(modelSpec1.sha256,"f863a38897fb49a27fec7e44008ea3c7bdbd29c77fa4a02ecbb8c56df4f37603");
  assert.strictEqual(modelSpec1.bytes,369807481);
  for(const spec of [modelSpec12,modelSpec1]) assert.strictEqual(spec.serializationPolicy,"IDENTITY_ONLY_NO_DESERIALIZATION");
  assert.ok(fs.existsSync(path.join(root,"tools/verify_model_asset.js")));
  assert.ok(pkg.scripts["test:ci"].includes("tests/model_asset_file_cli.test.js"));
});
check("donor preprocessing semantics are now executable target code",()=>{
  assert.strictEqual(model.preprocessing_contract.target_implementation,"lib/signal_dsp_filtering.js");
  assert.ok(fs.existsSync(path.join(root,"lib/signal_dsp_filtering.js")));
  assert.ok(pkg.scripts["test:ci"].includes("tests/signal_dsp_filtering.test.js"));
  assert.ok(fs.readFileSync(path.join(root,"lib/signal_preprocessing_pipeline.js"),"utf8").includes("applyFoundationPretrainingProfile"));
});
check("tracked CSV assets remain outside target and non-gold",()=>{
  assert.strictEqual(data.raw_dataset_bytes_imported,false);
  assert.strictEqual(data.source_labels_promoted_to_project_gold,false);
  assert.strictEqual(license.tracked_data_assets.target_copy_allowed,false);
  assert.strictEqual(datasets.approved_adjudicated_project_gold_count,0);
});
check("all nineteen material donor capabilities have terminal dispositions",()=>{
  assert.strictEqual(gap.rows.length,19);
  const rows=dcap.capabilities.filter(x=>x.donor==="PKUDigitalHealth/ECGFounder"&&x.donor_commit==="04edac702b61c91face519774ddcc0cd712fef23");
  assert.strictEqual(rows.length,19);
  for(const row of rows) assert.ok(allowed.has(row.disposition),row.capability_id);
  assert.ok(dcap.capability_count>=290);
});
check("every Donor 011 capability maps exactly once to a canonical capability",()=>{
  const hits=new Map();
  for(const c of canon.capabilities) for(const id of c.source_capabilities||[]) if(id.startsWith("PFD-")) hits.set(id,(hits.get(id)||0)+1);
  for(let i=1;i<=19;i++){const id="PFD-"+String(i).padStart(3,"0");assert.strictEqual(hits.get(id),1,id);}
  assert.ok(canon.capability_count>=57);
});
check("unsafe donor execution paths are explicitly rejected",()=>{
  for(const id of ["PFD-017","PFD-018","PFD-019"]) assert.strictEqual(gap.rows.find(x=>x.capability_id===id).decision,"REJECTED");
  assert.strictEqual(model.admission_contract.unsafe_or_partial_state_dict_loading,"REJECT");
});
check("two exact external model challengers remain non-authoritative",()=>{
  const ms=models.models.filter(x=>x.donor_id==="DONOR-011");
  assert.strictEqual(ms.length,2);
  for(const x of ms){
    assert.ok(/^[0-9a-f]{64}$/.test(x.checkpoint_hash));
    assert.strictEqual(x.weights_imported,false);
    assert.strictEqual(x.runtime_authority,false);
    assert.strictEqual(x.clinical_validity,"NOT_INFERRED");
    assert.strictEqual(x.validation_contract.target_metrics,"NOT_REPORTABLE");
  }
});
check("license ledger separates code weights and tracked data assets",()=>{
  const x=licenses.entries.find(e=>e.donor_id==="DONOR-011");
  assert.ok(x);
  assert.strictEqual(x.source_code_license.spdx,"MIT");
  assert.strictEqual(x.model_weight_license.weights_imported,false);
  assert.match(x.dataset_license.status,/LICENSE_REVIEW_REQUIRED/);
  assert.strictEqual(x.dataset_license.source_labels_promoted_to_project_gold,false);
});
check("candidate or accepted donor frontier remains stage safe",()=>{
  const receipt=path.join(root,"donors/pkudigitalhealth_ecgfounder/DONOR_RECEIPT.json");
  if(donor.status==="ACCEPTED_ON_MAIN"){
    assert.ok(donorRegistry.completed_donors>=11);
    assert.notStrictEqual(donorRegistry.next_donor_id,"DONOR-011");
    assert.strictEqual(donor.receipt_status,"FINALIZED");
    assert.strictEqual(fs.existsSync(receipt),true);
  } else {
    assert.strictEqual(donorRegistry.completed_donors,10);
    assert.strictEqual(donorRegistry.next_donor_id,"DONOR-011");
    assert.strictEqual(donor.status,"AUDITED_CANDIDATE_FOR_MERGE");
    assert.ok(donor.receipt_status.startsWith("PENDING_"));
    assert.strictEqual(fs.existsSync(receipt),false);
  }
});
check("accepted receipt binds verified candidate promotion and target-main CI",()=>{
  if(donor.status==="ACCEPTED_ON_MAIN"){
    const receipt=read("donors/pkudigitalhealth_ecgfounder/DONOR_RECEIPT.json");
    assert.strictEqual(receipt.acceptance_state,"ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
    assert.strictEqual(receipt.target_resulting_implementation.verified_candidate_commit,donor.verified_candidate_commit);
    assert.strictEqual(receipt.promotion.merge_commit,donor.promotion_commit);
    assert.strictEqual(receipt.promotion.target_main_ci_run_id,donor.target_main_ci_run_id);
    assert.strictEqual(receipt.verification.verification_record_commit,donor.verification_record_commit);
    assert.strictEqual(receipt.boundaries.exact_12lead_checkpoint_synthetic_smoke_executed,true);
    assert.strictEqual(receipt.boundaries.clinical_authority_added,false);
  }
});
check("governed inactive state remains explicit",()=>{
  assert.strictEqual(canon.diagnostic_runtime,"GOVERNED_INACTIVE");
  assert.strictEqual(canon.evidence_admission,"NOT_ADMITTED");
  assert.strictEqual(canon.approved_adjudicated_gold_count,0);
  assert.strictEqual(canon.metrics,"NOT_REPORTABLE");
  assert.strictEqual(canon.activation,"NOT_ELIGIBLE");
  assert.strictEqual(canon.clinical_validity,"NOT_INFERRED");
  assert.strictEqual(donor.clinical_authority_added,false);
});
console.log(JSON.stringify({schema:"ekg-donor-011-closure-tests-v1",donor:"PKUDigitalHealth/ECGFounder",pass:true,passed,total:passed,completed_donors:donorRegistry.completed_donors,next_donor_id:donorRegistry.next_donor_id,diagnostic_runtime:"GOVERNED_INACTIVE",metrics:"NOT_REPORTABLE",clinical_authority_added:false}));
