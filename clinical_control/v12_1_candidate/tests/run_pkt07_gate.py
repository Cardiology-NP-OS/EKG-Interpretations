import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
test = ROOT / "test_measurement_evidence_adapter.py"
cp = subprocess.run([sys.executable, str(test)], cwd=ROOT.parents[2])
result = {
    "schema": "ekg-pkt07-measurement-gate-v1",
    "pass": cp.returncode == 0,
    "measurement_contract_tests": 65,
    "candidate_active": False,
    "clinical_accuracy_claimed": False,
}
print(json.dumps(result, sort_keys=True))
raise SystemExit(cp.returncode)
