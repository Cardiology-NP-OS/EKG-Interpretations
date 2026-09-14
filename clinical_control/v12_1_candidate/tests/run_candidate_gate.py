import json
import subprocess
import sys
from pathlib import Path

TESTS = [
    ("test_registry_contracts.py", 27),
    ("test_calculation_engine.py", 40),
    ("test_traceability.py", 13),
]
ROOT = Path(__file__).resolve().parent
results = []

for name, expected_count in TESTS:
    child = subprocess.run(
        [sys.executable, str(ROOT / name)],
        cwd=ROOT.parent.parent.parent,
        text=True,
        capture_output=True,
    )
    sys.stdout.write(child.stdout)
    sys.stderr.write(child.stderr)
    results.append({
        "test": name,
        "expected_tests": expected_count,
        "exit_code": child.returncode,
    })
    if child.returncode != 0:
        print(json.dumps({
            "schema": "ekg-v12-1-candidate-gate-v1",
            "pass": False,
            "candidate_active": False,
            "results": results,
        }, sort_keys=True))
        raise SystemExit(child.returncode or 1)

print(json.dumps({
    "schema": "ekg-v12-1-candidate-gate-v1",
    "pass": True,
    "candidate_active": False,
    "registry_contract_tests": 27,
    "calculation_tests": 40,
    "traceability_tests": 13,
    "total_tests": sum(count for _, count in TESTS),
    "results": results,
}, sort_keys=True))
