from __future__ import annotations
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_reconciliation_acknowledgement.py"
p=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if p.stdout: print(p.stdout,end="")
if p.stderr: print(p.stderr,end="",file=sys.stderr)
if p.returncode: raise SystemExit(p.returncode)
lines=[x.strip() for x in p.stdout.splitlines() if x.strip()]
if not lines: raise SystemExit("EP5_PKT05_TEST_NO_OUTPUT")
r=json.loads(lines[-1])
required={"schema":"ekg-ep5-pkt05-reconciliation-acknowledgement-tests-v1","packet_id":"PKT-EP5-05","pass":True,"baseline_commit":"732eb96b0ee4c3890fe56f0bbd9021af3922d814","baseline_tree":"105d565019beccae6f134946caa4d9869ee350a2","acknowledgement_state":"ACKNOWLEDGED","activation_eligibility":"NOT_ELIGIBLE","platform_metadata_freshness":"FRESH","historical_stage2_pin_commit":"6fbf1814258813bfb6ff78407e013cf23ff9e07d","active_stage3_pin_commit":"09ec7010191ecca0336abb9fccf369ce182c89e1","single_use_consumption_confirmed":True,"reconciliation_replay_blocked":True,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False}
for k,v in required.items():
 if r.get(k)!=v: raise SystemExit("EP5_PKT05_GATE_MISMATCH:"+k)
if not isinstance(r.get("passed"),int) or r["passed"]<250: raise SystemExit("EP5_PKT05_GATE_ASSERTION_FLOOR")
if r["passed"]!=r.get("total"): raise SystemExit("EP5_PKT05_GATE_ASSERTION_COUNT_MISMATCH")
for k in ["acknowledgement_sha256","activation_eligibility_sha256","release_descriptor_sha256"]:
 if not isinstance(r.get(k),str) or len(r[k])!=64: raise SystemExit("EP5_PKT05_GATE_HASH:"+k)
print(json.dumps({"schema":"ekg-ep5-pkt05-reconciliation-acknowledgement-gate-v1","packet_id":"PKT-EP5-05","pass":True,"focused_assertions":r["passed"],"acknowledgement_sha256":r["acknowledgement_sha256"],"activation_eligibility_sha256":r["activation_eligibility_sha256"],"release_descriptor_sha256":r["release_descriptor_sha256"],"platform_metadata_freshness":"FRESH","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False},sort_keys=True))
