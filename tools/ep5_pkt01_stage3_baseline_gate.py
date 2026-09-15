from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_baseline.py"
proc=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if proc.stdout:
    print(proc.stdout,end="")
if proc.stderr:
    print(proc.stderr,end="",file=sys.stderr)
if proc.returncode:
    raise SystemExit(proc.returncode)
lines=[line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP5_PKT01_TEST_NO_OUTPUT")
result=json.loads(lines[-1])
required={
    "schema":"ekg-ep5-pkt01-stage3-baseline-tests-v1",
    "pass":True,
    "packet_id":"PKT-EP5-01",
    "stage2_receipt_sha256":"6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a",
    "platform_ekg_pin_state":"STALE_PIN",
    "platform_silent_repin_allowed":False,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "metric_maturity":"NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "phi_included":False,
    "raw_clinical_payloads_included":False,
    "synthetic_fixtures_are_clinical_gold":False,
    "bulk_donor_import_performed":False,
}
for key,expected in required.items():
    if result.get(key)!=expected:
        raise SystemExit("EP5_PKT01_GATE_MISMATCH:"+key)
if not isinstance(result.get("passed"),int) or result["passed"]<300:
    raise SystemExit("EP5_PKT01_GATE_ASSERTION_FLOOR")
if result.get("passed")!=result.get("total"):
    raise SystemExit("EP5_PKT01_GATE_ASSERTION_COUNT_MISMATCH")
print(json.dumps({
    "schema":"ekg-ep5-pkt01-stage3-baseline-gate-v1","packet_id":"PKT-EP5-01","pass":True,
    "focused_assertions":result["passed"],"platform_ekg_pin_state":"STALE_PIN",
    "diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,
    "clinical_accuracy_claimed":False,"diagnostic_performance_reporting_allowed":False,
},sort_keys=True))
