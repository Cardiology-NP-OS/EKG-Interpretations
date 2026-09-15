from __future__ import annotations
import hashlib
import json
from typing import Any, Dict, Iterable, Mapping

SCHEMA="ekg-ep5-pkt01-stage3-baseline-v1"
PACKET_ID="PKT-EP5-01"
PACKET_SHA256="6df3479b50eb504c89aa3380466da39a3b0e58a2ec262a9d78c411f93e78ceb4"
BASELINE_COMMIT="509fdf0aab1c3768584c3159bb03a31202a8a103"
BASELINE_TREE="ea417c8114a6db694234ddc6aea5f3960ea88283"
STAGE2_RECEIPT_SHA256="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
STAGE2_BUILD_COMMIT="582956c5829719825e6a271748a06731981cfe70"
STAGE2_BUILD_TREE="cb61449f6e5df11ef5240282437852c854362028"
STAGE2_OUTPUT_SHA256="7d78ee995d87c11afcf5438ecb242f31e0632721a042c52b1375161ad141c6ff"
EP3_FINAL_PACKET_RECEIPT_SHA256="8370d5838e2a23ae82d08a8ec39e5899718f0adc63d81ffaec5e0e9e9a19d5cf"
EP3_FINAL_VERIFICATION_RECEIPT_SHA256="9e73b508e03f3f9cf9c0d81e9765281a27beb1fbd98bf945693049de1e36d6f6"

EP3_PACKET_RECEIPTS={
 "PKT-EP3-01":"96b1b26c3e069c7aad226894a81461e56dce322d16f32431884ef10e7118975f",
 "PKT-EP3-02":"f0f8cd6b330ce56dc02267fd23cc85175d4d02037fb4f2f0b974508d078996eb",
 "PKT-EP3-03":"f11c2b232b6f76d3be62b95ac44eb379becd41244bb8e67f8e0dfe18881232e1",
 "PKT-EP3-04":"3030f7e0d9dacafcaf81d767df97969f4255fb4397b4963521ad14197baa5e66",
 "PKT-EP3-05":"46a40cdb1095a6f401c3611abc4628986f44d682130db2c7f0449610f7b80895",
 "PKT-EP3-06":"d9a29faf5ad7407a30ba2accaffacbfc81cf8054604698ec3c255242615b3e45",
 "PKT-EP3-07":"7e92a1cc42ec16162626eb45fec8f3a5c38175ec9707b365933421213ca80f86",
 "PKT-EP3-08":"f151e49837cf84fea9e4b6bdeb4e01ebe3ae9708547adb6ae1106bc64b1aa293",
 "PKT-EP3-09":EP3_FINAL_PACKET_RECEIPT_SHA256,
}
EP3_VERIFICATION_RECEIPTS={
 "PKT-EP3-01":"acfd6bd29b4f41c504590255fa88440e47dd320e0ab0cb2a7fb454226ae93883",
 "PKT-EP3-02":"563fcd6329f9326eb06397f8bb87598d55ed7688bf93153a0f4c65b032200ca1",
 "PKT-EP3-03":"68fbfdffbe1065c85771378bb66366cbc0137bdf0a2bf2cd3ff3ce4fd5326a4f",
 "PKT-EP3-04":"fc232315dc6ec78b5e14105a8c3bef2f5fc8a432558960f990bae64aa926c42e",
 "PKT-EP3-05":"f95d1e71d9b1ae387c5d4bf672824adabf4976d708ad6e5ec1ad76a05d132470",
 "PKT-EP3-06":"1cc22893a38c4ec620b6ababe6780dc565e97d99542dd163648709a20463d582",
 "PKT-EP3-07":"306a1caccbdda2e3e803d94141099609c6f79161a68bb2d8585f5883cc31f4d1",
 "PKT-EP3-08":"43bed5cb6ecda55f6fc65a3fab2072843fbe9845358c6865c5f79e5fff7d3000",
 "PKT-EP3-09":EP3_FINAL_VERIFICATION_RECEIPT_SHA256,
}
PLATFORM_ACCEPTED_EKG_PIN={
 "repository":"Cardiology-NP-OS/EKG-Interpretations",
 "commit":"6fbf1814258813bfb6ff78407e013cf23ff9e07d",
 "tree":"01442274b34bf40ae600ee1ee21de8f15ae3b4de",
 "runtime_status":"GOVERNED_INACTIVE",
}
PLATFORM_STAGE2={
 "repository":"Cardiology-NP-OS/Cardiology-NP-Platform",
 "commit":"f07c5f425920f229faa956885ec7231c82a83972",
 "tree":"da4f4cf277bd8eecc0a2327a5362518df9590598",
 "release_state":"RELEASE_ELIGIBLE",
 "release_manifest_sha256":"9645bf9f54a21871c646ecc6ac0ef7605a51b8bfa6bb67d7a292a94badd71eea",
}
CURRENT_STATE={
 "approved_adjudicated_gold_count":0,
 "clinical_gold_admission_performed":False,
 "metric_maturity":"NOT_REPORTABLE",
 "diagnostic_performance_reporting_allowed":False,
 "clinical_accuracy_claimed":False,
 "candidate_active":False,
 "diagnostic_runtime":"GOVERNED_INACTIVE",
 "readiness_state":"BLOCKED",
 "activation_eligibility_state":"INELIGIBLE",
 "integration_freeze_state":"BLOCKED",
 "integration_descriptor_status":"PROVISIONAL_READ_ONLY",
}
FAIL_CLOSED_TRIGGERS=(
 "stage2_receipt_mismatch","packet_receipt_mismatch","verification_receipt_mismatch",
 "baseline_identity_drift","git_object_mismatch","provenance_mismatch","source_substitution",
 "candidate_identity_drift","configuration_identity_drift","stale_evidence","revoked_evidence",
 "unknown_or_untrusted_calibration","platform_silent_repin_attempt","manifest_tamper",
 "raw_clinical_payload_or_phi","clinical_authority_escalation","runtime_activation_attempt",
 "fabricated_clinical_gold","diagnostic_performance_claim",
)

def _canonical(value: Any)->bytes:
 return json.dumps(value,sort_keys=True,separators=(",",":")).encode("utf-8")

def digest(value: Any)->str:
 return hashlib.sha256(_canonical(value)).hexdigest()

def _hex(value: str,length: int,code: str)->str:
 if not isinstance(value,str) or len(value)!=length:
  raise ValueError(code)
 try:
  int(value,16)
 except ValueError as exc:
  raise ValueError(code) from exc
 return value.lower()

def stage2_lineage_consistency(*,packet_receipts: Mapping[str,str]=EP3_PACKET_RECEIPTS,verification_receipts: Mapping[str,str]=EP3_VERIFICATION_RECEIPTS,current_state: Mapping[str,Any]=CURRENT_STATE,stage2_receipt_sha256: str=STAGE2_RECEIPT_SHA256)->Dict[str,Any]:
 blockers=[]
 if stage2_receipt_sha256!=STAGE2_RECEIPT_SHA256:
  blockers.append("STAGE2_RECEIPT_MISMATCH")
 for pid,expected in EP3_PACKET_RECEIPTS.items():
  if packet_receipts.get(pid)!=expected:
   blockers.append("PACKET_RECEIPT_MISMATCH:"+pid)
 for pid,expected in EP3_VERIFICATION_RECEIPTS.items():
  if verification_receipts.get(pid)!=expected:
   blockers.append("VERIFICATION_RECEIPT_MISMATCH:"+pid)
 for key,expected in CURRENT_STATE.items():
  if current_state.get(key)!=expected:
   blockers.append("STATE_CONFLICT:"+key)
 return {
  "schema":"ekg-ep5-pkt01-stage2-lineage-consistency-v1",
  "consistent":not blockers,"blockers":sorted(blockers),
  "packet_receipts_checked":len(EP3_PACKET_RECEIPTS),
  "verification_receipts_checked":len(EP3_VERIFICATION_RECEIPTS),
  "state_fields_checked":len(CURRENT_STATE),"stage2_receipt_checked":True,
 }

def checkout_portability(git_blob_bytes: bytes,checkout_bytes: bytes)->Dict[str,Any]:
 blob_sha=hashlib.sha256(git_blob_bytes).hexdigest()
 checkout_sha=hashlib.sha256(checkout_bytes).hexdigest()
 normalized=checkout_bytes.replace(b"\r\n",b"\n")
 normalized_sha=hashlib.sha256(normalized).hexdigest()
 translation_only=checkout_sha!=blob_sha and normalized_sha==blob_sha
 return {
  "schema":"ekg-ep5-pkt01-git-object-portability-v1",
  "git_blob_sha256":blob_sha,"checkout_sha256":checkout_sha,
  "normalized_checkout_sha256":normalized_sha,
  "exact_worktree_bytes_match":checkout_sha==blob_sha,
  "newline_translation_only":translation_only,
  "repository_content_match":checkout_sha==blob_sha or translation_only,
  "authority_basis":"GIT_OBJECT_BYTES",
 }
def reproducibility_metadata(*,python_version: str,node_version: str,os_family: str)->Dict[str,Any]:
 for name,value in (("python_version",python_version),("node_version",node_version),("os_family",os_family)):
  if not isinstance(value,str) or not value.strip() or len(value)>120:
   raise ValueError("INVALID_"+name.upper())
 body={
  "schema":"ekg-ep5-pkt01-reproducibility-metadata-v1",
  "repository":"Cardiology-NP-OS/EKG-Interpretations",
  "baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,
  "python_version":python_version.strip(),"node_version":node_version.strip(),"os_family":os_family.strip(),
  "test_entry_points":["npm test","npm run gate:ci","clinical_control/v12_1_candidate/tests/run_candidate_gate.py",
                       "tools/ep3_pkt09_integration_freeze_gate.py","tools/ep5_pkt01_stage3_baseline_gate.py"],
  "stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,
  "ep3_final_packet_receipt_sha256":EP3_FINAL_PACKET_RECEIPT_SHA256,
  "raw_clinical_payloads_required":False,"credentials_embedded":False,"phi_embedded":False,
 }
 return {**body,"metadata_sha256":digest(body)}

def donor_gap_continuity()->Dict[str,Any]:
 return {
  "schema":"ekg-ep5-pkt01-donor-gap-continuity-v1",
  "records":[
   {"gap_id":"calibrated-measurement-geometry","disposition":"DEFERRED_WITH_REASON","bulk_donor_import_allowed":False,"untrusted_scale_exact_measurement_allowed":False},
   {"gap_id":"unified-reader-packet-builder","disposition":"DEFERRED_WITH_REASON","bulk_donor_import_allowed":False,"competing_diagnostic_engine_allowed":False},
  ],
  "all_deferred":True,"bulk_donor_import_allowed":False,
 }
def build_stage3_baseline_manifest(*,implementation_commit: str,implementation_tree: str,ci_receipt_sha256: str,independent_verification_receipt_sha256: str,reproducibility: Mapping[str,Any],boundary_records: Iterable[Mapping[str,Any]],packet_receipts: Mapping[str,str]=EP3_PACKET_RECEIPTS,verification_receipts: Mapping[str,str]=EP3_VERIFICATION_RECEIPTS)->Dict[str,Any]:
 implementation_commit=_hex(implementation_commit,40,"IMPLEMENTATION_COMMIT_INVALID")
 implementation_tree=_hex(implementation_tree,40,"IMPLEMENTATION_TREE_INVALID")
 ci_receipt_sha256=_hex(ci_receipt_sha256,64,"CI_RECEIPT_INVALID")
 independent_verification_receipt_sha256=_hex(independent_verification_receipt_sha256,64,"INDEPENDENT_VERIFICATION_RECEIPT_INVALID")
 lineage=stage2_lineage_consistency(packet_receipts=packet_receipts,verification_receipts=verification_receipts,current_state=CURRENT_STATE)
 boundaries=[dict(x) for x in boundary_records]
 missing=sorted(x.get("boundary","UNKNOWN") for x in boundaries if x.get("present") is not True)
 donor=donor_gap_continuity()
 pin_drift=(PLATFORM_ACCEPTED_EKG_PIN["commit"]!=BASELINE_COMMIT or PLATFORM_ACCEPTED_EKG_PIN["tree"]!=BASELINE_TREE)
 body={
  "schema":SCHEMA,"packet_id":PACKET_ID,"packet_sha256":PACKET_SHA256,
  "baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,
  "implementation_commit":implementation_commit,"implementation_tree":implementation_tree,
  "stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,"stage2_build_commit":STAGE2_BUILD_COMMIT,
  "stage2_build_tree":STAGE2_BUILD_TREE,"stage2_output_sha256":STAGE2_OUTPUT_SHA256,
  "ep3_final_packet_receipt_sha256":EP3_FINAL_PACKET_RECEIPT_SHA256,
  "ep3_final_verification_receipt_sha256":EP3_FINAL_VERIFICATION_RECEIPT_SHA256,
  "ep3_packet_receipts":dict(packet_receipts),"ep3_verification_receipts":dict(verification_receipts),
  "stage2_lineage_consistency":lineage,"current_state":dict(CURRENT_STATE),
  "reproducibility":dict(reproducibility),"recovered_v12_boundaries":boundaries,
  "missing_recovered_v12_boundaries":missing,"donor_gap_continuity":donor,
  "platform_stage2":dict(PLATFORM_STAGE2),"platform_accepted_ekg_pin":dict(PLATFORM_ACCEPTED_EKG_PIN),
  "platform_ekg_pin_drift":pin_drift,"platform_ekg_pin_state":"STALE_PIN" if pin_drift else "PIN_CURRENT",
  "platform_silent_repin_allowed":False,"platform_automatic_repin_performed":False,
  "ci_receipt_sha256":ci_receipt_sha256,
  "independent_verification_receipt_sha256":independent_verification_receipt_sha256,
  "approved_adjudicated_gold_count":0,"clinical_gold_admission_performed":False,
  "metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE",
  "clinical_authority_transferred":False,"runtime_activation_performed":False,
  "automatic_candidate_selection_performed":False,"raw_clinical_waveform_or_image_bytes_included":False,
  "phi_included":False,"synthetic_fixtures_are_clinical_gold":False,"bulk_donor_import_performed":False,
  "source_substitution_allowed":False,"silent_fallback_allowed":False,
 }
 body["engineering_baseline_conformant"]=bool(lineage["consistent"] and not missing and donor["all_deferred"])
 body["manifest_sha256"]=digest(body)
 body["immutable"]=True
 return body

def validate_stage3_baseline_manifest(manifest: Mapping[str,Any])->Dict[str,Any]:
 blockers=[]
 if manifest.get("schema")!=SCHEMA or manifest.get("packet_id")!=PACKET_ID or manifest.get("packet_sha256")!=PACKET_SHA256:
  blockers.append("PACKET_IDENTITY_MISMATCH")
 if manifest.get("baseline_commit")!=BASELINE_COMMIT or manifest.get("baseline_tree")!=BASELINE_TREE:
  blockers.append("BASELINE_IDENTITY_MISMATCH")
 lineage=stage2_lineage_consistency(packet_receipts=manifest.get("ep3_packet_receipts",{}),
  verification_receipts=manifest.get("ep3_verification_receipts",{}),current_state=manifest.get("current_state",{}),
  stage2_receipt_sha256=manifest.get("stage2_receipt_sha256",""))
 blockers.extend(lineage["blockers"])
 if manifest.get("missing_recovered_v12_boundaries"):
  blockers.append("RECOVERED_V12_BOUNDARY_MISSING")
 if manifest.get("platform_ekg_pin_state") not in {"STALE_PIN","PIN_CURRENT"}:
  blockers.append("PLATFORM_PIN_STATE_INVALID")
 if manifest.get("platform_ekg_pin_drift") is True and manifest.get("platform_ekg_pin_state")!="STALE_PIN":
  blockers.append("PLATFORM_PIN_DRIFT_NOT_EXPLICIT")
 for field in ("platform_silent_repin_allowed","platform_automatic_repin_performed","diagnostic_performance_reporting_allowed",
  "clinical_accuracy_claimed","candidate_active","clinical_authority_transferred","runtime_activation_performed",
  "automatic_candidate_selection_performed","raw_clinical_waveform_or_image_bytes_included","phi_included",
  "synthetic_fixtures_are_clinical_gold","bulk_donor_import_performed","source_substitution_allowed","silent_fallback_allowed"):
  if manifest.get(field) is not False:
   blockers.append("FORBIDDEN_ESCALATION:"+field)
 if manifest.get("diagnostic_runtime")!="GOVERNED_INACTIVE":
  blockers.append("DIAGNOSTIC_RUNTIME_NOT_INACTIVE")
 if manifest.get("approved_adjudicated_gold_count")!=0 or manifest.get("clinical_gold_admission_performed") is not False:
  blockers.append("CLINICAL_GOLD_STATE_INVALID")
 if manifest.get("metric_maturity")!="NOT_REPORTABLE":
  blockers.append("METRIC_MATURITY_INVALID")
 supplied=manifest.get("manifest_sha256")
 unsigned={k:v for k,v in manifest.items() if k not in {"manifest_sha256","immutable"}}
 if supplied!=digest(unsigned):
  blockers.append("MANIFEST_SHA256_MISMATCH")
 if manifest.get("immutable") is not True:
  blockers.append("MANIFEST_NOT_IMMUTABLE")
 return {"schema":"ekg-ep5-pkt01-stage3-baseline-validation-v1","valid":not blockers,
  "blockers":sorted(set(blockers)),"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,
  "clinical_accuracy_claimed":False,"platform_ekg_pin_state":"STALE_PIN"}

def restart_checkpoint(*,manifest_sha256: str,last_accepted_receipt_sha256: str=STAGE2_RECEIPT_SHA256)->Dict[str,Any]:
 manifest_sha256=_hex(manifest_sha256,64,"MANIFEST_SHA256_INVALID")
 last_accepted_receipt_sha256=_hex(last_accepted_receipt_sha256,64,"RECEIPT_SHA256_INVALID")
 body={"schema":"ekg-ep5-pkt01-restart-checkpoint-v1","manifest_sha256":manifest_sha256,
  "last_accepted_receipt_sha256":last_accepted_receipt_sha256,"resume_from_exact_git_identity":True,
  "replay_accepted_stage2_packets":False,"automatic_previous_version_fallback_allowed":False,
  "source_substitution_allowed":False,"candidate_substitution_allowed":False,"authority_rewrite_allowed":False,
  "diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False}
 return {**body,"checkpoint_sha256":digest(body)}

def platform_status_descriptor(manifest: Mapping[str,Any])->Dict[str,Any]:
 validation=validate_stage3_baseline_manifest(manifest)
 status="STALE_PIN" if validation["valid"] and manifest.get("platform_ekg_pin_drift") else ("GOVERNED_INACTIVE" if validation["valid"] else "BLOCKED")
 body={"schema":"ekg-ep5-pkt01-platform-stage3-status-v1","status":status,"read_only":True,
  "manifest_sha256":manifest.get("manifest_sha256"),"stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,
  "exact_commit":manifest.get("implementation_commit"),"exact_tree":manifest.get("implementation_tree"),
  "accepted_platform_ekg_pin":dict(PLATFORM_ACCEPTED_EKG_PIN),
  "current_ekg_baseline":{"commit":BASELINE_COMMIT,"tree":BASELINE_TREE},
  "silent_repin_allowed":False,"automatic_repin_performed":False,
  "diagnostic_runtime":"GOVERNED_INACTIVE","approved_adjudicated_gold_count":0,
  "metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"clinical_authority_transferred":False,
  "diagnostic_conclusions_included":False,"patient_specific_cds_included":False,
  "treatment_or_prescribing_advice_included":False,"raw_clinical_payloads_included":False,"phi_included":False,
  "blockers":list(validation["blockers"])}
 return {**body,"descriptor_sha256":digest(body)}

def invalidation_record(*,manifest_sha256: str,trigger: str,reason: str)->Dict[str,Any]:
 manifest_sha256=_hex(manifest_sha256,64,"MANIFEST_SHA256_INVALID")
 if trigger not in FAIL_CLOSED_TRIGGERS:
  raise ValueError("INVALIDATION_TRIGGER_UNSUPPORTED")
 if not isinstance(reason,str) or not reason.strip() or len(reason)>280:
  raise ValueError("INVALIDATION_REASON_REQUIRED")
 body={"schema":"ekg-ep5-pkt01-invalidation-v1","manifest_sha256":manifest_sha256,
  "trigger":trigger,"reason":reason.strip(),"new_status":"BLOCKED","diagnostic_runtime":"GOVERNED_INACTIVE",
  "candidate_active":False,"platform_repin_allowed":False,"silent_fallback_allowed":False,
  "source_substitution_allowed":False,"candidate_substitution_allowed":False,"authority_rewrite_allowed":False,
  "last_accepted_lineage_preserved":True}
 return {**body,"record_sha256":digest(body)}
