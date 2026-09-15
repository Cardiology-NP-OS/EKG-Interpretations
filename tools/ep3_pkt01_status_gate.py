from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEST = ROOT / "clinical_control" / "v12_1_candidate" / "tests" / "test_system_status_adapter.py"

proc = subprocess.run(
    [sys.executable, str(TEST)],
    cwd=ROOT,
    capture_output=True,
    text=True,
)
if proc.stdout:
    print(proc.stdout, end="")
if proc.stderr:
    print(proc.stderr, end="", file=sys.stderr)
if proc.returncode != 0:
    raise SystemExit(proc.returncode)

lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP3_PKT01_STATUS_TEST_NO_OUTPUT")

try:
    result = json.loads(lines[-1])
except json.JSONDecodeError as exc:
    raise SystemExit("EP3_PKT01_STATUS_TEST_MISSING_JSON") from exc

required = {
    "schema": "ekg-ep3-pkt01-system-status-tests-v1",
    "pass": True,
    "candidate_active": False,
    "clinical_accuracy_claimed": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_execution_allowed": False,
}
for key, expected in required.items():
    if result.get(key) != expected:
        raise SystemExit(f"EP3_PKT01_STATUS_GATE_MISMATCH:{key}")

if result.get("total") != 39 or result.get("passed") != 39:
    raise SystemExit("EP3_PKT01_STATUS_GATE_TEST_COUNT")

print(json.dumps({
    "schema": "ekg-ep3-pkt01-system-status-gate-v1",
    "pass": True,
    "passed": result["passed"],
    "total": result["total"],
    "candidate_active": False,
    "clinical_accuracy_claimed": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_execution_allowed": False,
}, sort_keys=True))