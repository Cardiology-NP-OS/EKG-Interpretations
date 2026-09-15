from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
TEST=ROOT/"clinical_control"/"v12_1_candidate"/"tests"/"test_stage3_compatibility_attestation.py"
proc=subprocess.run([sys.executable,str(TEST)],cwd=ROOT,capture_output=True,text=True)
if proc.stdout:
    print(proc.stdout,end="")
if proc.stderr:
    print(proc.stderr,end="",file=sys.stderr)
if proc.returncode:
    raise SystemExit(proc.returncode)
lines=[line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP5_PKT02_TEST_NO_OUTPUT")
result=json.loads(lines[-1])
required={
 "schema":"ekg-ep5-pkt02-compatibility-attestation-tests-v1",
 "pass":True,"packet_id":"PKT-EP5-02",
 "compatibility_state":"HANDSHAKE_ELIGIBLE",
 "platform_current_pin_state":"STALE_PIN",
 "platform_pin_mutation_allowed":False,
 "silent_repin_allowed":False,
 "diagnostic_runtime":"GOVERNED_INACTIVE",
 "approved_adjudicated_gold_count":0,
 "metric_maturity":"NOT_REPORTABLE",
 "diagnostic_performance_reporting_allowed":False,
 "clinical_accuracy_claimed":False,
 "clinical_authority_transfer":False,
 "phi_included":False,"raw_clinical_payloads_included":False,
}
for key,expected in required.items():
    if result.get(key)!=expected:
        raise SystemExit("EP5_PKT02_GATE_MISMATCH:"+key)
if not isinstance(result.get("passed"),int) or result["passed"]<300:
    raise SystemExit("EP5_PKT02_GATE_ASSERTION_FLOOR")
if result.get("passed")!=result.get("total"):
    raise SystemExit("EP5_PKT02_GATE_ASSERTION_COUNT_MISMATCH")
print(json.dumps({
 "schema":"ekg-ep5-pkt02-compatibility-attestation-gate-v1",
 "packet_id":"PKT-EP5-02","pass":True,"focused_assertions":result["passed"],
 "compatibility_state":"HANDSHAKE_ELIGIBLE","platform_pin_mutation_allowed":False,
 "diagnostic_runtime":"GOVERNED_INACTIVE","clinical_accuracy_claimed":False
},sort_keys=True))
