from __future__ import annotations
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST = ROOT / "clinical_control" / "v12_1_candidate" / "tests" / "test_evaluation_engine.py"
ENGINE = ROOT / "clinical_control" / "v12_1_candidate" / "validation_generated" / "evaluation_engine.py"
FIXTURES = ROOT / "clinical_control" / "v12_1_candidate" / "validation_generated" / "PKT09_SYNTHETIC_EVALUATOR_FIXTURES.json"

child = subprocess.run([sys.executable, str(TEST)], cwd=ROOT, text=True, capture_output=True)
sys.stdout.write(child.stdout)
sys.stderr.write(child.stderr)
if child.returncode:
    raise SystemExit(child.returncode)

fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
assert fixtures["clinical_gold"] is False
assert fixtures["may_satisfy_no_gold_gate"] is False
assert ENGINE.exists()
print(json.dumps({
    "schema": "ekg-pkt09-evaluation-gate-v1",
    "pass": True,
    "evaluation_assertions": 55,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_promotion_allowed": False,
    "candidate_active": False,
    "native_ptbxl_labels_are_project_gold": False,
    "synthetic_fixture_is_clinical_gold": False,
}, sort_keys=True))
