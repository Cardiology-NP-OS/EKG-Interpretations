from __future__ import annotations
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]; TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_evidence_admission_readiness.py"
p=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if p.stdout: print(p.stdout,end="")
if p.stderr: print(p.stderr,end="",file=sys.stderr)
if p.returncode: raise SystemExit(p.returncode)
lines=[x.strip() for x in p.stdout.splitlines() if x.strip()]
if not lines: raise SystemExit("EP5_PKT06_TEST_NO_OUTPUT")
r=json.loads(lines[-1])
required={"schema":"ekg-ep5-pkt06-evidence-admission-readiness-tests-v1","packet_id":"PKT-EP5-06","pass":True,"baseline_commit":"db71c98539d7894ea1a3d40d7aa2c9a7b0b24dd4","baseline_tree":"777f1bd10d59ccecb2e7f4894aea7ca88745b0d2","evidence_admission_state":"NOT_ADMITTED","review_state":"ELIGIBLE_FOR_GOVERNED_REVIEW","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"synthetic_fixtures_can_be_clinical_gold":False,"admission_effect_performed":False,"runtime_activation_performed":False}
for k,v in required.items():
 if r.get(k)!=v: raise SystemExit("EP5_PKT06_GATE_MISMATCH:"+k)
if not isinstance(r.get("passed"),int) or r["passed"]<250: raise SystemExit("EP5_PKT06_GATE_ASSERTION_FLOOR")
if r["passed"]!=r.get("total"): raise SystemExit("EP5_PKT06_GATE_ASSERTION_COUNT_MISMATCH")
for k in ["current_status_sha256","review_evaluation_sha256","activation_precondition_sha256","descriptor_sha256"]:
 if not isinstance(r.get(k),str) or len(r[k])!=64: raise SystemExit("EP5_PKT06_GATE_HASH:"+k)
print(json.dumps({"schema":"ekg-ep5-pkt06-evidence-admission-readiness-gate-v1","packet_id":"PKT-EP5-06","pass":True,"focused_assertions":r["passed"],"evidence_admission_state":"NOT_ADMITTED","review_state":"ELIGIBLE_FOR_GOVERNED_REVIEW","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"clinical_authority_transfer":False,"phi_included":False,"synthetic_fixtures_can_be_clinical_gold":False,"admission_effect_performed":False},sort_keys=True))
