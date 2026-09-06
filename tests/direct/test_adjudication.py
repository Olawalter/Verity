"""§61 disputes + §63 LLM failure handling + §35 verdict validation."""
import json

from .conftest import (PAYMENT, DISPUTE_BOND, ALL_IDS,
                       make_verdict, mock_panel)


ALL_PASS = {r: "PASS" for r in ALL_IDS}


# ── disputes (§29, §30) ─────────────────────────────────────────────────────

def test_dispute_must_name_requirements(direct_vm, deployed, direct_alice, submitted):
    """'I don't like the work' is not a dispute."""
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    with direct_vm.expect_revert("name at least one disputed requirement"):
        deployed.open_dispute(submitted, "[]", "it's bad", "[]")
    direct_vm.value = 0


def test_dispute_rejects_unknown_requirement(direct_vm, deployed, direct_alice, submitted):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    with direct_vm.expect_revert("unknown disputed requirement id"):
        deployed.open_dispute(submitted, json.dumps(["R99"]), "claim", "[]")
    direct_vm.value = 0


def test_dispute_requires_claim(direct_vm, deployed, direct_alice, submitted):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    with direct_vm.expect_revert("dispute claim required"):
        deployed.open_dispute(submitted, json.dumps(["R1"]), "", "[]")
    direct_vm.value = 0


def test_only_requester_may_dispute(direct_vm, deployed, direct_bob, submitted):
    direct_vm.sender = direct_bob
    direct_vm.value = DISPUTE_BOND
    with direct_vm.expect_revert("requester only"):
        deployed.open_dispute(submitted, json.dumps(["R1"]), "claim", "[]")
    direct_vm.value = 0


def test_dispute_recorded_with_named_requirements(
    direct_vm, deployed, direct_alice, submitted
):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    deployed.open_dispute(submitted, json.dumps(["R3", "R1"]),
                          "crash reproduces; CI red", "[]")
    direct_vm.value = 0
    d = deployed.get_dispute(submitted)
    assert d["disputed_requirements"] == ["R1", "R3"]      # sorted
    assert d["bond_wei"] == DISPUTE_BOND
    assert deployed.get_job(submitted)["status"] == "DISPUTED"


def test_agent_response_recorded(direct_vm, deployed, direct_alice, direct_bob, submitted):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    deployed.open_dispute(submitted, json.dumps(["R1"]), "claim", "[]")
    direct_vm.value = 0
    direct_vm.sender = direct_bob
    deployed.respond_to_dispute(submitted, "The crash is fixed in commit abc.", "[]")
    d = deployed.get_dispute(submitted)
    assert "commit abc" in d["agent_response"]
    assert d["agent_responded_tick"] > 0


def test_only_agent_may_respond(direct_vm, deployed, direct_alice, submitted):
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    deployed.open_dispute(submitted, json.dumps(["R1"]), "claim", "[]")
    direct_vm.value = 0
    with direct_vm.expect_revert("agent only"):
        deployed.respond_to_dispute(submitted, "self-serving", "[]")


# ── verdict production ──────────────────────────────────────────────────────

def test_verified_verdict_scores_100(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS))
    direct_vm.sender = direct_alice
    vid = deployed.adjudicate(frozen)
    v = deployed.get_verdict(frozen, vid)
    assert v["verdict"] == "VERIFIED"
    assert v["score"] == 100
    assert v["critical_failed"] is False
    assert deployed.get_job(frozen)["status"] == "VERDICT"


def test_partial_verdict_scores_the_weighted_subset(
    direct_vm, deployed, direct_alice, frozen
):
    """The spec's §21 worked example: R4 and R5 fail → score 80."""
    results = dict(ALL_PASS)
    results["R4"] = "FAIL"
    results["R5"] = "FAIL"
    mock_panel(direct_vm, make_verdict(frozen, results))
    direct_vm.sender = direct_alice
    vid = deployed.adjudicate(frozen)
    v = deployed.get_verdict(frozen, vid)
    assert v["verdict"] == "PARTIAL"
    assert v["score"] == 80          # 30+25+20+5
    assert v["critical_failed"] is False


def test_critical_failure_flagged_by_contract(direct_vm, deployed, direct_alice, frozen):
    results = dict(ALL_PASS)
    results["R1"] = "FAIL"           # R1 is critical
    mock_panel(direct_vm, make_verdict(frozen, results))
    direct_vm.sender = direct_alice
    vid = deployed.adjudicate(frozen)
    v = deployed.get_verdict(frozen, vid)
    assert v["critical_failed"] is True
    assert v["score"] == 70          # everything except R1


def test_unverifiable_verdict(direct_vm, deployed, direct_alice, frozen):
    results = dict(ALL_PASS)
    results["R3"] = "UNVERIFIABLE"
    mock_panel(direct_vm, make_verdict(
        frozen, results, unverifiable_items=["CI endpoint unreachable"]))
    direct_vm.sender = direct_alice
    vid = deployed.adjudicate(frozen)
    v = deployed.get_verdict(frozen, vid)
    assert v["verdict"] == "UNVERIFIABLE"
    assert v["score"] == 80          # UNVERIFIABLE earns nothing, unlike PASS
    assert deployed.get_job(frozen)["escrow_held"] > 0


def test_verdict_records_constitution_hash(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS))
    direct_vm.sender = direct_alice
    vid = deployed.adjudicate(frozen)
    assert (deployed.get_verdict(frozen, vid)["constitution_hash"]
            == deployed.get_job(frozen)["constitution_hash"])


# ── §63 LLM failure handling ────────────────────────────────────────────────

def test_wrong_job_id_rejected(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, make_verdict("VJ-999999", ALL_PASS))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("job_id mismatch"):
        deployed.adjudicate(frozen)
    # state rolled back, not stuck in ADJUDICATING
    assert deployed.get_job(frozen)["status"] == "EVIDENCE_FROZEN"


def test_unknown_requirement_id_rejected(direct_vm, deployed, direct_alice, frozen):
    results = dict(ALL_PASS)
    results["R99"] = "PASS"
    mock_panel(direct_vm, make_verdict(frozen, results))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("unknown requirement id"):
        deployed.adjudicate(frozen)


def test_missing_requirement_rejected(direct_vm, deployed, direct_alice, frozen):
    partial = {k: v for k, v in ALL_PASS.items() if k != "R6"}
    mock_panel(direct_vm, make_verdict(frozen, partial))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("omits requirement"):
        deployed.adjudicate(frozen)


def test_duplicate_requirement_rejected(direct_vm, deployed, direct_alice, frozen):
    raw = json.loads(make_verdict(frozen, ALL_PASS))
    raw["requirements"].append({"id": "R1", "result": "FAIL", "reason_code": "X"})
    mock_panel(direct_vm, json.dumps(raw))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("duplicate requirement id"):
        deployed.adjudicate(frozen)


def test_invalid_verdict_value_rejected(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS, verdict="PROBABLY_FINE"))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid verdict"):
        deployed.adjudicate(frozen)


def test_invalid_result_value_rejected(direct_vm, deployed, direct_alice, frozen):
    raw = json.loads(make_verdict(frozen, ALL_PASS))
    raw["requirements"][0]["result"] = "MAYBE"
    mock_panel(direct_vm, json.dumps(raw))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid result"):
        deployed.adjudicate(frozen)


def test_missing_reason_code_rejected(direct_vm, deployed, direct_alice, frozen):
    raw = json.loads(make_verdict(frozen, ALL_PASS))
    raw["requirements"][0]["reason_code"] = ""
    mock_panel(direct_vm, json.dumps(raw))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("reason_code required"):
        deployed.adjudicate(frozen)


def test_invalid_evidence_quality_rejected(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS, evidence_quality="VIBES"))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("invalid evidence_quality"):
        deployed.adjudicate(frozen)


def test_missing_reasoning_rejected(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS, reasoning=""))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("`reasoning` required"):
        deployed.adjudicate(frozen)


def test_incoherent_verified_with_fail_rejected(direct_vm, deployed, direct_alice, frozen):
    results = dict(ALL_PASS)
    results["R2"] = "FAIL"
    mock_panel(direct_vm, make_verdict(frozen, results, verdict="VERIFIED"))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("VERIFIED cannot carry a FAIL"):
        deployed.adjudicate(frozen)


def test_incoherent_unverifiable_without_unverifiable_rejected(
    direct_vm, deployed, direct_alice, frozen
):
    mock_panel(direct_vm, make_verdict(frozen, ALL_PASS, verdict="UNVERIFIABLE"))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("UNVERIFIABLE verdict needs at least one"):
        deployed.adjudicate(frozen)


def test_non_object_verdict_rejected(direct_vm, deployed, direct_alice, frozen):
    mock_panel(direct_vm, json.dumps(["not", "an", "object"]))
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[LLM_ERROR]"):
        deployed.adjudicate(frozen)


def test_adjudicate_illegal_before_freeze(direct_vm, deployed, direct_alice, submitted):
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("illegal transition from SUBMITTED"):
        deployed.adjudicate(submitted)
