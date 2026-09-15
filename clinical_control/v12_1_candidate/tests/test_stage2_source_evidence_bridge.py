from __future__ import annotations
import copy, json, pathlib, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
GEN=ROOT/"validation_generated"
sys.path.insert(0,str(GEN))
import source_evidence_bridge as bridge
import system_status_adapter as status

passed=0
def check(name,value):
    global passed
    assert value,name
    passed+=1
    print("PASS",name)

def expect(name,code,fn):
    global passed
    try: fn()
    except (ValueError,RuntimeError) as exc:
        assert code in str(exc),(name,exc)
    else: raise AssertionError(name)
    passed+=1
    print("PASS",name)

def sref(ref_id,kind,char):
    return status.evidence_ref(ref_id,kind,char*64)

def status_snapshot():
    substrate=status.current_substrate_state()
    snap={
      "repository_binding":copy.deepcopy(status.accepted_authority()),
      "source":{"source_id":"synthetic-source","source_sha256":"a"*64,"state":"AVAILABLE","raw_source_available":True,"raw_source_in_git":False,"source_verified":True,"evidence_refs":[sref("source","SOURCE_VERIFICATION","1")]},
      "inspection":{"state":"AVAILABLE","verified":True,"limitations":[],"evidence_refs":[sref("inspection","SOURCE_INSPECTION","2")]},
      "waveform_qc":{"state":"AVAILABLE","verified":True,"limitations":[],"evidence_refs":[sref("qc","WAVEFORM_QC","3")]},
      "candidate_control":{**{k:substrate[k] for k in ("candidate_active","clinical_accuracy_claimed","automatic_selection_allowed","runtime_status","native_dataset_annotations_are_project_gold","synthetic_fixtures_are_clinical_gold")},"evidence_refs":[sref("candidate","CANDIDATE_CONTROL","4")]},
      "evaluation":{**{k:substrate[k] for k in ("approved_adjudicated_gold_count","diagnostic_performance_reporting_allowed","clinical_accuracy_promotion_allowed")},"evidence_refs":[sref("evaluation","EVALUATION","5")]}
    }
    return status.build_status(snap)

def bref(ref_id="lineage",state="AVAILABLE",char="6",authority="Cardiology-NP-Evidence"):
    return bridge.bridge_ref(ref_id,"SOURCE_LINEAGE",char*64,authority,state=state,limitations=[])

binding=bridge.accepted_packet1_binding()
check("baseline_commit",binding["baseline_commit"]=="b73d62847746986a18671cd2da1608540f46aa7b")
check("baseline_tree",binding["baseline_tree"]=="aa309eedf0437bc8d5b3870a22f4825ee22aaba3")
check("packet1_receipt",binding["packet1_receipt_sha256"]=="96b1b26c3e069c7aad226894a81461e56dce322d16f32431884ef10e7118975f")
base=status_snapshot()
out=bridge.build_bridge(status_snapshot=base,evidence_refs=[bref()])
check("complete_state",out["state"]=="COMPLETE")
check("bundle_hash",len(out["bundle_sha256"])==64)
check("deterministic",out==bridge.build_bridge(status_snapshot=copy.deepcopy(base),evidence_refs=[bref()]))
check("authority_preserved",any(x["origin"]=="Cardiology-NP-Evidence" for x in out["evidence_refs"]))
check("packet1_refs_preserved",sum(x["origin"]=="EP3_PKT01_STATUS_ADAPTER" for x in out["evidence_refs"])==5)
check("no_authority_rewrite",out["authority_rewritten"] is False)
check("candidate_inactive",out["candidate_active"] is False)
check("zero_gold",out["approved_adjudicated_gold_count"]==0)
check("diagnostic_inactive",out["diagnostic_runtime_activation_allowed"] is False)
for state,expected in [("DEGRADED","DEGRADED"),("UNAVAILABLE","UNAVAILABLE"),("UNKNOWN","UNKNOWN")]:
    case=bridge.build_bridge(status_snapshot=status_snapshot(),evidence_refs=[bref(state=state)])
    check("state_"+state.lower(),case["state"]==expected)

degraded=status_snapshot(); degraded["state"]="DEGRADED"
check("status_degraded_propagates",bridge.build_bridge(status_snapshot=degraded,evidence_refs=[bref()])["state"]=="DEGRADED")
unavailable=status_snapshot(); unavailable["state"]="UNAVAILABLE"
check("status_unavailable_propagates",bridge.build_bridge(status_snapshot=unavailable,evidence_refs=[bref()])["state"]=="UNAVAILABLE")

conflict=[bref("same","AVAILABLE","7","Authority-A"),bref("same","AVAILABLE","8","Authority-B")]
expect("conflicting_ref_id","EVIDENCE_REF_CONFLICT",lambda:bridge.build_bridge(status_snapshot=status_snapshot(),evidence_refs=conflict))
expect("bad_hash","EVIDENCE_REF_SHA256",lambda:bridge.bridge_ref("x","SOURCE_LINEAGE","short","a"))
expect("bad_kind","EVIDENCE_REF_KIND",lambda:bridge.bridge_ref("x","DIAGNOSIS","1"*64,"a"))
expect("bad_state","EVIDENCE_REF_STATE",lambda:bridge.bridge_ref("x","SOURCE_LINEAGE","1"*64,"a",state="READY"))
expect("missing_authority","SOURCE_AUTHORITY_REQUIRED",lambda:bridge.bridge_ref("x","SOURCE_LINEAGE","1"*64,""))

phi=bridge.bridge_ref("phi","SOURCE_LINEAGE","1"*64,"a")
phi["patient_name"]="synthetic"
expect("phi_rejected","DIRECT_IDENTIFIER_FORBIDDEN",lambda:bridge.build_bridge(status_snapshot=status_snapshot(),evidence_refs=[phi]))
secret=bridge.bridge_ref("secret","SOURCE_LINEAGE","1"*64,"a")
secret["api_key"]="synthetic"
expect("secret_rejected","SECRET_MATERIAL_FORBIDDEN",lambda:bridge.build_bridge(status_snapshot=status_snapshot(),evidence_refs=[secret]))
raw=bridge.bridge_ref("raw","SOURCE_LINEAGE","1"*64,"a")
raw["waveform_bytes"]="synthetic"
expect("raw_payload_rejected","RAW_CLINICAL_PAYLOAD_FORBIDDEN",lambda:bridge.build_bridge(status_snapshot=status_snapshot(),evidence_refs=[raw]))

active=status_snapshot(); active["candidate_control"]["candidate_active"]=True
expect("candidate_activation_rejected","CANDIDATE_ACTIVE_FORBIDDEN",lambda:bridge.build_bridge(status_snapshot=active,evidence_refs=[bref()]))
gold=status_snapshot(); gold["evaluation"]["approved_adjudicated_gold_count"]=1
expect("gold_promotion_rejected","UNAPPROVED_GOLD_COUNT",lambda:bridge.build_bridge(status_snapshot=gold,evidence_refs=[bref()]))
reporting=status_snapshot(); reporting["evaluation"]["diagnostic_performance_reporting_allowed"]=True
expect("reporting_rejected","DIAGNOSTIC_REPORTING_FORBIDDEN",lambda:bridge.build_bridge(status_snapshot=reporting,evidence_refs=[bref()]))

lineage=bridge.lineage_descriptor(out)
check("lineage_read_only",lineage["read_only"] is True and lineage["diagnostic_interpretation"] is False)
check("lineage_exact_bundle",lineage["bundle_sha256"]==out["bundle_sha256"])
receipt=bridge.append_receipt(bridge=out)
check("receipt_append_only",receipt["append_only"] is True)
check("receipt_deterministic",receipt==bridge.append_receipt(bridge=copy.deepcopy(out)))
chained=bridge.append_receipt(bridge=out,previous_receipt_sha256=receipt["receipt_sha256"])
check("receipt_chain",chained["previous_receipt_sha256"]==receipt["receipt_sha256"])
expect("bad_previous_receipt","PREVIOUS_RECEIPT_SHA256",lambda:bridge.append_receipt(bridge=out,previous_receipt_sha256="short"))

fixture=json.loads((GEN/"EP3_PKT02_EVIDENCE_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_non_phi",fixture["phi"] is False)
check("fixture_no_raw",fixture["raw_clinical_source_bytes_included"] is False)
for scenario in fixture["scenarios"]:
    got=bridge.build_bridge(status_snapshot=status_snapshot(),evidence_refs=[bref(state=scenario["ref_state"])])
    check("fixture_"+scenario["id"],got["state"]==scenario["expected_state"])

release=bridge.release_contract()
check("release_packet",release["packet"]=="PKT-EP3-02")
check("release_no_diagnostic",release["diagnostic_execution_supported"] is False)
check("release_zero_gold",release["approved_adjudicated_gold_count"]==0)
check("release_no_raw",release["raw_source_bytes_stored_in_git"] is False)
check("release_proof_required",release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)
print(json.dumps({"schema":"ekg-ep3-pkt02-evidence-tests-v1","pass":True,"passed":passed,"total":passed,"candidate_active":False,"approved_adjudicated_gold_count":0,"clinical_accuracy_claimed":False},sort_keys=True))
