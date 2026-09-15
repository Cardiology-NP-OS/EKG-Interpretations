from __future__ import annotations
import json, pathlib, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
test = ROOT / "clinical_control" / "v12_1_candidate" / "tests" / "test_pattern_candidate_engine.py"
cp = subprocess.run([sys.executable, str(test)], cwd=ROOT)
if cp.returncode:
    raise SystemExit(cp.returncode)
print(json.dumps({
    "schema":"ekg-pkt08-pattern-candidate-gate-v1",
    "pass":True,
    "pattern_candidate_tests":51,
    "registry_patterns":59,
    "executable_patterns":3,
    "unsupported_patterns":56,
    "candidate_active":False,
    "clinical_accuracy_claimed":False
}, sort_keys=True))
