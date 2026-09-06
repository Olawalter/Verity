"""§61 — agreement creation, validation, authorization, immutability."""
import json

from .conftest import (PAYMENT, AGENT_BOND, DISPUTE_BOND,
                       REQUIREMENTS, REQUIREMENTS_JSON)


def test_protocol_info(direct_vm, deployed):
    info = deployed.get_protocol_info()
    assert info["version"] == "Verity-1.0.0"
    assert info["weight_total"] == 100
    assert info["max_appeals"] == 1
    assert "JUDGMENT" in info["requirement_types"]
    assert "FETCH_SUCCESS" in info["retrieval_labels"]


def test_create_job(direct_vm, deployed, direct_alice, direct_bob, drafted):
    j = deployed.get_job(drafted)
    assert drafted == "VJ-000001"
    assert j["status"] == "DRAFT"
    assert j["requester"].lower() == str(direct_alice).lower()
    assert j["agent"].lower() == str(direct_bob).lower()
    assert j["payment_wei"] == PAYMENT
    assert j["payment_deposited"] == 0
    assert j["requirement_count"] == 6
    assert j["terms_locked"] is False
    assert j["constitution_hash"].startswith("sha256:")


def test_requirements_stored_sorted_and_typed(direct_vm, deployed, drafted):
    reqs = deployed.get_requirements(drafted)
    assert [r["id"] for r in reqs] == ["R1", "R2", "R3", "R4", "R5", "R6"]
    assert sum(r["weight"] for r in reqs) == 100
    by_id = {r["id"]: r for r in reqs}
    assert by_id["R1"]["critical"] is True
    assert by_id["R1"]["type"] == "JUDGMENT"
    assert by_id["R4"]["type"] == "DETERMINISTIC"


def test_requester_and_agent_must_differ(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("requester and agent must differ"):
        deployed.create_job(str(direct_alice), "t", "d", REQUIREMENTS_JSON,
                            PAYMENT, 10, 10)


def test_weights_must_sum_to_100(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    bad = json.dumps([
        {"id": "R1", "description": "d", "type": "JUDGMENT", "weight": 40},
        {"id": "R2", "description": "d", "type": "JUDGMENT", "weight": 30},
    ])
    with direct_vm.expect_revert("weights must sum to exactly 100"):
        deployed.create_job(str(direct_bob), "t", "d", bad, PAYMENT, 10, 10)


def test_duplicate_requirement_id_rejected(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    bad = json.dumps([
        {"id": "R1", "description": "d", "type": "JUDGMENT", "weight": 50},
        {"id": "R1", "description": "d", "type": "JUDGMENT", "weight": 50},
    ])
    with direct_vm.expect_revert("duplicate requirement id"):
        deployed.create_job(str(direct_bob), "t", "d", bad, PAYMENT, 10, 10)


def test_unsupported_requirement_type_rejected(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    bad = json.dumps([
        {"id": "R1", "description": "d", "type": "VIBES", "weight": 100}])
    with direct_vm.expect_revert("unsupported requirement type"):
        deployed.create_job(str(direct_bob), "t", "d", bad, PAYMENT, 10, 10)


def test_zero_weight_rejected(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    bad = json.dumps([
        {"id": "R1", "description": "d", "type": "JUDGMENT", "weight": 0},
        {"id": "R2", "description": "d", "type": "JUDGMENT", "weight": 100},
    ])
    with direct_vm.expect_revert("must be 1..100"):
        deployed.create_job(str(direct_bob), "t", "d", bad, PAYMENT, 10, 10)


def test_zero_payment_rejected(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("payment must be > 0"):
        deployed.create_job(str(direct_bob), "t", "d", REQUIREMENTS_JSON, 0, 10, 10)


def test_invalid_settlement_policy_rejected(direct_vm, deployed, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid settlement_partial"):
        deployed.create_job(str(direct_bob), "t", "d", REQUIREMENTS_JSON,
                            PAYMENT, 10, 10, "", "FULL", "WHATEVER")


def test_update_draft_changes_constitution_hash(
    direct_vm, deployed, direct_alice, drafted
):
    before = deployed.get_job(drafted)["constitution_hash"]
    direct_vm.sender = direct_alice
    after = deployed.update_draft(drafted, "New title", "New description",
                                  REQUIREMENTS_JSON, "new rules")
    assert after != before
    assert deployed.get_job(drafted)["constitution_hash"] == after


def test_only_requester_may_update_draft(direct_vm, deployed, direct_bob, drafted):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("requester only"):
        deployed.update_draft(drafted, "hijack", "d", REQUIREMENTS_JSON, "")


def test_accept_requires_designated_agent(
    direct_vm, deployed, direct_charlie, funded
):
    direct_vm.sender = direct_charlie
    direct_vm.value = AGENT_BOND
    with direct_vm.expect_revert("agent only"):
        deployed.accept_job(funded, "")
    direct_vm.value = 0


def test_accept_moves_to_active_and_absolutises_deadline(
    direct_vm, deployed, direct_bob, funded
):
    before = deployed.get_job(funded)
    assert before["execution_deadline_tick"] == 50   # still an offset
    direct_vm.sender = direct_bob
    direct_vm.value = AGENT_BOND
    deployed.accept_job(funded, "sha256:plan")
    direct_vm.value = 0
    j = deployed.get_job(funded)
    assert j["status"] == "ACTIVE"
    assert j["execution_plan_hash"] == "sha256:plan"
    # now absolute: accepted_tick + 50
    assert j["execution_deadline_tick"] == j["accepted_tick"] + 50


def test_list_jobs(direct_vm, deployed, direct_alice, direct_bob, drafted):
    direct_vm.sender = direct_alice
    deployed.create_job(str(direct_bob), "second", "d", REQUIREMENTS_JSON,
                        PAYMENT, 10, 10)
    page = deployed.list_jobs(0, 10)
    assert page["total"] == 2
    assert [r["job_id"] for r in page["rows"]] == ["VJ-000001", "VJ-000002"]


def test_unknown_job_reverts(direct_vm, deployed, direct_alice):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("unknown job"):
        deployed.get_job("VJ-999999")
