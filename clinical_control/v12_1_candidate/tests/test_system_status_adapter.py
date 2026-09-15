from __future__ import annotations
import copy, json, pathlib, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
GEN=ROOT/"validation_generated"
sys.path.insert(0,str(GEN))
import system_status_adapter as m

FIXTURE=GEN/"EP3_PKT01_STATUS_FIXTURES.json"
passed=0
def check(name,value):
    global passed
    assert value,name
    passed+=1
    print("PASS",name)

def expect(name,exc_type,code,fn):
    global passed
    try: fn()
    except exc_type as exc:
        assert code in str(exc),(name,exc)
    else: raise AssertionError(name)
    passed+=1
    print("PASS",name)

def ref(ref_id,kind,char):
    return m.evidence_ref(ref_id,kind,char*64)
def snapshot():
    canonical=m.current_substrate_state()
    return {
      "repository_binding":m.accepted_authority(),
      "source":{
        "source_id":"synthetic-ecg-001","source_sha256":"a"*64,
        "state":"AVAILABLE","raw_source_available":True,
        "raw_source_in_git":False,"source_verified":True,
        "evidence_refs":[ref("src","SOURCE_VERIFICATION","1")]},
      "inspection":{
        "state":"AVAILABLE","verified":True,"limitations":[],
        "evidence_refs":[ref("inspect","SOURCE_INSPECTION","2")]},
      "waveform_qc":{
        "state":"AVAILABLE","verified":True,"limitations":[],
        "evidence_refs":[ref("qc","WAVEFORM_QC","3")]},
      "candidate_control":{
        **{k:canonical[k] for k in (
          "candidate_active","clinical_accuracy_claimed","automatic_selection_allowed",
          "runtime_status","native_dataset_annotations_are_project_gold",
          "synthetic_fixtures_are_clinical_gold")},
        "evidence_refs":[ref("candidate","CANDIDATE_CONTROL","4")]},
      "evaluation":{
        **{k:canonical[k] for k in (
          "approved_adjudicated_gold_count",
          "diagnostic_performance_reporting_allowed",
          "clinical_accuracy_promotion_allowed")},
        "evidence_refs":[ref("eval","EVALUATION","5")]}
    }

authority=m.accepted_authority()
check("authority_repository",authority["repository"]=="Cardiology-NP-OS/EKG-Interpretations")
check("authority_commit",authority["commit"]=="3d04986dcce2b20ed19a226e6596002878f8f031")
check("authority_tree",authority["tree"]=="245ebbe924befaf2a9ca510c59551554a2305baf")
check("authority_receipt",authority["stage1_acceptance_receipt_sha256"]=="76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")

substrate=m.current_substrate_state()
check("substrate_inactive",substrate["candidate_active"] is False)
check("substrate_zero_gold",substrate["approved_adjudicated_gold_count"]==0)
check("substrate_reporting_blocked",substrate["diagnostic_performance_reporting_allowed"] is False)
check("substrate_no_auto_selection",substrate["automatic_selection_allowed"] is False)

base=snapshot()
status=m.build_status(base)
check("available_governed_inactive",status["state"]=="GOVERNED_INACTIVE")
check("status_only_capability",status["capabilities"]["status.read"]=="SUPPORTED")
check("diagnostic_capability_unsupported",status["capabilities"]["diagnostic.execute"]=="UNSUPPORTED")
check("diagnostic_activation_false",status["diagnostic_runtime_activation_allowed"] is False)
check("status_no_accuracy_claim",status["clinical_accuracy_claimed"] is False)
check("status_hash_bound",len(status["status_sha256"])==64)
check("provenance_all_sections",len(status["provenance_refs"])==5)

stale=copy.deepcopy(base); stale["repository_binding"]["commit"]="0"*40
out=m.build_status(stale)
check("stale_commit_unknown",out["state"]=="UNKNOWN" and "STALE_COMMIT" in out["limitations"])

raw=copy.deepcopy(base); raw["source"]["raw_source_in_git"]=True
out=m.build_status(raw)
check("raw_source_in_git_fails_closed",out["state"]=="UNKNOWN" and "RAW_SOURCE_MUST_REMAIN_OUTSIDE_GIT" in out["limitations"])

unavailable=copy.deepcopy(base)
unavailable["source"]["state"]="UNAVAILABLE"; unavailable["source"]["raw_source_available"]=False
check("source_unavailable",m.build_status(unavailable)["state"]=="UNAVAILABLE")

unknown=copy.deepcopy(base); unknown["source"]["state"]="UNKNOWN"; unknown["source"]["source_verified"]=False
check("source_unknown",m.build_status(unknown)["state"]=="UNKNOWN")

degraded=copy.deepcopy(base); degraded["waveform_qc"]["state"]="DEGRADED"
degraded["waveform_qc"]["limitations"]=["synthetic engineering degradation"]
check("qc_degraded",m.build_status(degraded)["state"]=="DEGRADED")

mutated=copy.deepcopy(base); mutated["candidate_control"]["candidate_active"]=True
out=m.build_status(mutated)
check("candidate_activation_tamper_unknown",out["state"]=="UNKNOWN")
check("candidate_activation_not_propagated",out["candidate_control"]["candidate_active"] is False)
fakegold=copy.deepcopy(base); fakegold["evaluation"]["approved_adjudicated_gold_count"]=1
out=m.build_status(fakegold)
check("fake_gold_count_unknown",out["state"]=="UNKNOWN" and "GOLD_COUNT_STALE" in out["limitations"])
check("fake_gold_not_propagated",out["evaluation"]["approved_adjudicated_gold_count"]==0)

dup=copy.deepcopy(base); dup["inspection"]["evidence_refs"][0]["ref_id"]="src"
expect("cross_section_duplicate_ref",ValueError,"EVIDENCE_REF_DUPLICATE_ACROSS_SECTIONS",lambda:m.build_status(dup))

phi=copy.deepcopy(base); phi["source"]["patient_name"]="forbidden"
expect("phi_rejected",ValueError,"DIRECT_IDENTIFIER_FORBIDDEN",lambda:m.build_status(phi))
secret=copy.deepcopy(base); secret["source"]["api_key"]="forbidden"
expect("secret_rejected",ValueError,"SECRET_MATERIAL_FORBIDDEN",lambda:m.build_status(secret))
payload=copy.deepcopy(base); payload["source"]["waveform_bytes"]="forbidden"
expect("raw_payload_rejected",ValueError,"RAW_CLINICAL_PAYLOAD_FORBIDDEN",lambda:m.build_status(payload))
badhash=copy.deepcopy(base); badhash["source"]["source_sha256"]="short"
expect("bad_source_hash",ValueError,"SOURCE_SHA256",lambda:m.build_status(badhash))

expect("diagnostic_execute_blocked",RuntimeError,"DIAGNOSTIC_EXECUTION_UNSUPPORTED_GOVERNED_INACTIVE",lambda:m.diagnostic_execute())
release=m.release_contract()
check("release_packet",release["packet"]=="PKT-EP3-01")
check("release_receipt",release["stage1_acceptance_receipt_sha256"]=="76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("release_zero_gold",release["approved_adjudicated_gold_count"]==0)
check("release_diagnostic_unsupported",release["diagnostic_execution_supported"] is False)
check("release_requires_proof",release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)

fixture=json.loads(FIXTURE.read_text(encoding="utf-8"))
check("fixture_non_phi",fixture["phi"] is False)
check("fixture_no_raw_bytes",fixture["raw_clinical_source_bytes_included"] is False)
check("fixture_candidate_inactive",fixture["candidate_active"] is False)
check("fixture_scenarios",len(fixture["scenarios"])==5)

print(json.dumps({"schema":"ekg-ep3-pkt01-system-status-tests-v1","pass":True,
 "passed":passed,"total":passed,"candidate_active":False,
 "approved_adjudicated_gold_count":0,"diagnostic_execution_allowed":False,
 "clinical_accuracy_claimed":False},sort_keys=True))
