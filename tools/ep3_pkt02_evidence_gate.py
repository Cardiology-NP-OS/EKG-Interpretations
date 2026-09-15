from __future__ import annotations
import json, pathlib, subprocess, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage2_source_evidence_bridge.py"
FIXTURE=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"/"EP3_PKT02_EVIDENCE_FIXTURES.json"

child=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,text=True,capture_output=True)
sys.stdout.write(child.stdout); sys.stderr.write(child.stderr)
if child.returncode:
    raise SystemExit(child.returncode)
lines=[line.strip() for line in child.stdout.splitlines() if line.strip()]
result=json.loads(lines[-1])
assert result["schema"]=="ekg-ep3-pkt02-evidence-tests-v1"
assert result["pass"] is True
assert result["candidate_active"] is False
assert result["approved_adjudicated_gold_count"]==0
assert result["clinical_accuracy_claimed"] is False
fixture=json.loads(FIXTURE.read_text(encoding="utf-8-sig"))
assert fixture["phi"] is False
assert fixture["raw_clinical_source_bytes_included"] is False
assert fixture["diagnostic_runtime_activation_allowed"] is False
print(json.dumps({"schema":"ekg-ep3-pkt02-evidence-gate-v1","pass":True,"packet_id":"PKT-EP3-02","focused_assertions":result["passed"],"candidate_active":False,"approved_adjudicated_gold_count":0,"diagnostic_runtime_activation_allowed":False,"clinical_accuracy_claimed":False},sort_keys=True))
