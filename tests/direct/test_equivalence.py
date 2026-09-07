"""§35, §36 — the consensus contract between the panel and the protocol.

These tests cover the rules that decide whether a live round can reach
agreement at all, and the rule that keeps the model away from the money.

Direct mode runs the leader only, so a validator disagreement cannot be
staged here. What CAN be pinned down is every property the fingerprint
depends on: which fields survive normalisation, which of them are
mechanically derived by the contract rather than taken from the model,
and which are free-form and therefore excluded from consensus. Those
properties are the equivalence rule; a live panel exercises them
together.
"""
from .conftest import PAYMENT, ALL_IDS, make_verdict, mock_panel

ALL_PASS = {r: "PASS" for r in ALL_IDS}


def _adjudicate(direct_vm, deployed, sender, job_id, results, **kw):
    mock_panel(direct_vm, make_verdict(job_id, results, **kw))
    direct_vm.sender = sender
    return deployed.adjudicate(job_id)


# ═══ the model cannot move money ═════════════════════════════════════════════

def test_invented_money_fields_are_dropped(direct_vm, deployed, direct_alice, frozen):
    """A verdict that tries to name its own payout is not rejected — the
    fields are simply never read (§21).

    Rejecting them would depend on guessing every name a model might
    invent. A fixed key set does not.
    """
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    results["R5"] = "FAIL"                       # score 80, as in §21
    vid = _adjudicate(
        direct_vm, deployed, direct_alice, frozen, results,
        agent_payout=PAYMENT,                    # "pay me everything"
        requester_payout=0,
        score=100,                               # "and call it a hundred"
        confidence="0.99",   # str, not float: the direct-mode mock
                             # encodes calldata and floats are not encodable
        weights={"R1": 99},
        settlement_policy="FULL",
    )

    v = deployed.get_verdict(frozen, vid)
    assert v["score"] == 80, "score must come from the frozen weights, not the model"
    assert "agent_payout" not in v["requirements"][0]

    for _ in range(4):
        deployed.tick()
    deployed.finalize_verdict(frozen)
    deployed.settle(frozen)

    s = deployed.get_settlement(frozen)
    assert s["policy_applied"] == "PROPORTIONAL"  # not the injected FULL
    assert s["score"] == 80                       # not the injected 100
    assert s["agent_payout"] == PAYMENT * 80 // 100
    assert s["agent_payout"] + s["requester_payout"] == PAYMENT


def test_raw_response_is_retained_for_audit(direct_vm, deployed, direct_alice, frozen):
    """Dropping a field from the decision is not the same as hiding it.

    The unmodified response is stored so an auditor can see exactly what
    the panel said, including anything the protocol ignored.
    """
    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, ALL_PASS,
                      agent_payout=123456789)
    v = deployed.get_verdict(frozen, vid)
    assert "agent_payout" in v["raw_json"]
    assert v["score"] == 100


# ═══ fraud flags are a closed vocabulary ═════════════════════════════════════

def test_known_fraud_flags_recorded(direct_vm, deployed, direct_alice, frozen):
    results = dict(ALL_PASS)
    results["R3"] = "FAIL"
    vid = _adjudicate(
        direct_vm, deployed, direct_alice, frozen, results,
        fraud_flags=["UNREACHABLE_SOURCE_PRESENTED_AS_PROOF",
                     "FALSE_INDEPENDENCE_CLAIM"])
    v = deployed.get_verdict(frozen, vid)
    assert v["fraud_flags"] == ["FALSE_INDEPENDENCE_CLAIM",
                                "UNREACHABLE_SOURCE_PRESENTED_AS_PROOF"], \
        "flags are sorted so two validators cannot differ on ordering"


def test_unknown_fraud_flag_rejected(direct_vm, deployed, direct_alice, frozen):
    """Free text in a consensus-critical field is how a panel splits.

    Two validators seeing the same problem write SUSPICIOUS_EVIDENCE and
    DODGY_EVIDENCE; the determinations agree and the round fails anyway.
    The vocabulary is closed so that cannot happen.
    """
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS,
                                       fraud_flags=["SEEMS_DODGY"]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("unknown fraud flag"):
        deployed.adjudicate(frozen)


def test_fraud_flags_are_case_normalised(direct_vm, deployed, direct_alice, frozen):
    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, ALL_PASS,
                      fraud_flags=["fabricated_evidence"])
    v = deployed.get_verdict(frozen, vid)
    assert v["fraud_flags"] == ["FABRICATED_EVIDENCE"]


# ═══ derived, not trusted ════════════════════════════════════════════════════

def test_unverifiable_items_derived_from_results(
    direct_vm, deployed, direct_alice, frozen
):
    """The field summarises the results, so the contract computes it.

    A model writing prose here ("the CI endpoint was down") would give
    every validator a different string for the same finding.
    """
    results = dict(ALL_PASS)
    results["R3"] = "UNVERIFIABLE"
    results["R5"] = "UNVERIFIABLE"
    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, results,
                      unverifiable_items=["the CI endpoint was unreachable"])

    v = deployed.get_verdict(frozen, vid)
    assert v["unverifiable_items"] == ["R3", "R5"]
    assert v["verdict"] == "UNVERIFIABLE"


def test_unverifiable_items_empty_when_nothing_unresolved(
    direct_vm, deployed, direct_alice, frozen
):
    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, ALL_PASS,
                      unverifiable_items=["invented"])
    assert deployed.get_verdict(frozen, vid)["unverifiable_items"] == []


# ═══ free-form fields stay out of the decision ═══════════════════════════════

def test_reason_codes_are_recorded_not_constrained(
    direct_vm, deployed, direct_alice, frozen
):
    """reason_code is a label, not a determination.

    It is excluded from the fingerprint precisely so that two validators
    reaching the identical result can describe it differently — which is
    agreement, not disagreement. Here it is stored verbatim.
    """
    results = dict(ALL_PASS)
    results["R2"] = "FAIL"
    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, results)
    v = deployed.get_verdict(frozen, vid)

    codes = {r["id"]: r["reason_code"] for r in v["requirements"]}
    assert codes["R2"] == "FAIL_BY_TEST"
    assert codes["R1"] == "PASS_BY_TEST"


def test_reasoning_is_recorded(direct_vm, deployed, direct_alice, frozen):
    """Excluded from consensus, but retained: a verdict nobody can read
    back is not auditable."""
    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, ALL_PASS,
                      reasoning="Every requirement was met per receipt E1.")
    assert "receipt E1" in deployed.get_verdict(frozen, vid)["reasoning"]


def test_reasoning_is_required(direct_vm, deployed, direct_alice, frozen):
    """Excluded from consensus is not the same as optional."""
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS, reasoning="   "))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("`reasoning` required"):
        deployed.adjudicate(frozen)


def test_requirement_order_does_not_change_the_outcome(
    direct_vm, deployed, direct_alice, frozen
):
    """Results are sorted by id during normalisation, so a panel that
    answers in a different order is still saying the same thing."""
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    results["R5"] = "FAIL"
    reversed_results = dict(reversed(list(results.items())))

    vid = _adjudicate(direct_vm, deployed, direct_alice, frozen, reversed_results)
    v = deployed.get_verdict(frozen, vid)

    assert [r["id"] for r in v["requirements"]] == sorted(ALL_IDS)
    assert v["score"] == 80


# ═══ recorded, but consequence-free ══════════════════════════════════════════
#
# `evidence_quality` and `fraud_flags` were removed from the decision
# fingerprint after live rounds failed on them. The justification is
# below and it is testable: neither field can change a payout by a
# single wei, so demanding that independent validators agree on them
# buys nothing and loses rounds — `evidence_quality` in particular
# summarises RETRIEVAL, which legitimately differs between nodes.

def test_evidence_quality_has_no_effect_on_settlement(
    direct_vm, deployed, direct_alice, frozen
):
    """A LOW-quality record and a HIGH-quality one settle identically
    when the determinations match."""
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    results["R5"] = "FAIL"                        # score 80 either way

    _adjudicate(direct_vm, deployed, direct_alice, frozen, results,
                evidence_quality="LOW")
    for _ in range(4):
        deployed.tick()
    deployed.finalize_verdict(frozen)
    deployed.settle(frozen)

    s = deployed.get_settlement(frozen)
    assert s["policy_applied"] == "PROPORTIONAL"
    assert s["agent_payout"] == PAYMENT * 80 // 100
    assert s["score"] == 80


def test_fraud_flags_have_no_effect_on_settlement(
    direct_vm, deployed, direct_alice, frozen
):
    """Flagging fraud records the concern; it does not redirect money.

    Acting on a flag would need criteria the protocol does not have —
    and a field that cannot move a payout does not need to survive
    consensus.
    """
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    results["R5"] = "FAIL"

    _adjudicate(direct_vm, deployed, direct_alice, frozen, results,
                fraud_flags=["FABRICATED_EVIDENCE",
                             "SOURCE_CONTRADICTS_CLAIM"])
    for _ in range(4):
        deployed.tick()
    deployed.finalize_verdict(frozen)
    deployed.settle(frozen)

    v = deployed.get_verdict(frozen, 1)
    assert v["fraud_flags"] == ["FABRICATED_EVIDENCE",
                                "SOURCE_CONTRADICTS_CLAIM"], "flags are recorded"

    s = deployed.get_settlement(frozen)
    assert s["agent_payout"] == PAYMENT * 80 // 100, "and change nothing"
    assert s["agent_payout"] + s["requester_payout"] == PAYMENT


def test_only_results_drive_the_score(direct_vm, deployed, direct_alice, frozen):
    """The whole justification in one assertion: swap every descriptive
    field, keep the determinations, and the money is identical."""
    results = dict(ALL_PASS)
    results["R3"] = "FAIL"                        # score 80

    _adjudicate(direct_vm, deployed, direct_alice, frozen, results,
                evidence_quality="INSUFFICIENT",
                fraud_flags=["FALSE_INDEPENDENCE_CLAIM"],
                reasoning="A wholly different account of the same facts.")

    v = deployed.get_verdict(frozen, 1)
    assert v["score"] == 80
    assert v["verdict"] == "PARTIAL"
    assert v["critical_failed"] is False
