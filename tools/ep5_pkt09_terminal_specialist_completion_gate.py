from __future__ import annotations
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_terminal_specialist_completion.py";p=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True);print(p.stdout,end="");print(p.stderr,end="",file=sys.stderr)
if p.returncode:raise SystemExit(p.returncode)
r=json.loads([x for x in p.stdout.splitlines() if x.strip()][-1]);req={"schema":"ekg-ep5-pkt09-terminal-specialist-tests-v1","packet_id":"PKT-EP5-09","pass":True,"completion_state":"SPECIALIST_COMPLETE_INACTIVE","live_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"no_phi":True}
for k,v in req.items():
 if r.get(k)!=v:raise SystemExit("EP5_PKT09_GATE_MISMATCH:"+k)
if r.get("passed",0)<360 or r["passed"]!=r.get("total"):raise SystemExit("EP5_PKT09_GATE_ASSERTIONS")
for k in ["completion_manifest_sha256","lineage_sha256","handoff_sha256","recovery_sha256"]:
 if not isinstance(r.get(k),str) or len(r[k])!=64:raise SystemExit("EP5_PKT09_GATE_HASH:"+k)
print(json.dumps({"schema":"ekg-ep5-pkt09-terminal-specialist-gate-v1","packet_id":"PKT-EP5-09","pass":True,"focused_assertions":r["passed"],"completion_state":r["completion_state"],"approved_adjudicated_gold_count":0,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False},sort_keys=True))
