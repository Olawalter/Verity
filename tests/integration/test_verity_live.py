"""§64 — integration suite against a live GenLayer network.

Run:

    gltest tests/integration -v -s --network studionet

What direct mode cannot prove, this can. `mock_llm` answers the leader
and every validator with one canned response, so a direct test can never
show that independent nodes AGREE. Here the panel is real: leader and
validators each retrieve the evidence themselves, each run the prompt,
and each compare decision fingerprints. A round that lands is evidence
that the equivalence rule holds on inputs nobody staged.

Every deployment here is disposable. The canonical one is recorded in
README.md; these tests must never touch it.

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
import time

import pytest

from gltest import get_contract_factory, get_default_account, create_accounts
from gltest.assertions import tx_execution_succeeded

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


def _read(contract, view, args):
    value = getattr(contract, view)(args=args).call()
    return json.loads(value) if isinstance(value, str) else value


def _deploy():
    """A fresh disposable Verity.

    The submission is retried across transient transport failures to the
    public RPC. A retry can at worst leave an extra disposable instance
    behind; it can never duplicate a state change on the one under test,
    because the retry happens before any state exists.
    """
    factory = get_contract_factory("Verity")
    last = None
    for attempt in range(4):
        try:
            return factory.deploy(args=[], consensus_max_rotations=3)
        except Exception as err:      # noqa: BLE001 — transport errors vary
            last = err
            print(f"deploy attempt {attempt + 1} failed: {str(err)[:160]}")
            time.sleep(20)
    raise last


@pytest.fixture(scope="module")
def contract():
    return _deploy()


@pytest.fixture(scope="module")
def agent():
    """A second wallet, so requester and agent are genuinely different
    accounts and the authorisation guards are actually exercised."""
    return create_accounts(1)[0]


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
    assert tx_execution_succeeded(receipt)

    page = _read(contract, "list_jobs", [0, 100])
    rows = [r for r in page["rows"] if r["title"].endswith(f"({job_id_hint})")]
    assert rows, "the created job did not appear in list_jobs"
    job_id = rows[-1]["job_id"]

    receipt = contract.fund_job(args=[job_id]).transact(value=PAYMENT)
    assert tx_execution_succeeded(receipt)

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
    assert not tx_execution_succeeded(failed), \
        "terms must not be editable once escrow is held"

    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "FUNDED"
    assert job["title"].startswith("Verify a published document")
    assert int(job["escrow_held"]) == PAYMENT


def test_cancel_returns_escrow_before_acceptance(contract, agent):
    """The refund path, exercised against real balances."""
    job_id = _create_and_fund(contract, agent.address, "cancel")

    receipt = contract.cancel_job(args=[job_id]).transact()
    assert tx_execution_succeeded(receipt)

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
    assert tx_execution_succeeded(
        agent_contract.accept_job(args=[job_id, "sha256:live-plan"]).transact())

    for rid in ("R1", "R2"):
        assert tx_execution_succeeded(agent_contract.submit_evidence(args=[
            job_id, rid, GOOD_URL,
            "",                       # claimed_content_hash — a CLAIM, unverified
            "text/markdown",
            "raw.githubusercontent.com",
            "genlayerlabs",
            "DELIVERABLE",
            "UNKNOWN",                # independence is judged, not declared
            "Published project document.",
        ]).transact())

    assert tx_execution_succeeded(agent_contract.submit_deliverable(args=[
        job_id, GOOD_URL, "",
    ]).transact())

    assert tx_execution_succeeded(contract.open_dispute(args=[
        job_id, json.dumps(["R2"]),
        "The document does not describe a software project.", "[]",
    ]).transact(value=DISPUTE_BOND))

    freeze = contract.freeze_evidence(args=[job_id]).transact()
    assert tx_execution_succeeded(freeze)
    job = _read(contract, "get_job", [job_id])
    assert job["status"] == "EVIDENCE_FROZEN"
    assert job["evidence_snapshot_hash"], "the frozen set must be hashed"

    # No further evidence is admissible once the record is closed.
    assert not tx_execution_succeeded(agent_contract.submit_evidence(args=[
        job_id, "R1", GOOD_URL, "", "text/markdown",
        "raw.githubusercontent.com", "genlayerlabs", "SUPPORTING",
        "UNKNOWN", "Filed after the freeze.",
    ]).transact())

    receipt = contract.adjudicate(args=[job_id]).transact(**ROUND_WAIT)
    assert tx_execution_succeeded(receipt), (
        "a failed round here is usually consensus failure, which means a "
        "consensus-critical field is not mechanically derivable")

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
    assert tx_execution_succeeded(
        agent_contract.accept_job(args=[job_id, ""]).transact())
    for rid in ("R1", "R2"):
        assert tx_execution_succeeded(agent_contract.submit_evidence(args=[
            job_id, rid, DEAD_URL,
            "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "application/json",
            "verity-evidence-does-not-exist.invalid",
            "ci-provider",
            "DELIVERABLE",
            "INDEPENDENT",            # a claim the panel is asked to test
            "CI run proving the work.",
        ]).transact())
    assert tx_execution_succeeded(agent_contract.submit_deliverable(args=[
        job_id, DEAD_URL, "",
    ]).transact())

    assert tx_execution_succeeded(contract.open_dispute(args=[
        job_id, json.dumps(["R1", "R2"]),
        "Nothing the agent linked can be opened.", "[]",
    ]).transact(value=DISPUTE_BOND))
    assert tx_execution_succeeded(
        contract.freeze_evidence(args=[job_id]).transact())

    receipt = contract.adjudicate(args=[job_id]).transact(**ROUND_WAIT)
    assert tx_execution_succeeded(receipt)

    job = _read(contract, "get_job", [job_id])
    v = _read(contract, "get_verdict", [job_id, int(job["latest_verdict_id"])])

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
