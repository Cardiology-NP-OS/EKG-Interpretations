from __future__ import annotations
import json,pathlib,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[1];TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_terminal_specialist_completion.py"
p=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if p.stdout: print(p.stdout,end="")
if p.stderr: print(p.stderr,end="",file=sys.stderr)
if p.returncode: raise SystemExit(p.returncode)
lines=[x.strip() for x in p.stdout.splitlines() if x.strip()]
if not lines: raise SystemExit("EP5_PKT09_TEST_NO_OUTPUT")
r=json.loads(lines[-1]); required={'schema':'ekg-ep5-pkt09-terminal-specialist-tests-v1','packet_id':'PKT-EP5-09','pass':True,'baseline_commit':'ff527ae72fc93931ae316f321b3a4ea86fb9ce42','baseline_tree':'dcda3b0002d408237441230e8ee272851dab5ad7','completion_state':'SPECIALIST_COMPLETE_INACTIVE','correction_receipt_sha256':'e44f6c613355aeeaef6a4118031a546f39021419041249e196db877147484a3c','corrected_output_sha256':'716081121830c5052ccceb981d2b82819a9eb00888ff5aa49e5e1d614272e479','live_candidate_state':'NONE','evidence_admission_state':'NOT_ADMITTED','approved_adjudicated_gold_count':0,'metric_maturity':'NOT_REPORTABLE','activation_eligibility':'NOT_ELIGIBLE','diagnostic_runtime':'GOVERNED_INACTIVE','clinical_validity':'NOT_INFERRED','clinical_authority_transfer':False,'no_phi':True,'raw_clinical_payloads_included':False}
for k,v in required.items():
 if r.get(k)!=v: raise SystemExit('EP5_PKT09_GATE_MISMATCH:'+k)
if not isinstance(r.get('passed'),int) or r['passed']<380 or r['passed']!=r.get('total'): raise SystemExit('EP5_PKT09_GATE_ASSERTIONS')
for k in ['completion_manifest_sha256','lineage_sha256','handoff_sha256','recovery_sha256']:
 if not isinstance(r.get(k),str) or len(r[k])!=64: raise SystemExit('EP5_PKT09_GATE_HASH:'+k)
print(json.dumps({'schema':'ekg-ep5-pkt09-terminal-specialist-gate-v1','packet_id':'PKT-EP5-09','pass':True,'focused_assertions':r['passed'],'completion_state':'SPECIALIST_COMPLETE_INACTIVE','lineage_sha256':r['lineage_sha256'],'correction_receipt_sha256':r['correction_receipt_sha256'],'approved_adjudicated_gold_count':0,'metric_maturity':'NOT_REPORTABLE','activation_eligibility':'NOT_ELIGIBLE','diagnostic_runtime':'GOVERNED_INACTIVE','clinical_validity':'NOT_INFERRED'},sort_keys=True))
