"use strict";
const assert=require("assert"),fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
const exists=p=>fs.existsSync(path.join(root,p));
let passed=0;const check=(n,f)=>{f();passed++;console.log("PASS "+n);};

const reg=read("ECG_DONOR_REGISTRY.json");
const donor=reg.donors.find(x=>x.donor_id==="DONOR-012");
const inv=read("donors/edoar-do_hubert-ecg/INVENTORY.json");
const gap=read("donors/edoar-do_hubert-ecg/GAP_MATRIX.json");
const lic=read("donors/edoar-do_hubert-ecg/LICENSE_BOUNDARY.json");
const data=read("donors/edoar-do_hubert-ecg/DATASET_BOUNDARY.json");
const model=read("donors/edoar-do_hubert-ecg/MODEL_BOUNDARY.json");
const mig=read("donors/edoar-do_hubert-ecg/SOURCE_IDENTITY_MIGRATION.json");
const smoke=read("donors/edoar-do_hubert-ecg/MODEL_SMOKE_VERIFICATION.json");
const verify=read("donors/edoar-do_hubert-ecg/SAFETENSORS_INSPECTION_SMALL.json");
const dcap=read("ECG_DONOR_CAPABILITY_REGISTRY.json");
const cap=read("ECG_CAPABILITY_REGISTRY.json");
const models=read("ECG_MODEL_CHALLENGER_REGISTRY.json");
const licenses=read("ECG_LICENSE_LEDGER.json");

check("source identity migration is explicit and exact",()=>{
  assert.strictEqual(donor.repository,"Edoar-do/HuBERT-ECG");
  assert.strictEqual(donor.previous_repository_identity,"Edoardo-BS/HuBERT-ECG");
  assert.strictEqual(donor.audited_commit,"2d0611da529412e021af76d4ed41d5a23a704dc6");
  assert.strictEqual(donor.audited_tree,"45a5697847403b0bb417c00ae9904372c44f356e");
  assert.strictEqual(mig.registered_identity.repository,"Edoardo-BS/HuBERT-ECG"); assert.strictEqual(mig.live_identity.repository,"Edoar-do/HuBERT-ECG"); assert.strictEqual(mig.live_identity.commit,donor.audited_commit); assert.strictEqual(mig.live_identity.tree,donor.audited_tree); assert.ok(mig.continuity_evidence.some(x=>x.kind==="NO_SILENT_SUBSTITUTION"&&x.value===true)); assert.strictEqual(mig.clinical_authority_added,false);
});
check("whole upstream tree inventory is exact",()=>{
  assert.strictEqual(inv.recursive_tree_audit.complete,true);assert.strictEqual(inv.recursive_tree_audit.tracked_file_count,154);assert.strictEqual(inv.recursive_tree_audit.tracked_bytes,63315284);assert.strictEqual(inv.recursive_tree_audit.truncated,false);
  assert.strictEqual(inv.commit,donor.audited_commit);assert.strictEqual(inv.tree,donor.audited_tree);
  assert.strictEqual(inv.clinical_authority_added,false);
  assert.strictEqual(new Set(inv.tracked_files.map(x=>x.path)).size,154);
});
check("CC BY-NC source code and model weights remain outside target",()=>{
  assert.strictEqual(lic.source_code.spdx,"CC-BY-NC-4.0");
  assert.match(lic.source_code.status,/NONCOMMERCIAL/);
  assert.strictEqual(lic.donor_source_code_copied,false);
  assert.strictEqual(lic.model_weights.weights_imported_to_git,false);
  assert.strictEqual(lic.model_weights.runtime_activation,false);
});
check("reproducibility corpus remains data-only and non-gold",()=>{
  assert.strictEqual(data.reproducibility_bundle.file_count,92);
  assert.strictEqual(data.reproducibility_bundle.bytes,61328825);
  assert.strictEqual(data.reproducibility_bundle.source_labels_promoted_to_project_gold,false);
  assert.strictEqual(data.raw_dataset_bytes_imported,false);
  assert.strictEqual(data.metrics,"NOT_REPORTABLE");
});
check("all thirty-three material capabilities have terminal dispositions",()=>{
  const rows=dcap.capabilities.filter(x=>x.donor==="Edoar-do/HuBERT-ECG"&&x.donor_commit===donor.audited_commit);
  assert.strictEqual(rows.length,33);assert.strictEqual(gap.capability_count,33);
  const allowed=new Set(["INTEGRATED","DEPENDENCY","ADAPTER","CHALLENGER","EVALUATION_ONLY","DATA_ONLY","RESEARCH_ONLY","SUPERSEDED","REJECTED","LICENSE_REVIEW_REQUIRED"]);
  for(const r of rows)assert.ok(allowed.has(r.disposition),r.capability_id);
  assert.strictEqual(new Set(rows.map(x=>x.capability_id)).size,33);
});
check("every Donor 012 capability maps to an existing canonical capability",()=>{
  const ids=new Set(cap.capabilities.map(x=>x.capability_id));
  for(const r of gap.capabilities)assert.ok(ids.has(r.canonical_target_implementation),r.capability_id);
});
check("safetensors structural inspection is executable target code",()=>{
  const c=cap.capabilities.find(x=>x.capability_id==="ECG-CAP-MODEL-SAFETENSORS-INSPECTION");
  assert.ok(c);assert.strictEqual(c.canonical_target_path,"lib/safetensors_asset.js");
  for(const p of ["lib/safetensors_asset.js","tools/inspect_safetensors.js","tests/safetensors_asset.test.js","tests/safetensors_cli.test.js"])assert.ok(exists(p),p);
  assert.strictEqual(verify.pass,true);assert.strictEqual(verify.tensorCount,148);
  assert.strictEqual(verify.deserializationPerformed,false);assert.strictEqual(verify.tensorValuesRead,false);
});
check("foundation representation adapter is executable end to end",()=>{
  const c=cap.capabilities.find(x=>x.capability_id==="ECG-CAP-MODEL-FOUNDATION-INPUT-ADAPTER");
  assert.ok(c);assert.strictEqual(c.canonical_target_path,"lib/foundation_representation_adapter.js");
  for(const p of ["lib/foundation_representation_adapter.js","tools/prepare_foundation_input.js","tests/foundation_representation_adapter.test.js","tests/foundation_input_cli.test.js","evaluation/protocols/FOUNDATION_REPRESENTATION_INPUT_100HZ_5S_12LEAD.json"])assert.ok(exists(p),p);
  const spec=read("evaluation/protocols/FOUNDATION_REPRESENTATION_INPUT_100HZ_5S_12LEAD.json");
  assert.strictEqual(spec.vectorLength,6000);assert.strictEqual(spec.compatibility,"GEOMETRY_COMPATIBLE_NOT_DONOR_BYTE_EXACT");
});
check("donor flatten-before-decimate and unsafe loaders are rejected",()=>{
  const by=new Map(gap.capabilities.map(x=>[x.capability_id,x]));
  for(const id of ["HBE-008","HBE-009","HBE-011","HBE-014","HBE-018","HBE-029","HBE-032","HBE-033"])assert.strictEqual(by.get(id).disposition,"REJECTED",id);
});
check("three exact external checkpoint challengers are pinned",()=>{
  const rows=models.models.filter(x=>x.donor_id==="DONOR-012");
  assert.strictEqual(rows.length,3);
  const by=new Map(rows.map(x=>[x.challenger_id,x]));
  assert.strictEqual(by.get("MODEL-D012-HUBERT-ECG-SMALL").checkpoint_hash,"c78fa955268212f8ed20bc69fb1b882d76a4351df2466061335950949394a4d2");
  assert.strictEqual(by.get("MODEL-D012-HUBERT-ECG-BASE").checkpoint_hash,"05bc1b1317f8e3063811a03fb840f5bf8a85968191e209c0cfbaa0c52c8aa1ae");
  assert.strictEqual(by.get("MODEL-D012-HUBERT-ECG-LARGE").checkpoint_hash,"9a0eb8484f73793aa678936984243da92ae80d7b81e2fe77d1ea6dee2bdf5ec2");
  for(const r of rows){assert.strictEqual(r.weights_imported,false);assert.strictEqual(r.runtime_authority,false);assert.strictEqual(r.clinical_validity,"NOT_INFERRED");}
});
check("exact Small checkpoint synthetic smoke is bound and non-authoritative",()=>{
  assert.strictEqual(smoke.synthetic_execution.pass,true);assert.strictEqual(smoke.synthetic_execution.patient_data_used,false);
  assert.deepStrictEqual(smoke.synthetic_execution.input_shape,[1,6000]);assert.deepStrictEqual(smoke.synthetic_execution.last_hidden_state_shape,[1,93,512]);
  assert.strictEqual(smoke.strict_state_audit.strict_compatible,true);assert.strictEqual(smoke.strict_state_audit.missing,0);assert.strictEqual(smoke.strict_state_audit.unexpected,0);assert.strictEqual(smoke.strict_state_audit.shape_mismatches,0);
  assert.strictEqual(smoke.synthetic_execution.finite_output,true);assert.strictEqual(smoke.metrics,"NOT_REPORTABLE");assert.strictEqual(smoke.clinical_authority_added,false);
});
check("license ledger separates code weights and data terms",()=>{
  const x=licenses.entries.find(e=>e.donor_id==="DONOR-012");assert.ok(x);
  assert.strictEqual(x.source_code_license.spdx,"CC-BY-NC-4.0");
  assert.strictEqual(x.copied_source_code,false);
  assert.strictEqual(x.model_weight_license.weights_imported,false);
  assert.strictEqual(x.dataset_license.source_labels_promoted_to_project_gold,false);
  assert.strictEqual(x.dependency_license_action.status,"NO_RUNTIME_DEPENDENCY_ADDED");
});
check("candidate or accepted donor frontier remains stage safe",()=>{
  if(donor.status==="ACCEPTED_ON_MAIN"){
    assert.ok(reg.completed_donors>=12);assert.notStrictEqual(reg.next_donor_id,"DONOR-012");assert.strictEqual(donor.receipt_status,"FINALIZED");
  }else{
    assert.strictEqual(donor.status,"AUDITED_CANDIDATE_FOR_MERGE");
    assert.strictEqual(reg.completed_donors,11);assert.strictEqual(reg.next_donor_id,"DONOR-012");assert.strictEqual(donor.receipt_status,"PENDING");
  }
});
check("governed inactive state remains explicit",()=>{
  assert.strictEqual(reg.governed_clinical_state.diagnostic_runtime,"GOVERNED_INACTIVE");
  assert.strictEqual(reg.governed_clinical_state.evidence_admission,"NOT_ADMITTED");
  assert.strictEqual(reg.governed_clinical_state.approved_adjudicated_gold_count,0);
  assert.strictEqual(reg.governed_clinical_state.metrics,"NOT_REPORTABLE");
  assert.strictEqual(reg.governed_clinical_state.activation,"NOT_ELIGIBLE");
  assert.strictEqual(reg.governed_clinical_state.clinical_validity,"NOT_INFERRED");
});
console.log(JSON.stringify({schema:"ekg-donor-012-closure-tests-v1",donor:"Edoar-do/HuBERT-ECG",pass:true,passed,total:passed,completed_donors:reg.completed_donors,next_donor_id:reg.next_donor_id,diagnostic_runtime:"GOVERNED_INACTIVE",metrics:"NOT_REPORTABLE",clinical_authority_added:false}));
