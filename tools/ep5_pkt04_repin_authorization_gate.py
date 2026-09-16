from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_repin_authorization.py"
proc=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if proc.stdout: print(proc.stdout,end="")
if proc.stderr: print(proc.stderr,end="",file=sys.stderr)
if proc.returncode: raise SystemExit(proc.returncode)
lines=[x.strip() for x in proc.stdout.splitlines() if x.strip()]
if not lines: raise SystemExit("EP5_PKT04_TEST_NO_OUTPUT")
result=json.loads(lines[-1])
required={
 "schema":"ekg-ep5-pkt04-repin-authorization-tests-v1","packet_id":"PKT-EP5-04","pass":True,
 "baseline_commit":"09ec7010191ecca0336abb9fccf369ce182c89e1","baseline_tree":"6f5f1c261816f8cf33001802fdfb4237b80f387b",
 "authorization_state":"ELIGIBLE","historical_stage2_pin_commit":"6fbf1814258813bfb6ff78407e013cf23ff9e07d",
 "authorized_stage3_destination_commit":"09ec7010191ecca0336abb9fccf369ce182c89e1",
 "target_platform_commit":"cb9dfa805eaf5cc396f8d957525d5d1f7784280c","single_use":True,"replay_allowed":False,
 "platform_mutation_performed":False,"runtime_activation_performed":False,"candidate_active":False,
 "diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED",
 "diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_authority_transfer":False,
 "phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,
 "approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE"
}
for key,expected in required.items():
 if result.get(key)!=expected: raise SystemExit("EP5_PKT04_GATE_MISMATCH:"+key)
if not isinstance(result.get("passed"),int) or result["passed"]<250: raise SystemExit("EP5_PKT04_GATE_ASSERTION_FLOOR")
if result["passed"]!=result.get("total"): raise SystemExit("EP5_PKT04_GATE_ASSERTION_COUNT_MISMATCH")
for key in ["authorization_sha256","authorization_challenge_sha256"]:
 if not isinstance(result.get(key),str) or len(result[key])!=64: raise SystemExit("EP5_PKT04_GATE_HASH:"+key)
print(json.dumps({"schema":"ekg-ep5-pkt04-repin-authorization-gate-v1","packet_id":"PKT-EP5-04","pass":True,"focused_assertions":result["passed"],"authorization_state":"ELIGIBLE","authorization_sha256":result["authorization_sha256"],"authorization_challenge_sha256":result["authorization_challenge_sha256"],"single_use":True,"replay_allowed":False,"platform_mutation_performed":False,"runtime_activation_performed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False},sort_keys=True))
