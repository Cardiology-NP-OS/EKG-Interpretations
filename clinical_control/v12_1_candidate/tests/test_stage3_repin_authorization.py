from __future__ import annotations
import copy
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
GEN = ROOT / "clinical_control" / "v12_1_candidate" / "validation_generated"

def load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

ra = load("repin_authorization", GEN / "repin_authorization.py")
fixture = json.loads((GEN / "EP5_PKT04_REPIN_AUTHORIZATION_FIXTURES.json").read_text(encoding="utf-8"))
passed = 0
def check(name: str, condition: bool):
    global passed
    if not condition:
        raise AssertionError(name)
    passed += 1

def raises(name, fn, expected):
    try:
        fn()
        ok=False
    except ValueError as exc:
        ok=str(exc)==expected
    check(name,ok)

# Exact plan and lineage constants.
check("schema", ra.SCHEMA == "ekg-ep5-pkt04-repin-authorization-v1")
check("packet", ra.PACKET_ID == "PKT-EP5-04")
check("packet_sha", ra.PACKET_SHA256 == "9fe42e2bff2c3194ba073c6747df17e57c8475db20b764df29e5d236fadd038f")
check("baseline_commit", ra.BASELINE_COMMIT == "09ec7010191ecca0336abb9fccf369ce182c89e1")
check("baseline_tree", ra.BASELINE_TREE == "6f5f1c261816f8cf33001802fdfb4237b80f387b")
check("stage2", ra.STAGE2_RECEIPT_SHA256 == "6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a")
check("prior_packet", ra.PRIOR_PACKET_RECEIPT_SHA256 == "bf21e05a214a7331c3396aa567443c74943d72ac809bede01293e9c1397cfb62")
check("prior_verify", ra.PRIOR_VERIFICATION_RECEIPT_SHA256 == "c5ed10f3720743fb9379860512c18f779531449ffd79f2259a8b3fabd4303f98")
check("recovery_proof", ra.RECOVERY_PROOF_SHA256 == "21d0c01a19bce5f5731d55469bafb01104825da9fd3fd7fe85956a21ba89944d")
check("handshake", ra.HANDSHAKE_CHALLENGE_SHA256 == "cd62c4a85505c511cd03c7d786c2546174f38b53d177ba20e27923b86a289c63")
check("descriptor", ra.PLATFORM_DESCRIPTOR_SHA256 == "2f8d47ce9fe6dd1a97dbc0dcea4c9120269925b212b1ece6f4880953644387fe")
check("v12", ra.V12_BOUNDARY_VERIFICATION_SHA256 == "5ada5ae2f849ff6e06c0c3dd2e40d6713d12e05ef46097df698829fcffe47346")
check("ep6_commit", ra.EP6_PKT03["source_commit"] == "cb9dfa805eaf5cc396f8d957525d5d1f7784280c")
check("ep6_tree", ra.EP6_PKT03["source_tree"] == "95e2a56609a110ac941055acd761f4b3686ba674")
check("ep6_packet", ra.EP6_PKT03["packet_receipt_sha256"] == "5c5b63f9b2c2b67e6d9ef1bca0e6bb56f8557d46b0fc221219983bd44858a4ba")
check("ep6_verify", ra.EP6_PKT03["verification_receipt_sha256"] == "72abc685ede986e9f478b3d6b901e6868a8121094eedefad0a39f66e8b30b810")
check("ep6_continuity", ra.EP6_PKT03["continuity_contract_file_sha256"] == "e26204653eac44038f1e312ffe33d4745c30130dabddb27a6ab562817fa6f7e0")
check("ep6_stale", ra.EP6_PKT03["freshness_state"] == "STALE_PIN")
check("historical_commit", ra.HISTORICAL_STAGE2_PIN["commit"] == "6fbf1814258813bfb6ff78407e013cf23ff9e07d")
check("historical_tree", ra.HISTORICAL_STAGE2_PIN["tree"] == "01442274b34bf40ae600ee1ee21de8f15ae3b4de")
check("historical_inactive", ra.HISTORICAL_STAGE2_PIN["runtime_status"] == "GOVERNED_INACTIVE")
check("destination_commit", ra.AUTHORIZED_STAGE3_DESTINATION["commit"] == ra.BASELINE_COMMIT)
check("destination_tree", ra.AUTHORIZED_STAGE3_DESTINATION["tree"] == ra.BASELINE_TREE)
check("states", ra.AUTHORIZATION_STATES == ("ELIGIBLE","BLOCKED","REVOKED","CONSUMED"))
check("revocation_count", len(ra.REVOCATION_TRIGGERS) == 15)

# Fixtures are synthetic and non-clinical.
check("fixture_schema", fixture["schema"] == "ekg-ep5-pkt04-repin-authorization-fixtures-v1")
check("fixture_packet", fixture["packet_id"] == ra.PACKET_ID)
for key in ["synthetic_only"]:
    check("fixture_true_"+key, fixture[key] is True)
for key in ["phi_included","raw_clinical_payloads_included","credentials_included","clinical_gold"]:
    check("fixture_false_"+key, fixture[key] is False)
check("fixture_scenarios", len(fixture["scenarios"]) == 14)

# Eligible authorization is deterministic, content addressed, metadata only, and still leaves Platform stale.
eligible = ra.create_repin_authorization(**fixture["scenarios"]["eligible"])
check("eligible_state", eligible["state"] == "ELIGIBLE")
check("eligible_blockers", eligible["residual_blockers"] == [])
check("eligible_valid", ra.validate_authorization(eligible) is True)
check("eligible_deterministic", eligible == ra.create_repin_authorization())
check("auth_hash", len(eligible["authorization_sha256"]) == 64)
check("challenge_hash", len(eligible["authorization_challenge_sha256"]) == 64)
check("auth_historical", eligible["historical_stage2_pin"] == ra.HISTORICAL_STAGE2_PIN)
check("auth_destination", eligible["authorized_stage3_destination"] == ra.AUTHORIZED_STAGE3_DESTINATION)
check("auth_platform_commit", eligible["target_platform"]["commit"] == ra.EP6_PKT03["source_commit"])
check("auth_platform_tree", eligible["target_platform"]["tree"] == ra.EP6_PKT03["source_tree"])
check("auth_prior_packet", eligible["prior_packet_receipt_sha256"] == ra.PRIOR_PACKET_RECEIPT_SHA256)
check("auth_prior_verify", eligible["prior_verification_receipt_sha256"] == ra.PRIOR_VERIFICATION_RECEIPT_SHA256)
check("auth_metadata_only", eligible["metadata_only"] is True)
check("auth_single_use", eligible["single_use"] is True)
check("auth_no_replay", eligible["replay_allowed"] is False)
check("auth_renewal", eligible["renewal_requires_new_governed_authorization"] is True)
check("auth_history_immutable", eligible["historical_stage2_pin_immutable"] is True)
check("auth_no_platform_mutation", eligible["platform_mutation_performed"] is False)
check("auth_no_activation", eligible["runtime_activation_performed"] is False)
check("auth_candidate_inactive", eligible["candidate_active"] is False)
check("auth_runtime", eligible["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("auth_freshness_before", eligible["platform_freshness_before_consumption"] == "STALE_PIN")
check("auth_freshness_after_authorization", eligible["platform_freshness_after_authorization"] == "STALE_PIN")
check("auth_not_clinical", eligible["clinical_validity"] == "NOT_INFERRED")
check("auth_no_reporting", eligible["diagnostic_performance_reporting_allowed"] is False)
check("auth_no_accuracy", eligible["clinical_accuracy_claimed"] is False)
check("auth_no_authority", eligible["clinical_authority_transfer"] is False)
check("auth_no_substitution", eligible["source_substitution_allowed"] is False)
check("auth_no_fallback", eligible["automatic_previous_version_fallback_allowed"] is False)
check("auth_no_phi", eligible["phi_included"] is False)
check("auth_no_raw", eligible["raw_clinical_payloads_included"] is False)
check("auth_no_creds", eligible["credentials_included"] is False)
check("auth_zero_gold", eligible["approved_adjudicated_gold_count"] == 0)
check("auth_not_reportable", eligible["metric_maturity"] == "NOT_REPORTABLE")

# Every fixture failure path blocks with its exact governed reason.
expected = {
    "platform_drift":"PLATFORM_DRIFT",
    "ekg_drift":"EKG_DRIFT",
    "historical_pin_mismatch":"HISTORICAL_PIN_MISMATCH",
    "stale_recovery_proof":"STALE_EVIDENCE",
    "handshake_mismatch":"HANDSHAKE_MISMATCH",
    "continuity_mismatch":"CONTINUITY_MISMATCH",
    "missing_independent_verification":"MISSING_INDEPENDENT_VERIFICATION",
    "missing_candidate_ci":"MISSING_CI_PROOF",
    "missing_main_ci":"MISSING_CI_PROOF",
    "source_substitution":"SOURCE_SUBSTITUTION",
    "runtime_activation_attempt":"RUNTIME_ACTIVATION_ATTEMPT",
    "authority_escalation":"AUTHORITY_ESCALATION",
    "clinical_validity_escalation":"CLINICAL_VALIDITY_ESCALATION",
}
for name, blocker in expected.items():
    record = ra.create_repin_authorization(**fixture["scenarios"][name])
    check(name+"_blocked", record["state"] == "BLOCKED")
    check(name+"_reason", blocker in record["residual_blockers"])
    check(name+"_valid_evidence", ra.validate_authorization(record) is True)
    check(name+"_no_mutation", record["platform_mutation_performed"] is False)
    check(name+"_inactive", record["diagnostic_runtime"] == "GOVERNED_INACTIVE")
    check(name+"_no_authority", record["clinical_authority_transfer"] is False)
    check(name+"_no_phi", record["phi_included"] is False)

# Invalid structural inputs fail closed before authorization.
raises("bad historical repo", lambda: ra.create_repin_authorization(historical_pin={**ra.HISTORICAL_STAGE2_PIN,"repository":"other/repo"}), "HISTORICAL_PIN_INVALID")
raises("bad historical runtime", lambda: ra.create_repin_authorization(historical_pin={**ra.HISTORICAL_STAGE2_PIN,"runtime_status":"ACTIVE"}), "HISTORICAL_PIN_INVALID")
raises("bad destination runtime", lambda: ra.create_repin_authorization(destination={**ra.AUTHORIZED_STAGE3_DESTINATION,"runtime_status":"ACTIVE"}), "DESTINATION_PIN_INVALID")
raises("bad platform commit", lambda: ra.create_repin_authorization(platform_commit="short"), "PLATFORM_COMMIT_INVALID")
raises("bad proof", lambda: ra.create_repin_authorization(recovery_proof_sha256="short"), "RECOVERY_PROOF_INVALID")
raises("bad bool", lambda: ra.create_repin_authorization(independent_verification_pass="yes"), "INDEPENDENT_VERIFICATION_BOOLEAN_REQUIRED")

# Hash and blocker tampering cannot create valid authorization.
tampered = copy.deepcopy(eligible); tampered["clinical_accuracy_claimed"] = True
check("tampered clinical invalid", ra.validate_authorization(tampered) is False)
tampered = copy.deepcopy(eligible); tampered["residual_blockers"] = ["INVENTED"]
check("tampered blockers invalid", ra.validate_authorization(tampered) is False)
tampered = copy.deepcopy(eligible); tampered["target_platform"]["commit"] = "0"*40
check("tampered target invalid", ra.validate_authorization(tampered) is False)
tampered = copy.deepcopy(eligible); tampered["authorization_sha256"] = "0"*64
check("tampered hash invalid", ra.validate_authorization(tampered) is False)

# Initial status is eligible and deterministic.
status = ra.authorization_status(eligible)
check("status eligible", status["state"] == "ELIGIBLE")
check("status no consumption", status["valid_consumption_count"] == 0)
check("status no revocation", status["valid_revocation_count"] == 0)
check("status no replay", status["replay_allowed"] is False)
check("status no mutation", status["platform_mutation_performed"] is False)
check("status inactive", status["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("status hash", len(status["status_sha256"]) == 64)
check("status deterministic", status == ra.authorization_status(eligible))

# Consumption is a single-use evidence receipt; EP5 itself still performs no mutation.
consumption = ra.consume_authorization(eligible, consumption_id="consume.platform.001")
check("consume schema", consumption["schema"] == "ekg-ep5-pkt04-authorization-consumption-v1")
check("consume state", consumption["state"] == "CONSUMED")
check("consume auth", consumption["authorization_sha256"] == eligible["authorization_sha256"])
check("consume platform", consumption["observed_platform"]["commit"] == ra.EP6_PKT03["source_commit"])
check("consume destination", consumption["observed_destination"]["commit"] == ra.BASELINE_COMMIT)
check("consume single", consumption["single_use"] is True)
check("consume replay false", consumption["replay_allowed"] is False)
check("consume downstream allowed", consumption["downstream_platform_mutation_authorized"] is True)
check("consume ep5 mutation false", consumption["platform_mutation_performed_by_ep5"] is False)
check("consume runtime false", consumption["runtime_activation_authorized"] is False)
check("consume inactive", consumption["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("consume no authority", consumption["clinical_authority_transfer"] is False)
check("consume no phi", consumption["phi_included"] is False)
check("consume no raw", consumption["raw_clinical_payloads_included"] is False)
check("consume no creds", consumption["credentials_included"] is False)
check("consume hash", len(consumption["consumption_receipt_sha256"]) == 64)
check("consume deterministic", consumption == ra.consume_authorization(eligible, consumption_id="consume.platform.001"))
status_consumed = ra.authorization_status(eligible, consumption_receipts=[consumption])
check("status consumed", status_consumed["state"] == "CONSUMED")
check("status one consume", status_consumed["valid_consumption_count"] == 1)
raises("replay blocked", lambda: ra.consume_authorization(eligible, consumption_id="consume.platform.002", existing_consumptions=[consumption]), "AUTHORIZATION_ALREADY_CONSUMED")
raises("platform drift consume", lambda: ra.consume_authorization(eligible, consumption_id="consume.platform.003", observed_platform_commit="0"*40), "PLATFORM_TARGET_DRIFT")
raises("platform tree drift consume", lambda: ra.consume_authorization(eligible, consumption_id="consume.platform.003", observed_platform_tree="0"*40), "PLATFORM_TARGET_DRIFT")
raises("destination drift consume", lambda: ra.consume_authorization(eligible, consumption_id="consume.platform.003", observed_destination_commit="0"*40), "EKG_DESTINATION_DRIFT")
raises("destination tree drift consume", lambda: ra.consume_authorization(eligible, consumption_id="consume.platform.003", observed_destination_tree="0"*40), "EKG_DESTINATION_DRIFT")
blocked = ra.create_repin_authorization(platform_commit="0"*40)
raises("blocked cannot consume", lambda: ra.consume_authorization(blocked, consumption_id="consume.blocked.001"), "AUTHORIZATION_NOT_ELIGIBLE")

# Every governed revocation trigger creates a deterministic append-only REVOKED receipt.
revocations=[]
for trigger in ra.REVOCATION_TRIGGERS:
    receipt = ra.revoke_authorization(eligible, trigger=trigger, reason="Synthetic governed revocation: "+trigger)
    revocations.append(receipt)
    check("revoke state "+trigger, receipt["state"] == "REVOKED")
    check("revoke trigger "+trigger, receipt["trigger"] == trigger)
    check("revoke append "+trigger, receipt["append_only"] is True)
    check("revoke history "+trigger, receipt["historical_stage2_pin_preserved"] is True)
    check("revoke no mutation "+trigger, receipt["platform_mutation_performed"] is False)
    check("revoke inactive "+trigger, receipt["diagnostic_runtime"] == "GOVERNED_INACTIVE")
    check("revoke no authority "+trigger, receipt["clinical_authority_transfer"] is False)
    check("revoke no phi "+trigger, receipt["phi_included"] is False)
    check("revoke hash "+trigger, len(receipt["revocation_receipt_sha256"]) == 64)
    check("revoke deterministic "+trigger, receipt == ra.revoke_authorization(eligible, trigger=trigger, reason="Synthetic governed revocation: "+trigger))
first_revocation=revocations[0]
status_revoked=ra.authorization_status(eligible,revocation_receipts=[first_revocation])
check("status revoked",status_revoked["state"]=="REVOKED")
check("status one revoke",status_revoked["valid_revocation_count"]==1)
raises("revoked cannot consume",lambda:ra.consume_authorization(eligible,consumption_id="consume.revoked.001",existing_revocations=[first_revocation]),"AUTHORIZATION_REVOKED")
raises("bad revoke trigger",lambda:ra.revoke_authorization(eligible,trigger="INVENTED",reason="x"),"REVOCATION_TRIGGER_UNSUPPORTED")
raises("empty revoke reason",lambda:ra.revoke_authorization(eligible,trigger="PLATFORM_DRIFT",reason=""),"REVOCATION_REASON_INVALID")

# Invalid forged receipts do not alter state.
forged_consumption={**consumption,"consumption_receipt_sha256":"0"*64}
forged_revocation={**first_revocation,"revocation_receipt_sha256":"0"*64}
check("forged consumption ignored",ra.authorization_status(eligible,consumption_receipts=[forged_consumption])["state"]=="ELIGIBLE")
check("forged revocation ignored",ra.authorization_status(eligible,revocation_receipts=[forged_revocation])["state"]=="ELIGIBLE")

# Downstream descriptors expose state without creating mutation or clinical authority.
descriptor=ra.authorization_descriptor(eligible)
check("descriptor eligible",descriptor["state"]=="ELIGIBLE")
check("descriptor metadata",descriptor["metadata_only"] is True)
check("descriptor single",descriptor["single_use"] is True)
check("descriptor no replay",descriptor["replay_allowed"] is False)
check("descriptor history",descriptor["historical_stage2_pin"]==ra.HISTORICAL_STAGE2_PIN)
check("descriptor destination",descriptor["authorized_stage3_destination"]==ra.AUTHORIZED_STAGE3_DESTINATION)
check("descriptor no mutation",descriptor["platform_mutation_performed"] is False)
check("descriptor inactive",descriptor["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("descriptor no clinical",descriptor["clinical_validity"]=="NOT_INFERRED")
check("descriptor no reporting",descriptor["diagnostic_performance_reporting_allowed"] is False)
check("descriptor no accuracy",descriptor["clinical_accuracy_claimed"] is False)
check("descriptor no authority",descriptor["clinical_authority_transfer"] is False)
check("descriptor no phi",descriptor["phi_included"] is False)
check("descriptor zero gold",descriptor["approved_adjudicated_gold_count"]==0)
check("descriptor maturity",descriptor["metric_maturity"]=="NOT_REPORTABLE")
check("descriptor hash",len(descriptor["descriptor_sha256"])==64)
check("descriptor consumed",ra.authorization_descriptor(eligible,consumption_receipts=[consumption])["state"]=="CONSUMED")
check("descriptor revoked",ra.authorization_descriptor(eligible,revocation_receipts=[first_revocation])["state"]=="REVOKED")

# Git-object portability treats newline-only checkout variance as presentation, not authority drift.
blob=b"alpha\nbeta\n"
crlf=b"alpha\r\nbeta\r\n"
port=ra.git_object_portability(blob,crlf)
check("port translation",port["newline_translation_only"] is True)
check("port match",port["repository_content_match"] is True)
check("port authority",port["authority_basis"]=="GIT_OBJECT_BYTES")
check("port path nonauth",port["host_path_authoritative"] is False)
check("port machine nonauth",port["machine_name_authoritative"] is False)
check("port shell nonauth",port["shell_presentation_authoritative"] is False)
check("port hash",len(port["portability_sha256"])==64)
changed=ra.git_object_portability(blob,b"alpha\ngamma\n")
check("port real drift",changed["repository_content_match"] is False)

result={
 "schema":"ekg-ep5-pkt04-repin-authorization-tests-v1","packet_id":ra.PACKET_ID,"pass":True,
 "passed":passed,"total":passed,"baseline_commit":ra.BASELINE_COMMIT,"baseline_tree":ra.BASELINE_TREE,
 "authorization_state":eligible["state"],"authorization_sha256":eligible["authorization_sha256"],
 "authorization_challenge_sha256":eligible["authorization_challenge_sha256"],
 "historical_stage2_pin_commit":ra.HISTORICAL_STAGE2_PIN["commit"],
 "authorized_stage3_destination_commit":ra.AUTHORIZED_STAGE3_DESTINATION["commit"],
 "target_platform_commit":ra.EP6_PKT03["source_commit"],"single_use":True,"replay_allowed":False,
 "platform_mutation_performed":False,"runtime_activation_performed":False,"candidate_active":False,
 "diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED",
 "diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,
 "clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,
 "credentials_included":False,"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE"
}
print(json.dumps(result,sort_keys=True))
