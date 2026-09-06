"""§64 — integration suite against a live GenLayer network.

Run:

    gltest tests/integration -v -s --network studionet

What direct mode cannot prove, this can. `mock_llm` answers the leader
and every validator with one canned response, so a direct test can never
show that independent nodes AGREE. Here the panel is real: leader and
validators each retrieve the evidence themselves, each run the prompt,
and each compare decision fingerprints. A round that lands is evidence
that the equivalence rule holds on inputs nobody staged.

Every deployment here is disposable — `conftest.py` deploys a fresh one
per module and binds it to the schema the chain reports. The canonical
deployment is recorded in README.md; these tests must never touch it.

Environment differences are real and are handled rather than assumed:
localnet has no fee simulation, StudioNet does; a public RPC drops
connections; and a live panel takes minutes, not milliseconds. Nothing
below assumes a feature the selected network may not have.

Assertions stay on decision-critical fields — states, scores, payouts,
hashes, vocabularies. Never on model prose: two honest panels write the
same determination in different words, and a test that asserts on
wording fails for a reason unrelated to correctness.
"""
import json
import os

import pytest

from gltest import get_accounts, get_default_account
from .conftest import must_fail, must_succeed, read as _read

GEN = 10 ** 18
PAYMENT = 2 * GEN           # small: these are real balances on a shared net
AGENT_BOND = 0              # bonds add two more funded wallets per test
DISPUTE_BOND = 0

# A live round is a real panel: retrieval, a model call per node, then
# consensus. Minutes, not seconds.
ROUND_WAIT = {"wait_interval": 5000, "wait_retries": 180}

# Evidence that genuinely resolves. Commit-pinned raw GitHub content is
# used rather than a landing page because validators must all retrieve
# the SAME bytes — a URL whose content moves between fetches is a
# consensus hazard, not a test.
GOOD_URL = (
    "https://raw.githubusercontent.com/genlayerlabs/genlayer-project-boilerplate/"
    "main/README.md"
)
# Deliberately unresolvable: proves unavailable != verified.
DEAD_URL = "https://verity-evidence-does-not-exist.invalid/ci-run-9931.json"

# A claimed hash is required on every receipt — a receipt that claims
# nothing about its source is not a receipt. The contract never compares
# it against retrieved bytes, and these tests never assert that it
# matches: what establishes anything is the panel's own retrieval. The
# value below is exactly what the field is named for, a CLAIM.
CLAIMED_HASH = "sha256:" + "5f" * 32

REQUIREMENTS = [
    {"id": "R1", "description": "The linked document exists and is readable",
     "type": "EVIDENCE", "weight": 60, "critical": True,
     "verification_method": "Retrieve the URL and confirm it returns content",
     "evidence_requirements": "A reachable document URL"},
    {"id": "R2", "description": "The linked document describes a software project",
     "type": "JUDGMENT", "weight": 40, "critical": False,
     "verification_method": "Read the retrieved content",
     "evidence_requirements": "The same document"},
]
REQUIREMENTS_JSON = json.dumps(REQUIREMENTS)


@pytest.fixture(scope="module")
def agent():
    """The second CONFIGURED wallet.

    A freshly generated account would be a different address but an
    unfunded one, and every agent-side call here — accept, submit
    evidence, submit the deliverable — is a transaction that has to pay
    for itself. The second configured key is a real, funded wallet, so
    requester and agent are genuinely distinct and the authorisation
    guards are actually exercised rather than skipped.
    """
    accounts = get_accounts()
    if len(accounts) < 2:
        pytest.skip(
            "the live suite needs two configured accounts — see "
            ".env.example and DEVELOPMENT.md")
    return accounts[1]


def _create_and_fund(contract, agent_addr, job_id_hint="live"):
    requester = get_default_account()
    receipt = contract.create_job(args=[
        str(agent_addr),                       # agent
        f"Verify a published document ({job_id_hint})",
        "Confirm the linked document is retrievable and describes a "
        "software project.",
        REQUIREMENTS_JSON,
        PAYMENT,
        200,                                   # execution deadline ticks
        80,                                    # acceptance deadline ticks
        "Prefer retrieved content over assertions.",
        "FULL", "PROPORTIONAL", "REFUND", "HUMAN_REVIEW", "FAIL_JOB",
        AGENT_BOND, DISPUTE_BOND,
    ]).transact()
    must_succeed(receipt, "create_job")

    page = _read(contract, "list_jobs", [0, 100])
    rows = [r for r in page["rows"] if r["title"].endswith(f"({job_id_hint})")]
    assert rows, "the created job did not appear in list_jobs"
    job_id = rows[-1]["job_id"]

    receipt = contract.fund_job(args=[job_id]).transact(value=PAYMENT)
    must_succeed(receipt, "fund_job")

    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "FUNDED"
    assert int(job["payment_deposited"]) == PAYMENT, \
        "custody must record what the chain moved, not what was agreed"
    assert job["constitution_hash"], "terms are hashed at funding"
    assert str(requester.address).lower() == job["requester"].lower()
    return job_id


# ═══ 1 · the protocol answers, and its vocabulary is closed ══════════════════

def test_protocol_surface_is_live_and_closed(contract):
    info = _read(contract, "get_protocol_info", [])

    assert info["weight_total"] == 100
    assert info["max_appeals"] == 1
    assert sorted(info["requirement_results"]) == ["FAIL", "PASS", "UNVERIFIABLE"]
    assert sorted(info["verdicts"]) == [
        "FAILED", "PARTIAL", "UNVERIFIABLE", "VERIFIED"]
    assert sorted(info["settlement_policies"]) == [
        "FULL", "HUMAN_REVIEW", "PROPORTIONAL", "REFUND"]

    # The consensus-critical vocabularies must be closed sets, because a
    # free-form value in either one splits validators on wording.
    assert "FABRICATED_EVIDENCE" in info["fraud_flags"]
    assert len(info["fraud_flags"]) == len(set(info["fraud_flags"]))
    assert sorted(info["evidence_quality_grades"]) == [
        "HIGH", "INSUFFICIENT", "LOW", "MEDIUM"]
    assert sorted(info["retrieval_labels"]) == [
        "EMPTY_CONTENT", "FETCH_FAILURE", "FETCH_SUCCESS", "NON_SUCCESS_RESPONSE"]


# ═══ 2 · escrow custody on a real chain ══════════════════════════════════════

def test_funding_locks_terms_and_records_real_custody(contract, agent):
    job_id = _create_and_fund(contract, agent.address, "custody")

    # Terms are frozen: the draft editor is closed once money is held.
    failed = contract.update_draft(args=[
        job_id, "Rewritten after funding", "New description",
        REQUIREMENTS_JSON, "New evidence rules",
    ]).transact()
    reason = must_fail(failed, "update_draft after funding")
    # Assert on the RULE that refused it, not merely that something did.
    # A test satisfied by any failure passes when the call fails for an
    # unrelated reason — a bad argument, an out-of-gas — and quietly
    # stops testing immutability at all.
    assert "illegal transition from FUNDED" in reason, \
        f"refused, but for an unexpected reason: {reason}"

    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "FUNDED"
    assert job["title"].startswith("Verify a published document")
    assert int(job["escrow_held"]) == PAYMENT


def test_cancel_returns_escrow_before_acceptance(contract, agent):
    """The refund path, exercised against real balances."""
    job_id = _create_and_fund(contract, agent.address, "cancel")

    receipt = contract.cancel_job(args=[job_id]).transact()
    must_succeed(receipt, "cancel_job")

    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "CANCELLED"
    assert int(job["escrow_held"]) == 0
    assert int(job["total_released"]) == PAYMENT


# ═══ 3 · a real adjudication round ═══════════════════════════════════════════

@pytest.mark.skipif(
    os.environ.get("VERITY_SKIP_PANEL", "0") == "1",
    reason="set VERITY_SKIP_PANEL=1 to skip the slow live-panel rounds",
)
def test_live_panel_reaches_consensus_on_retrievable_evidence(contract, agent):
    """The load-bearing test: an unstaged round, judged by a real panel.

    Leader and validators each retrieve GOOD_URL, each run the prompt,
    and each compare fingerprints. Success here means independent nodes
    agreed on the determinations — not that one node produced
    well-formed JSON.
    """
    job_id = _create_and_fund(contract, agent.address, "panel")

    agent_contract = contract.connect(agent)
    must_succeed(
        agent_contract.accept_job(args=[job_id, "sha256:live-plan"]).transact(),
        "accept_job")

    for rid in ("R1", "R2"):
        must_succeed(agent_contract.submit_evidence(args=[
            job_id, rid, GOOD_URL,
            CLAIMED_HASH,             # a CLAIM; the contract verifies nothing
            "text/markdown",
            "raw.githubusercontent.com",
            "genlayerlabs",
            "DELIVERABLE",
            "UNKNOWN",                # independence is judged, not declared
            "Published project document.",
        ]).transact(), f"submit_evidence({rid})")

    must_succeed(agent_contract.submit_deliverable(args=[
        job_id, GOOD_URL, CLAIMED_HASH,   # uri and hash are both required
    ]).transact(), "submit_deliverable")

    must_succeed(contract.open_dispute(args=[
        job_id, json.dumps(["R2"]),
        "The document does not describe a software project.", "[]",
    ]).transact(value=DISPUTE_BOND), "open_dispute")

    freeze = contract.freeze_evidence(args=[job_id]).transact()
    must_succeed(freeze, "freeze_evidence")
    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "EVIDENCE_FROZEN"
    assert job["evidence_snapshot_hash"], "the frozen set must be hashed"

    # No further evidence is admissible once the record is closed.
    reason = must_fail(agent_contract.submit_evidence(args=[
        job_id, "R1", GOOD_URL, CLAIMED_HASH, "text/markdown",
        "raw.githubusercontent.com", "genlayerlabs", "SUPPORTING",
        "UNKNOWN", "Filed after the freeze.",
    ]).transact(), "submit_evidence after freeze")
    assert "EVIDENCE_FROZEN" in reason or "frozen" in reason, \
        f"refused, but for an unexpected reason: {reason}"

    receipt = contract.adjudicate(args=[job_id]).transact(**ROUND_WAIT)
    must_succeed(receipt, (
        "adjudicate — a failure here is usually consensus failure, which "
        "means a consensus-critical field is not mechanically derivable"))

    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "VERDICT"

    v = _read(contract, "get_verdict", [job_id, int(job["latest_verdict_id"])])
    assert v["verdict"] in ("VERIFIED", "PARTIAL", "FAILED", "UNVERIFIABLE")
    assert {r["id"] for r in v["requirements"]} == {"R1", "R2"}
    assert 0 <= int(v["score"]) <= 100
    assert v["evidence_quality"] in ("HIGH", "MEDIUM", "LOW", "INSUFFICIENT")

    # The score is the contract's arithmetic over frozen weights, not
    # anything the panel said.
    expected = sum(
        r["weight"] for r in REQUIREMENTS
        if any(x["id"] == r["id"] and x["result"] == "PASS"
               for x in v["requirements"])
    )
    assert int(v["score"]) == expected

    # Whatever the panel returned, no money field survived into the record.
    for entry in v["requirements"]:
        assert set(entry) == {"id", "result", "reason_code"}

    assert v["constitution_hash"] == job["constitution_hash"]
    assert int(job["escrow_held"]) == PAYMENT, "a verdict is not a payout"


@pytest.mark.skipif(
    os.environ.get("VERITY_SKIP_PANEL", "0") == "1",
    reason="set VERITY_SKIP_PANEL=1 to skip the slow live-panel rounds",
)
def test_unreachable_evidence_does_not_pass(contract, agent):
    """unavailable evidence != verified evidence, proven against a real
    fetch failure rather than a mocked one."""
    job_id = _create_and_fund(contract, agent.address, "dead")

    agent_contract = contract.connect(agent)
    must_succeed(agent_contract.accept_job(args=[job_id, ""]).transact(),
                 "accept_job")
    for rid in ("R1", "R2"):
        must_succeed(agent_contract.submit_evidence(args=[
            job_id, rid, DEAD_URL,
            CLAIMED_HASH,             # confidently asserted, never checkable
            "application/json",
            "verity-evidence-does-not-exist.invalid",
            "ci-provider",
            "DELIVERABLE",
            "INDEPENDENT",            # a claim the panel is asked to test
            "CI run proving the work.",
        ]).transact(), f"submit_evidence({rid})")
    must_succeed(agent_contract.submit_deliverable(args=[
        job_id, DEAD_URL, CLAIMED_HASH,
    ]).transact(), "submit_deliverable")

    must_succeed(contract.open_dispute(args=[
        job_id, json.dumps(["R1", "R2"]),
        "Nothing the agent linked can be opened.", "[]",
    ]).transact(value=DISPUTE_BOND), "open_dispute")
    must_succeed(contract.freeze_evidence(args=[job_id]).transact(),
                 "freeze_evidence")

    receipt = contract.adjudicate(args=[job_id]).transact(**ROUND_WAIT)
    must_succeed(receipt, "adjudicate")

    job = _read(contract, "get_job", [job_id])
    verdict_id = int(job["latest_verdict_id"])
    assert verdict_id > 0, (
        f"adjudicate was accepted but stored no verdict — job status "
        f"{job['status']}, tick {job['current_tick']}")
    v = _read(contract, "get_verdict", [job_id, verdict_id])

    # The requirement that depended on the dead link must not PASS. It may
    # be UNVERIFIABLE or FAIL — both are honest readings of a source that
    # could not be read — but PASS would mean the panel accepted an
    # assertion it never checked.
    r1 = next(r for r in v["requirements"] if r["id"] == "R1")
    assert r1["result"] in ("UNVERIFIABLE", "FAIL"), \
        f"unreachable evidence must never PASS, got {r1['result']}"
    assert v["evidence_quality"] in ("INSUFFICIENT", "LOW")

    if v["verdict"] == "UNVERIFIABLE":
        assert v["unverifiable_items"], \
            "an UNVERIFIABLE verdict names which requirements were unresolved"
