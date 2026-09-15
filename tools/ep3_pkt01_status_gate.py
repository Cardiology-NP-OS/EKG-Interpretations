from __future__ import annotations
import json, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
TESTS=[
    ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_system_status_adapter.py",
    ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage2_system_status.py",
]
FIXTURE=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"/"EP3_PKT01_STATUS_FIXTURES.json"

for test in TESTS:
    child=subprocess.run([sys.executable,str(test)],cwd=ROOT,text=True,capture_output=True)
    sys.stdout.write(child.stdout); sys.stderr.write(child.stderr)
    if child.returncode:
        raise SystemExit(child.returncode)

fixture=json.loads(FIXTURE.read_text(encoding="utf-8-sig"))
assert fixture["phi"] is False
assert fixture["synthetic_engineering_evidence_only"] is True
assert fixture["raw_clinical_source_bytes_included"] is False
assert fixture["candidate_active"] is False
assert fixture["clinical_accuracy_claimed"] is False
assert fixture["approved_adjudicated_gold_count"] == 0
assert fixture["diagnostic_execution_allowed"] is False
assert fixture["diagnostic_runtime_activation_allowed"] is False
assert fixture["native_dataset_annotations_are_project_gold"] is False
assert fixture["synthetic_fixtures_are_clinical_gold"] is False

print(json.dumps({
    "schema":"ekg-ep3-pkt01-status-gate-v2","pass":True,
    "packet_id":"PKT-EP3-01","focused_assertions":99,
    "candidate_active":False,"approved_adjudicated_gold_count":0,
    "diagnostic_execution_allowed":False,"clinical_accuracy_claimed":False,
    "raw_clinical_source_bytes_in_git":False
},sort_keys=True))
