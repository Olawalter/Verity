"""Shared fixtures for the Verity direct suite.

Direct mode runs the contract inside a real GenVM runner but exercises
the LEADER path only: `mock_llm` answers the leader and every validator
with the same response, so a disagreement cannot be staged here.

What direct mode CAN pin down is every property the fingerprint depends
on — which fields survive normalisation, which are derived by the
contract rather than taken from the model, and which are free-form and
therefore excluded from consensus. Those are in test_equivalence.py.
Agreement between real, independently-run validators is exercised by the
integration suite against a live panel.
"""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "contracts" / "verity.py"

PAYMENT = 100 * (10 ** 18)          # 100 GEN
AGENT_BOND = 5 * (10 ** 18)
DISPUTE_BOND = 2 * (10 ** 18)

# The spec's §9 coding-agent scenario, verbatim.
REQUIREMENTS = [
    {"id": "R1", "description": "Issue is actually resolved",
     "type": "JUDGMENT", "weight": 30, "critical": True,
     "verification_method": "Read the linked PR against the issue",
     "evidence_requirements": "PR URL and issue URL"},
    {"id": "R2", "description": "Regression test added",
     "type": "EVIDENCE", "weight": 25, "critical": False,
     "verification_method": "Inspect the diff for a new test",
     "evidence_requirements": "Diff or test file URL"},
    {"id": "R3", "description": "Existing tests pass",
     "type": "EVIDENCE", "weight": 20, "critical": False,
     "verification_method": "Read the CI run", "evidence_requirements": "CI URL"},
    {"id": "R4", "description": "PR references issue",
     "type": "DETERMINISTIC", "weight": 10, "critical": False,
     "verification_method": "Search the PR body", "evidence_requirements": "PR URL"},
    {"id": "R5", "description": "No unrelated changes",
     "type": "JUDGMENT", "weight": 10, "critical": False,
     "verification_method": "Review the diff scope",
     "evidence_requirements": "Diff URL"},
    {"id": "R6", "description": "Documentation updated",
     "type": "EVIDENCE", "weight": 5, "critical": False,
     "verification_method": "Check the docs diff", "evidence_requirements": "Docs URL"},
]
REQUIREMENTS_JSON = json.dumps(REQUIREMENTS)
ALL_IDS = [r["id"] for r in REQUIREMENTS]


def make_verdict(job_id: str, results: dict, verdict: str | None = None,
                 evidence_quality: str = "HIGH", fraud_flags=None,
                 unverifiable_items=None,
                 reasoning: str = "Panel evaluated each requirement.",
                 **extra) -> str:
    """Build a verdict payload.

    `results` maps requirement id -> PASS/FAIL/UNVERIFIABLE. `verdict` is
    derived when omitted. `extra` lets a test inject hostile fields (e.g.
    agent_payout) to prove they are ignored.
    """
    reqs = [{"id": rid, "result": res, "reason_code": f"{res}_BY_TEST"}
            for rid, res in results.items()]
    vals = list(results.values())
    if verdict is None:
        if "UNVERIFIABLE" in vals:
            verdict = "UNVERIFIABLE"
        elif all(v == "PASS" for v in vals):
            verdict = "VERIFIED"
        elif "PASS" in vals:
            verdict = "PARTIAL"
        else:
            verdict = "FAILED"
    payload = {
        "job_id": job_id,
        "verdict": verdict,
        "requirements": reqs,
        "evidence_quality": evidence_quality,
        "fraud_flags": fraud_flags if fraud_flags is not None else [],
        "unverifiable_items": unverifiable_items if unverifiable_items is not None else [],
        "reasoning": reasoning,
    }
    payload.update(extra)
    return json.dumps(payload)


def mock_panel(direct_vm, verdict_json: str, web_body: str = "<html>ok</html>",
               web_status: int = 200) -> None:
    """Register web + LLM responses. Mocks are first-registered-wins in
    direct mode, so always clear first."""
    direct_vm.clear_mocks()
    direct_vm.mock_web(r".*", {"status": web_status, "body": web_body})
    direct_vm.mock_llm(r".*independent adjudicator on a GenLayer.*", verdict_json)


@pytest.fixture
def contract_path():
    return str(CONTRACT)


@pytest.fixture
def deployed(direct_deploy, contract_path):
    return direct_deploy(contract_path)


@pytest.fixture
def drafted(direct_vm, deployed, direct_alice, direct_bob):
    """DRAFT job: Alice is requester, Bob is the agent."""
    direct_vm.sender = direct_alice
    return deployed.create_job(
        agent=str(direct_bob),
        title="Fix GitHub Issue #143",
        description="Resolve the reported crash and add a regression test.",
        requirements_json=REQUIREMENTS_JSON,
        payment_wei=PAYMENT,
        execution_deadline_ticks=50,
        acceptance_deadline_ticks=20,
        evidence_rules="Prefer CI output and the PR diff over prose.",
        settlement_verified="FULL",
        settlement_partial="PROPORTIONAL",
        settlement_failed="REFUND",
        settlement_unverifiable="HUMAN_REVIEW",
        critical_policy="FAIL_JOB",
        agent_bond_wei=AGENT_BOND,
        dispute_bond_wei=DISPUTE_BOND,
    )


@pytest.fixture
def funded(direct_vm, deployed, direct_alice, drafted):
    direct_vm.sender = direct_alice
    direct_vm.value = PAYMENT
    deployed.fund_job(drafted)
    direct_vm.value = 0
    return drafted


@pytest.fixture
def active(direct_vm, deployed, direct_bob, funded):
    direct_vm.sender = direct_bob
    direct_vm.value = AGENT_BOND
    deployed.accept_job(funded, "sha256:plan")
    direct_vm.value = 0
    return funded


def add_evidence(deployed, job_id, rid="R1", role="DELIVERABLE",
                 url="https://github.com/example/repo/pull/144",
                 independence="INDEPENDENT"):
    return deployed.submit_evidence(
        job_id, rid, url, "sha256:claimed", "text/html",
        "github.com", "github/example", role, independence,
        "Pull request that closes #143.")


@pytest.fixture
def submitted(direct_vm, deployed, direct_bob, active):
    """ACTIVE + evidence for every requirement + deliverable submitted."""
    direct_vm.sender = direct_bob
    for rid in ALL_IDS:
        add_evidence(deployed, active, rid)
    deployed.submit_deliverable(
        active, "https://github.com/example/repo/pull/144", "sha256:deliverable")
    return active


@pytest.fixture
def frozen(direct_vm, deployed, direct_alice, submitted):
    """SUBMITTED → disputed → evidence frozen, ready to adjudicate."""
    direct_vm.sender = direct_alice
    direct_vm.value = DISPUTE_BOND
    deployed.open_dispute(
        submitted, json.dumps(["R1", "R3"]),
        "The crash still reproduces and CI is red.",
        json.dumps([]))
    direct_vm.value = 0
    deployed.freeze_evidence(submitted)
    return submitted
