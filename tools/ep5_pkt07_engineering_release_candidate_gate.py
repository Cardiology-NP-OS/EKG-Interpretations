from __future__ import annotations
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]; TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_engineering_release_candidate.py"
p=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if p.stdout:print(p.stdout,end="")
if p.stderr:print(p.stderr,end="",file=sys.stderr)
if p.returncode:raise SystemExit(p.returncode)
lines=[x.strip() for x in p.stdout.splitlines() if x.strip()]
if not lines:raise SystemExit("EP5_PKT07_TEST_NO_OUTPUT")
r=json.loads(lines[-1]); required={"schema":"ekg-ep5-pkt07-release-candidate-tests-v1","packet_id":"PKT-EP5-07","pass":True,"baseline_commit":"5a111da7a116327b717f85fa153a71f1606564da","baseline_tree":"e14b3bdc25005b3c5e4624bb852bd6638200ac86","state":"ENGINEERING_READY_INACTIVE","engineering_release_ready":True,"integration_ready":True,"evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","activation_authorized":False,"runtime_activation_performed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False}
for k,v in required.items():
 if r.get(k)!=v:raise SystemExit("EP5_PKT07_GATE_MISMATCH:"+k)
if r.get("activation_blockers")!=["NO_ADMITTED_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY"]:raise SystemExit("EP5_PKT07_GATE_BLOCKERS")
if not isinstance(r.get("passed"),int) or r["passed"]<300 or r["passed"]!=r.get("total"):raise SystemExit("EP5_PKT07_GATE_ASSERTIONS")
for k in ["release_candidate_sha256","manifest_identity_sha256","recovery_sha256","descriptor_sha256"]:
 if not isinstance(r.get(k),str) or len(r[k])!=64:raise SystemExit("EP5_PKT07_GATE_HASH:"+k)
print(json.dumps({"schema":"ekg-ep5-pkt07-release-candidate-gate-v1","packet_id":"PKT-EP5-07","pass":True,"focused_assertions":r["passed"],"state":"ENGINEERING_READY_INACTIVE","activation_blockers":r["activation_blockers"],"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False,"phi_included":False},sort_keys=True))
