from __future__ import annotations
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]; TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_evidence_intake_quarantine.py"
p=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if p.stdout:print(p.stdout,end="")
if p.stderr:print(p.stderr,end="",file=sys.stderr)
if p.returncode:raise SystemExit(p.returncode)
lines=[x.strip() for x in p.stdout.splitlines() if x.strip()]
if not lines:raise SystemExit("EP5_PKT08_TEST_NO_OUTPUT")
r=json.loads(lines[-1]); required={"schema":"ekg-ep5-pkt08-evidence-intake-tests-v1","packet_id":"PKT-EP5-08","pass":True,"baseline_commit":"738b683d0526588eb7993985d013d5964c201601","baseline_tree":"f8f55ad3448b39035f5f38e6be3ecc961790f038","live_candidate_state":"NONE","capability_fixture_state":"ELIGIBLE_FOR_GOVERNED_ADMISSION_REVIEW","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"no_phi":True,"raw_clinical_payloads_included":False}
for k,v in required.items():
 if r.get(k)!=v:raise SystemExit("EP5_PKT08_GATE_MISMATCH:"+k)
if not isinstance(r.get("passed"),int) or r["passed"]<360 or r["passed"]!=r.get("total"):raise SystemExit("EP5_PKT08_GATE_ASSERTIONS")
for k in ["current_status_sha256","eligible_intake_sha256","intake_receipt_sha256","descriptor_sha256"]:
 if not isinstance(r.get(k),str) or len(r[k])!=64:raise SystemExit("EP5_PKT08_GATE_HASH:"+k)
print(json.dumps({"schema":"ekg-ep5-pkt08-evidence-intake-gate-v1","packet_id":"PKT-EP5-08","pass":True,"focused_assertions":r["passed"],"live_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False,"phi_included":False},sort_keys=True))
