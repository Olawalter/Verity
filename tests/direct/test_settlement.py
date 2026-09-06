"""§21 settlement, §22 critical requirements, §37 appeals, §28 unverifiable.

The headline test is the spec's own worked example: 100 GEN, score 80,
agent 80 / requester 20.
"""
import json

from .conftest import (PAYMENT, AGENT_BOND, DISPUTE_BOND, ALL_IDS,
                       REQUIREMENTS_JSON, make_verdict, mock_panel)

ALL_PASS = {r: "PASS" for r in ALL_IDS}


def _to_verdict(direct_vm, deployed, sender, job_id, results, **kw):
    mock_panel(direct_vm, make_verdict(job_id, results, **kw))
    direct_vm.sender = sender
    return deployed.adjudicate(job_id)


def _finalize(direct_vm, deployed, sender, job_id):
    direct_vm.sender = sender
    for _ in range(4):
        deployed.tick()
    deployed.finalize_verdict(job_id)


# ═══ the spec's §21 worked example ═══════════════════════════════════════════

def test_spec_worked_example_80_20(direct_vm, deployed, direct_alice, frozen):
    """R1 PASS 30, R2 PASS 25, R3 PASS 20, R4 FAIL 10, R5 FAIL 10,
    R6 PASS 5  →  score 80  →  agent 80 GEN, requester 20 GEN."""
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    results["R5"] = "FAIL"
    vid = _to_verdict(direct_vm, deployed, direct_alice, frozen, results)

    v = deployed.get_verdict(frozen, vid)
    assert v["verdict"] == "PARTIAL"
    assert v["score"] == 80

    # ACCEPTED-style settle is illegal here; must finalize first
    with direct_vm.expect_revert("illegal transition from VERDICT"):
        deployed.settle(frozen)

    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)

    s = deployed.get_settlement(frozen)
    assert s["policy_applied"] == "PROPORTIONAL"
    assert s["score"] == 80
    assert s["agent_payout"] == PAYMENT * 80 // 100
    assert s["requester_payout"] == PAYMENT - (PAYMENT * 80 // 100)
    assert s["agent_payout"] == 80 * (10 ** 18)
    assert s["requester_payout"] == 20 * (10 ** 18)
    assert s["agent_payout"] + s["requester_payout"] == PAYMENT
    assert s["escrow_after"] == 0
    assert deployed.get_job(frozen)["escrow_held"] == 0


# ═══ policy mapping ══════════════════════════════════════════════════════════

def test_verified_pays_full(direct_vm, deployed, direct_alice, frozen):
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)
    s = deployed.get_settlement(frozen)
    assert s["policy_applied"] == "FULL"
    assert s["agent_payout"] == PAYMENT
    assert s["requester_payout"] == 0


def test_failed_refunds_requester(direct_vm, deployed, direct_alice, frozen):
    results = {r: "FAIL" for r in ALL_IDS}
    _to_verdict(direct_vm, deployed, direct_alice, frozen, results)
    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)
    s = deployed.get_settlement(frozen)
    assert s["policy_applied"] == "REFUND"
    assert s["agent_payout"] == 0
    assert s["requester_payout"] == PAYMENT


def test_critical_failure_overrides_proportional(
    direct_vm, deployed, direct_alice, frozen
):
    """§22 — R1 is critical. Failing it maps the whole job to the FAILED
    policy under critical_policy=FAIL_JOB, even though 70% passed."""
    results = dict(ALL_PASS)
    results["R1"] = "FAIL"
    vid = _to_verdict(direct_vm, deployed, direct_alice, frozen, results)
    v = deployed.get_verdict(frozen, vid)
    assert v["score"] == 70
    assert v["critical_failed"] is True

    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)
    s = deployed.get_settlement(frozen)
    assert s["policy_applied"] == "REFUND", "critical failure must override score"
    assert s["agent_payout"] == 0
    assert s["requester_payout"] == PAYMENT


def test_critical_policy_proportional_does_not_override(
    direct_vm, deployed, direct_alice, direct_bob
):
    """Same failure under critical_policy=PROPORTIONAL keeps the score."""
    direct_vm.sender = direct_alice
    job = deployed.create_job(
        str(direct_bob), "lenient", "d", REQUIREMENTS_JSON, PAYMENT, 50, 20,
        "", "FULL", "PROPORTIONAL", "REFUND", "HUMAN_REVIEW", "PROPORTIONAL", 0, 0)
    direct_vm.value = PAYMENT
    deployed.fund_job(job)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    deployed.accept_job(job, "")
    from .conftest import add_evidence
    for rid in ALL_IDS:
        add_evidence(deployed, job, rid)
    deployed.submit_deliverable(job, "https://x/y", "sha256:d")
    direct_vm.sender = direct_alice
    deployed.open_dispute(job, json.dumps(["R1"]), "critical failed", "[]")
    deployed.freeze_evidence(job)

    results = dict(ALL_PASS)
    results["R1"] = "FAIL"
    _to_verdict(direct_vm, deployed, direct_alice, job, results)
    _finalize(direct_vm, deployed, direct_alice, job)
    deployed.settle(job)
    s = deployed.get_settlement(job)
    assert s["policy_applied"] == "PROPORTIONAL"
    assert s["agent_payout"] == PAYMENT * 70 // 100


# ═══ §28 UNVERIFIABLE → HUMAN_REVIEW → no settlement ═════════════════════════

def test_unverifiable_blocks_settlement_and_protects_escrow(
    direct_vm, deployed, direct_alice, frozen
):
    results = dict(ALL_PASS)
    results["R3"] = "UNVERIFIABLE"
    _to_verdict(direct_vm, deployed, direct_alice, frozen, results,
                unverifiable_items=["CI unreachable"])
    _finalize(direct_vm, deployed, direct_alice, frozen)

    with direct_vm.expect_revert("HUMAN_REVIEW"):
        deployed.settle(frozen)
    j = deployed.get_job(frozen)
    assert j["escrow_held"] == PAYMENT + AGENT_BOND + DISPUTE_BOND


def test_unverifiable_recoverable_after_deadline(
    direct_vm, deployed, direct_alice, frozen
):
    """§40 — no permanent escrow lock."""
    results = dict(ALL_PASS)
    results["R3"] = "UNVERIFIABLE"
    _to_verdict(direct_vm, deployed, direct_alice, frozen, results,
                unverifiable_items=["CI unreachable"])
    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.recover_escrow(frozen)
    j = deployed.get_job(frozen)
    assert j["status"] == "REFUNDED"
    assert j["escrow_held"] == 0


def test_recover_refused_when_verdict_settles_normally(
    direct_vm, deployed, direct_alice, frozen
):
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    _finalize(direct_vm, deployed, direct_alice, frozen)
    with direct_vm.expect_revert("settles normally"):
        deployed.recover_escrow(frozen)


# ═══ §37 appeals ═════════════════════════════════════════════════════════════

def test_appeal_reruns_and_second_verdict_settles(
    direct_vm, deployed, direct_alice, direct_bob, frozen
):
    results = dict(ALL_PASS)
    results["R1"] = "FAIL"
    v1 = _to_verdict(direct_vm, deployed, direct_alice, frozen, results)
    assert deployed.get_verdict(frozen, v1)["critical_failed"] is True

    # agent appeals with grounds
    direct_vm.sender = direct_bob
    deployed.appeal(frozen, "The linked CI run proves R1; it was misread.")
    assert deployed.get_job(frozen)["status"] == "APPEALED"

    # a stale verdict cannot settle from APPEALED
    with direct_vm.expect_revert("illegal transition from APPEALED"):
        deployed.settle(frozen)

    v2 = _to_verdict(direct_vm, deployed, direct_bob, frozen, ALL_PASS)
    assert v2 == 2
    assert deployed.list_verdicts(frozen) == [1, 2]
    # verdict #1 untouched
    assert deployed.get_verdict(frozen, 1)["critical_failed"] is True

    _finalize(direct_vm, deployed, direct_alice, frozen)
    j = deployed.get_job(frozen)
    assert j["final_verdict_id"] == 2, "settlement must pin the appeal verdict"
    deployed.settle(frozen)
    s = deployed.get_settlement(frozen)
    assert s["verdict_id"] == 2
    assert s["agent_payout"] == PAYMENT


def test_appeal_bounded_to_one(direct_vm, deployed, direct_alice, direct_bob, frozen):
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    direct_vm.sender = direct_bob
    deployed.appeal(frozen, "grounds")
    _to_verdict(direct_vm, deployed, direct_bob, frozen, ALL_PASS)
    with direct_vm.expect_revert("appeal limit reached"):
        deployed.appeal(frozen, "again")


def test_appeal_requires_grounds(direct_vm, deployed, direct_alice, direct_bob, frozen):
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("appeal grounds required"):
        deployed.appeal(frozen, "")


def test_appeal_window_closes(direct_vm, deployed, direct_alice, direct_bob, frozen):
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    for _ in range(6):
        deployed.tick()
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("appeal window closed"):
        deployed.appeal(frozen, "too late")


def test_finalize_blocked_inside_appeal_window(direct_vm, deployed, direct_alice, frozen):
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("appeal window open until tick"):
        deployed.finalize_verdict(frozen)


# ═══ §31/§32 bonds are returned, not punitively slashed ══════════════════════

def test_bonds_return_even_when_verdict_disagrees_with_requester(
    direct_vm, deployed, direct_alice, frozen
):
    """A requester who disputes and loses is not punished (§31), and an
    agent who merely underperforms is not slashed (§32)."""
    _to_verdict(direct_vm, deployed, direct_alice, frozen, ALL_PASS)
    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)
    s = deployed.get_settlement(frozen)
    assert s["dispute_bond_returned"] == DISPUTE_BOND
    assert s["agent_bond_returned"] == AGENT_BOND


def test_total_payouts_equal_total_deposits(direct_vm, deployed, direct_alice, frozen):
    before = deployed.get_job(frozen)
    deposited = (before["payment_deposited"] + before["agent_bond_deposited"]
                 + before["dispute_bond_deposited"])
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    _to_verdict(direct_vm, deployed, direct_alice, frozen, results)
    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)
    s = deployed.get_settlement(frozen)
    paid = (s["agent_payout"] + s["requester_payout"]
            + s["agent_bond_returned"] + s["dispute_bond_returned"])
    assert paid == deposited
    assert deployed.get_job(frozen)["escrow_held"] == 0


# ═══ §48 passport ════════════════════════════════════════════════════════════

def test_passport_records_verification_history(
    direct_vm, deployed, direct_alice, direct_bob, frozen
):
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    _to_verdict(direct_vm, deployed, direct_alice, frozen, results)
    _finalize(direct_vm, deployed, direct_alice, frozen)
    deployed.settle(frozen)

    p = deployed.get_passport(str(direct_bob))
    assert p["jobs_partial"] == 1
    assert p["jobs_verified"] == 0
    assert p["disputes_faced"] == 1
    assert p["scored_jobs"] == 1
    assert p["average_score"] == 90
    assert p["verified_value_wei"] == PAYMENT * 90 // 100


def test_empty_passport_reports_unknown_not_zero(direct_vm, deployed, direct_charlie):
    """§68 — never fabricate a statistic. No history means None, not 0%."""
    p = deployed.get_passport(str(direct_charlie))
    assert p["scored_jobs"] == 0
    assert p["average_score"] is None
    assert p["dispute_rate_bps"] is None
