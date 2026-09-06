"""§61 funding + §62 escrow adversarial tests.

Every test here asserts on the DEPOSITED ledgers, never on the agreed
terms. `payment_wei` is a term; `payment_deposited` is the money.
"""
import json

from .conftest import (PAYMENT, AGENT_BOND, DISPUTE_BOND,
                       REQUIREMENTS_JSON, make_verdict, mock_panel)


# ── funding ─────────────────────────────────────────────────────────────────

def test_exact_funding_locks_terms(direct_vm, deployed, direct_alice, drafted):
    direct_vm.sender = direct_alice
    direct_vm.value = PAYMENT
    deployed.fund_job(drafted)
    direct_vm.value = 0
    j = deployed.get_job(drafted)
    assert j["status"] == "FUNDED"
    assert j["payment_deposited"] == PAYMENT
    assert j["escrow_held"] == PAYMENT
    assert j["terms_locked"] is True


def test_zero_funding_rejected(direct_vm, deployed, direct_alice, drafted):
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("funding must be > 0"):
        deployed.fund_job(drafted)


def test_wrong_funding_amount_rejected(direct_vm, deployed, direct_alice, drafted):
    direct_vm.sender = direct_alice
    for amount in (PAYMENT - 1, PAYMENT + 1):
        direct_vm.value = amount
        with direct_vm.expect_revert("funding must equal payment"):
            deployed.fund_job(drafted)
    direct_vm.value = 0


def test_only_requester_may_fund(direct_vm, deployed, direct_bob, drafted):
    direct_vm.sender = direct_bob
    direct_vm.value = PAYMENT
    with direct_vm.expect_revert("requester only"):
        deployed.fund_job(drafted)
    direct_vm.value = 0


def test_double_funding_rejected(direct_vm, deployed, direct_alice, funded):
    direct_vm.sender = direct_alice
    direct_vm.value = PAYMENT
    with direct_vm.expect_revert("illegal transition from FUNDED"):
        deployed.fund_job(funded)
    direct_vm.value = 0


def test_terms_locked_after_funding(direct_vm, deployed, direct_alice, funded):
    """§13 — the amendment path closes the moment escrow arrives."""
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from FUNDED"):
        deployed.update_draft(funded, "cheaper", "d", REQUIREMENTS_JSON, "")


# ── bonds ───────────────────────────────────────────────────────────────────

def test_agent_bond_exact_amount_enforced(direct_vm, deployed, direct_bob, funded):
    direct_vm.sender = direct_bob
    direct_vm.value = AGENT_BOND - 1
    with direct_vm.expect_revert("agent bond must equal"):
        deployed.accept_job(funded, "")
    direct_vm.value = 0


def test_bond_ledgers_are_separate(direct_vm, deployed, direct_alice, active):
    j = deployed.get_job(active)
    assert j["payment_deposited"] == PAYMENT
    assert j["agent_bond_deposited"] == AGENT_BOND
    assert j["dispute_bond_deposited"] == 0
    assert j["escrow_held"] == PAYMENT + AGENT_BOND


def test_dispute_bond_exact_amount_enforced(direct_vm, deployed, direct_alice, submitted):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND - 1
    with direct_vm.expect_revert("dispute bond must equal"):
        deployed.open_dispute(submitted, json.dumps(["R1"]), "claim", "[]")
    direct_vm.value = 0


# ── cancellation ────────────────────────────────────────────────────────────

def test_cancel_refunds_requester(direct_vm, deployed, direct_alice, funded):
    direct_vm.sender = direct_alice
    deployed.cancel_job(funded)
    j = deployed.get_job(funded)
    assert j["status"] == "CANCELLED"
    assert j["escrow_held"] == 0
    assert j["total_released"] == PAYMENT


def test_cancel_after_accept_refused(direct_vm, deployed, direct_alice, active):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from ACTIVE"):
        deployed.cancel_job(active)


# ── §62 adversarial payout sequences ────────────────────────────────────────

def _settle_accepted(direct_vm, deployed, direct_alice, submitted):
    direct_vm.sender = direct_alice
    deployed.accept_work(submitted)
    deployed.settle(submitted)


def test_settle_twice_impossible(direct_vm, deployed, direct_alice, submitted):
    _settle_accepted(direct_vm, deployed, direct_alice, submitted)
    j = deployed.get_job(submitted)
    assert j["status"] == "SETTLED"
    assert j["escrow_held"] == 0
    with direct_vm.expect_revert("illegal transition from SETTLED"):
        deployed.settle(submitted)
    assert deployed.get_job(submitted)["escrow_held"] == 0


def test_cancel_then_settle_impossible(direct_vm, deployed, direct_alice, funded):
    direct_vm.sender = direct_alice
    deployed.cancel_job(funded)
    with direct_vm.expect_revert("illegal transition from CANCELLED"):
        deployed.settle(funded)


def test_settle_then_cancel_impossible(direct_vm, deployed, direct_alice, submitted):
    _settle_accepted(direct_vm, deployed, direct_alice, submitted)
    with direct_vm.expect_revert("illegal transition from SETTLED"):
        deployed.cancel_job(submitted)


def test_unauthorized_settle_refused(
    direct_vm, deployed, direct_alice, direct_charlie, submitted
):
    direct_vm.sender = direct_alice
    deployed.accept_work(submitted)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("not a party to this job"):
        deployed.settle(submitted)
    assert deployed.get_job(submitted)["escrow_held"] == PAYMENT + AGENT_BOND


def test_settle_from_invalid_state_refused(direct_vm, deployed, direct_alice, active):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from ACTIVE"):
        deployed.settle(active)


def test_all_ledgers_zero_after_settlement(
    direct_vm, deployed, direct_alice, submitted
):
    """§62 — prove no sequence releases more than was deposited."""
    before = deployed.get_job(submitted)
    deposited = (before["payment_deposited"] + before["agent_bond_deposited"]
                 + before["dispute_bond_deposited"])
    _settle_accepted(direct_vm, deployed, direct_alice, submitted)

    j = deployed.get_job(submitted)
    s = deployed.get_settlement(submitted)
    assert j["escrow_held"] == 0
    assert j["total_released"] == deposited
    paid = (s["agent_payout"] + s["requester_payout"]
            + s["agent_bond_returned"] + s["dispute_bond_returned"])
    assert paid == deposited, "payouts must exactly equal deposits"
    assert s["escrow_after"] == 0


def test_accepted_work_pays_agent_in_full(direct_vm, deployed, direct_alice, submitted):
    _settle_accepted(direct_vm, deployed, direct_alice, submitted)
    s = deployed.get_settlement(submitted)
    assert s["policy_applied"] == "FULL"
    assert s["agent_payout"] == PAYMENT
    assert s["requester_payout"] == 0
    assert s["agent_bond_returned"] == AGENT_BOND
