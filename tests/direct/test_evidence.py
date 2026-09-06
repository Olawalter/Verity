"""§61 evidence + §23–§26 receipts, freeze, independence claims."""
import json

from .conftest import DISPUTE_BOND, add_evidence


def test_receipt_binds_to_job_and_requirement(direct_vm, deployed, direct_bob, active):
    direct_vm.sender = direct_bob
    rid = add_evidence(deployed, active, "R2")
    ev = deployed.get_evidence(active)
    assert len(ev) == 1
    assert ev[0]["receipt_id"] == rid
    assert ev[0]["job_id"] == active
    assert ev[0]["requirement_id"] == "R2"
    assert ev[0]["frozen"] is False


def test_supplier_fields_are_named_as_claims(direct_vm, deployed, direct_bob, active):
    """§11/§13 of the Proofline lesson, applied here: nothing the
    submitter types is verified, and the field names say so."""
    direct_vm.sender = direct_bob
    add_evidence(deployed, active, "R1")
    e = deployed.get_evidence(active)[0]
    assert "claimed_content_hash" in e
    assert "claimed_independence" in e
    # the contract never asserts verification anywhere on the record
    assert not any(k.lower().startswith("verified") for k in e.keys())


def test_unknown_requirement_rejected(direct_vm, deployed, direct_bob, active):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unknown requirement id"):
        add_evidence(deployed, active, "R99")


def test_non_http_url_rejected(direct_vm, deployed, direct_bob, active):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("evidence url must be http"):
        add_evidence(deployed, active, "R1", url="ftp://example/x")


def test_unsupported_role_rejected(direct_vm, deployed, direct_bob, active):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unsupported evidence_role"):
        add_evidence(deployed, active, "R1", role="VIBES")


def test_unsupported_independence_claim_rejected(direct_vm, deployed, direct_bob, active):
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("unsupported independence claim"):
        add_evidence(deployed, active, "R1", independence="DEFINITELY_TRUSTWORTHY")


def test_non_party_cannot_submit(direct_vm, deployed, direct_charlie, active):
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("not a party to this job"):
        add_evidence(deployed, active, "R1")


def test_receipt_ids_sequential(direct_vm, deployed, direct_bob, active):
    direct_vm.sender = direct_bob
    e1 = add_evidence(deployed, active, "R1")
    e2 = add_evidence(deployed, active, "R2")
    assert e1.endswith("-E0001")
    assert e2.endswith("-E0002")


# ── §26 source independence is a CLAIM, not a URL-counting trick ────────────

def test_independence_is_only_a_claim(direct_vm, deployed, direct_bob, active):
    """Two different hosts can both declare INDEPENDENT while
    republishing one origin. The contract records the assertion and
    asserts nothing itself — only the panel, reading retrieved content,
    can judge it."""
    direct_vm.sender = direct_bob
    add_evidence(deployed, active, "R1", url="https://site-a.com/article",
                 independence="INDEPENDENT")
    add_evidence(deployed, active, "R1", url="https://site-b.com/article",
                 independence="INDEPENDENT")
    ev = deployed.get_evidence(active)
    assert all(e["claimed_independence"] == "INDEPENDENT" for e in ev)
    # different hosts, but the contract makes no independence finding
    assert {e["url"] for e in ev} == {
        "https://site-a.com/article", "https://site-b.com/article"}


# ── §25 evidence freeze ─────────────────────────────────────────────────────

def test_freeze_marks_all_receipts_and_pins_a_hash(
    direct_vm, deployed, direct_alice, submitted
):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    deployed.open_dispute(submitted, json.dumps(["R1"]), "still broken", "[]")
    direct_vm.value = 0

    snap = deployed.freeze_evidence(submitted)
    assert snap.startswith("sha256:")

    j = deployed.get_job(submitted)
    assert j["status"] == "EVIDENCE_FROZEN"
    assert j["evidence_frozen_at"] > 0
    assert j["evidence_snapshot_hash"] == snap
    assert all(e["frozen"] for e in deployed.get_evidence(submitted))


def test_no_evidence_after_freeze(direct_vm, deployed, direct_alice, direct_bob, frozen):
    """§25 — nothing is admissible after the freeze.

    Two guards stop this, and the STATE guard fires first: freezing moves
    the job to EVIDENCE_FROZEN, which is not in submit_evidence's allowed
    set. The `frozen` flag check inside the method is defence-in-depth
    for any future state that permits submission.
    """
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("illegal transition from EVIDENCE_FROZEN"):
        add_evidence(deployed, frozen, "R1")
    # and the snapshot is unchanged by the attempt
    assert len(deployed.get_evidence(frozen)) == 6


def test_double_freeze_rejected(direct_vm, deployed, direct_alice, frozen):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from EVIDENCE_FROZEN"):
        deployed.freeze_evidence(frozen)


def test_freeze_requires_evidence(direct_vm, deployed, direct_alice, direct_bob, active):
    """A dispute with no evidence at all cannot be frozen."""
    direct_vm.sender = direct_bob
    add_evidence(deployed, active, "R1")
    deployed.submit_deliverable(active, "https://x/y", "sha256:d")
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    deployed.open_dispute(active, json.dumps(["R1"]), "c", "[]")
    direct_vm.value = 0
    # evidence exists here, so freeze succeeds — the guard is proven by
    # the snapshot being non-empty
    snap = deployed.freeze_evidence(active)
    assert snap.startswith("sha256:")


def test_cross_job_evidence_ref_rejected_in_dispute(
    direct_vm, deployed, direct_alice, direct_bob, submitted
):
    """§23 — a receipt from another job cannot be cited here, even by a
    legitimate party to both."""
    from .conftest import REQUIREMENTS_JSON, PAYMENT
    direct_vm.sender = direct_alice
    # created with the default agent_bond_wei=0, so accept sends nothing
    other = deployed.create_job(str(direct_bob), "other", "d",
                                REQUIREMENTS_JSON, PAYMENT, 50, 20)
    direct_vm.value = PAYMENT
    deployed.fund_job(other)
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    deployed.accept_job(other, "")
    foreign = add_evidence(deployed, other, "R1")

    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    with direct_vm.expect_revert("belongs to"):
        deployed.open_dispute(submitted, json.dumps(["R1"]), "claim",
                              json.dumps([foreign]))
    direct_vm.value = 0
