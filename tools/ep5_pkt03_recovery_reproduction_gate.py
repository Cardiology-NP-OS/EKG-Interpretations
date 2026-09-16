from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEST = ROOT / "clinical_control" / "v12_1_candidate" / "tests" / "test_stage3_recovery_reproduction.py"

proc = subprocess.run([sys.executable, str(TEST)], cwd=ROOT, capture_output=True, text=True)
if proc.stdout:
    print(proc.stdout, end="")
if proc.stderr:
    print(proc.stderr, end="", file=sys.stderr)
if proc.returncode:
    raise SystemExit(proc.returncode)

lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
if not lines:
    raise SystemExit("EP5_PKT03_TEST_NO_OUTPUT")

result = json.loads(lines[-1])

required = {
    "schema": "ekg-ep5-pkt03-recovery-reproduction-tests-v1",
    "pass": True,
    "packet_id": "PKT-EP5-03",
    "baseline_commit": "13cf8ae61b7a75f10ea6d1ced86a0e5338e321f9",
    "baseline_tree": "e5c902e1ba1400e1b64e5862f3bf60a7a1ae9c53",
    "corrected_attestation_sha256": "4f73c50d8fce32293e3d5d8ab93e727be0077301aa930f033e1cc133043ee119",
    "correction_receipt_sha256": "10feb50167e9bcb8f72cc2781216bee960c983ff69ada10c4bf94ff349d326ad",
    "ep6_owner_runtime_manifest_sha256": "908822fcfcde38bd1032416377da71149689d5cbc82c4af189604aabcec30ffa",
    "ep6_recovery_checkpoint_sha256": "6179ab475ce48f509bec7636cd68ff6b4308d3a702a04bb6a585639209b22409",
    "compatibility_state": "HANDSHAKE_ELIGIBLE",
    "platform_current_pin_state": "STALE_PIN",
    "platform_pin_mutation_allowed": False,
    "silent_repin_allowed": False,
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "approved_adjudicated_gold_count": 0,
    "metric_maturity": "NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "clinical_authority_transfer": False,
    "phi_included": False,
    "raw_clinical_payloads_included": False,
    "candidate_active": False,
    "synthetic_fixtures_are_clinical_gold": False,
    "replay_accepted_packet_work": False,
    "source_substitution_allowed": False,
    "candidate_substitution_allowed": False,
    "automatic_previous_version_fallback_allowed": False,
}

for key, expected in required.items():
    if result.get(key) != expected:
        raise SystemExit("EP5_PKT03_GATE_MISMATCH:" + key)

if not isinstance(result.get("passed"), int) or result["passed"] < 200:
    raise SystemExit("EP5_PKT03_GATE_ASSERTION_FLOOR")

if result.get("passed") != result.get("total"):
    raise SystemExit("EP5_PKT03_GATE_ASSERTION_COUNT_MISMATCH")

print(json.dumps({
    "schema": "ekg-ep5-pkt03-recovery-reproduction-gate-v1",
    "packet_id": "PKT-EP5-03",
    "pass": True,
    "focused_assertions": result["passed"],
    "baseline_commit": result["baseline_commit"],
    "baseline_tree": result["baseline_tree"],
    "corrected_attestation_sha256": result["corrected_attestation_sha256"],
    "correction_receipt_sha256": result["correction_receipt_sha256"],
    "ep6_owner_runtime_manifest_sha256": result["ep6_owner_runtime_manifest_sha256"],
    "ep6_recovery_checkpoint_sha256": result["ep6_recovery_checkpoint_sha256"],
    "compatibility_state": "HANDSHAKE_ELIGIBLE",
    "platform_pin_mutation_allowed": False,
    "silent_repin_allowed": False,
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "candidate_active": False,
    "clinical_accuracy_claimed": False,
    "diagnostic_performance_reporting_allowed": False,
    "phi_included": False,
    "raw_clinical_payloads_included": False,
    "replay_accepted_packet_work": False,
    "source_substitution_allowed": False,
    "candidate_substitution_allowed": False,
    "automatic_previous_version_fallback_allowed": False,
}, sort_keys=True))
