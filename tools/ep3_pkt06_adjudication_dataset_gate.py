from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage2_adjudication_dataset_contracts.py"

proc=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if proc.stdout:
    print(proc.stdout,end="")
if proc.stderr:
    print(proc.stderr,end="",file=sys.stderr)
if proc.returncode:
    raise SystemExit(proc.returncode)
lines=[line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP3_PKT06_TEST_NO_OUTPUT")
result=json.loads(lines[-1])
required={
    "schema":"ekg-ep3-pkt06-adjudication-dataset-tests-v1",
    "pass":True,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "synthetic_fixtures_are_clinical_gold":False,
}
for key,expected in required.items():
    if result.get(key)!=expected:
        raise SystemExit(f"EP3_PKT06_GATE_MISMATCH:{key}")
if result.get("passed")!=117 or result.get("total")!=117:
    raise SystemExit("EP3_PKT06_GATE_TEST_COUNT")
print(json.dumps({
    "schema":"ekg-ep3-pkt06-adjudication-dataset-gate-v1",
    "packet_id":"PKT-EP3-06",
    "pass":True,
    "focused_assertions":117,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "synthetic_fixtures_are_clinical_gold":False,
    "raw_clinical_waveform_or_image_bytes_included":False,
    "authority_rewritten":False,
    "silent_fallback_allowed":False,
},sort_keys=True))
