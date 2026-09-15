from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEST = ROOT / "clinical_control" / "v12_1_candidate" / "tests" / "test_stage2_blinded_review_workflow.py"

proc = subprocess.run([sys.executable, str(TEST)], cwd=ROOT, capture_output=True, text=True)
if proc.stdout:
    print(proc.stdout, end="")
if proc.stderr:
    print(proc.stderr, end="", file=sys.stderr)
if proc.returncode != 0:
    raise SystemExit(proc.returncode)

lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP3_PKT04_TEST_NO_OUTPUT")
result = json.loads(lines[-1])
required = {
    "schema": "ekg-ep3-pkt04-blinded-review-tests-v1",
    "pass": True,
    "candidate_active": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_runtime_activation_allowed": False,
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "reviewer_submissions_are_clinical_gold": False,
    "final_adjudication_performed": False,
}
for key, expected in required.items():
    if result.get(key) != expected:
        raise SystemExit(f"EP3_PKT04_GATE_MISMATCH:{key}")
if result.get("passed") != 162 or result.get("total") != 162:
    raise SystemExit("EP3_PKT04_GATE_TEST_COUNT")

print(json.dumps({
    "schema": "ekg-ep3-pkt04-blinded-review-gate-v1",
    "packet_id": "PKT-EP3-04",
    "pass": True,
    "focused_assertions": 162,
    "candidate_active": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_runtime_activation_allowed": False,
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "reviewer_submissions_are_clinical_gold": False,
    "final_adjudication_performed": False,
    "raw_clinical_waveform_or_image_bytes_included": False,
    "authority_rewritten": False,
}, sort_keys=True))
