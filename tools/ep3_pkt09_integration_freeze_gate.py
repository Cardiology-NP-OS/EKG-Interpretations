from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage2_integration_freeze.py"

proc=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if proc.stdout:
    print(proc.stdout,end="")
if proc.stderr:
    print(proc.stderr,end="",file=sys.stderr)
if proc.returncode:
    raise SystemExit(proc.returncode)
lines=[line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP3_PKT09_TEST_NO_OUTPUT")
result=json.loads(lines[-1])
required={
    "schema":"ekg-ep3-pkt09-integration-freeze-tests-v1",
    "pass":True,
    "packet_id":"PKT-EP3-09",
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "metric_maturity":"NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "integration_freeze_state":"BLOCKED",
    "integration_descriptor_status":"PROVISIONAL_READ_ONLY",
    "raw_clinical_waveform_or_image_bytes_included":False,
    "phi_included":False,
    "synthetic_fixtures_are_clinical_gold":False,
    "bulk_donor_import_performed":False,
}
for key,expected in required.items():
    if result.get(key)!=expected:
        raise SystemExit(f"EP3_PKT09_GATE_MISMATCH:{key}")
if not isinstance(result.get("passed"),int) or result["passed"] < 200:
    raise SystemExit("EP3_PKT09_GATE_ASSERTION_FLOOR")
if result.get("passed")!=result.get("total"):
    raise SystemExit("EP3_PKT09_GATE_ASSERTION_COUNT_MISMATCH")
print(json.dumps({
    "schema":"ekg-ep3-pkt09-integration-freeze-gate-v1",
    "packet_id":"PKT-EP3-09",
    "pass":True,
    "focused_assertions":result["passed"],
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "candidate_active":False,
    "clinical_accuracy_claimed":False,
    "diagnostic_performance_reporting_allowed":False,
    "integration_descriptor_status":"PROVISIONAL_READ_ONLY",
},sort_keys=True))
