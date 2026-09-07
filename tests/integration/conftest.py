"""Deployment helpers for the live suite.

`ContractFactory.deploy()` cannot bind this contract on a hosted network,
for two reasons that are both in the tooling rather than in the contract:

  1. It derives the ABI with `get_contract_schema_for_code`, which
     `genlayer_py` refuses outright on any chain that is not localnet
     ("Contract schema is not supported on this network").
  2. That same call hexes the source with `eth_utils.encode_hex`, which
     encodes ASCII only. `contracts/verity.py` carries `§`, `—` and box
     drawing in its comments, so the call raises UnicodeEncodeError
     before it ever reaches the network — on localnet too.

Neither is a reason to strip characters out of the source. The schema
the tests actually want is the one the CHAIN reports for the deployed
address, which `gen_getContractSchema` returns happily, so that is what
is used here. Binding to the deployed contract's own schema is also the
more honest thing to test against: it describes what is on chain rather
than what the local file would compile to.
"""
import importlib
import json
import pathlib
import time
import urllib.error
import urllib.request

import pytest

from gltest import get_contract_factory, get_default_account
from gltest.assertions import tx_execution_succeeded
from gltest.contracts.contract import Contract
from gltest_cli.config.general import get_general_config

# The simulator endpoint refuses requests without a browser-shaped agent.
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

CONTRACT = pathlib.Path(__file__).resolve().parents[2] / "contracts" / "verity.py"


def rpc_url() -> str:
    config = get_general_config()
    return config.get_rpc_url()


def rpc(method: str, params: list, timeout: int = 120) -> dict:
    body = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(
        rpc_url(), data=body,
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def fetch_schema(address: str, attempts: int = 12, delay: int = 10) -> dict:
    """Poll until the chain reports a schema for the address.

    A freshly accepted deploy is not instantly queryable on a hosted
    network, so this waits for the thing that is genuinely not ready
    rather than treating the first miss as a failure.
    """
    last = None
    for attempt in range(attempts):
        try:
            out = rpc("gen_getContractSchema", [address])
            schema = out.get("result")
            if isinstance(schema, dict) and schema.get("methods"):
                return schema
            last = json.dumps(out)[:200]
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            last = f"{type(err).__name__}: {err}"
        print(f"  schema not ready ({attempt + 1}/{attempts}): {last}")
        time.sleep(delay)
    raise AssertionError(f"no schema for {address} after {attempts} attempts: {last}")


def deploy_verity() -> Contract:
    """A fresh disposable Verity, bound to its on-chain schema.

    The deploy submission is retried across transient transport failures
    to the public RPC. A retry can at worst leave an extra disposable
    instance behind; it can never duplicate a state change on the one
    under test, because the retry happens before any state exists.
    """
    factory = get_contract_factory("Verity")

    address = None
    last = None
    for attempt in range(4):
        try:
            receipt = factory.deploy_contract_tx(args=[], consensus_max_rotations=3)
            assert tx_execution_succeeded(receipt), "deploy transaction reverted"
            data = receipt.get("data") or {}
            address = data.get("contract_address") or receipt.get("contract_address")
            assert address, f"no contract address in receipt: {str(receipt)[:200]}"
            print(f"\ndeployed disposable Verity at {address}")
            break
        except Exception as err:      # noqa: BLE001 — transport errors vary
            last = err
            print(f"deploy attempt {attempt + 1} failed: {str(err)[:200]}")
            time.sleep(20)
    if address is None:
        raise last

    schema = fetch_schema(address)
    return Contract.new(
        address=address, schema=schema, account=get_default_account())


# ── transport resilience ────────────────────────────────────────────────
#
# The public simulator RPC drops connections mid-flight: TLS record
# errors (SSLV3_ALERT_BAD_RECORD_MAC), resets, the occasional gateway
# 5xx. Left alone these surface as protocol failures they are not — a
# dropped socket while polling `eth_getTransactionByHash` is not a
# contract bug, and worse, aborting there STRANDS a transaction that was
# already submitted and is still being processed.
#
# The retry sits at the transport boundary so it covers reads, receipt
# polling and submission alike. Re-broadcasting is safe: the raw
# transaction is already signed, so its nonce and hash are fixed, and a
# node that saw the first copy answers the second with the same hash
# instead of executing anything twice.
#
# Only TRANSPORT failures retry. An RPC that answers with a JSON-RPC
# error — a revert, a bad parameter — is a real answer and is raised
# immediately, because retrying it would only hide it.
TRANSIENT = (
    # socket-level
    "SSL", "Max retries exceeded", "Connection aborted", "Connection reset",
    "Read timed out", "Remote end closed", "RemoteDisconnected",
    "Temporary failure", "timed out",
    # The endpoint sits behind a CDN that answers overload with an HTML
    # error page. A JSON-RPC endpoint returning something that is not
    # JSON is always infrastructure, never a contract answer — and the
    # transaction being polled is usually already submitted, so aborting
    # here strands it.
    "returned invalid JSON", "<!DOCTYPE html>", "Bad gateway",
    "502", "503", "504",
)

_ATTEMPTS = 6


def _install_transport_retry() -> None:
    provider = importlib.import_module("genlayer_py.provider.provider")
    if getattr(provider.GenLayerProvider, "_verity_retry_installed", False):
        return

    original = provider.GenLayerProvider.make_request

    def make_request(self, method, params):
        last = None
        for attempt in range(_ATTEMPTS):
            try:
                return original(self, method, params)
            except Exception as err:      # noqa: BLE001 — provider wraps everything
                text = str(err)
                if not any(marker in text for marker in TRANSIENT):
                    raise
                last = err
                wait = 3 * (attempt + 1)
                print(f"  transient RPC on {method} "
                      f"({attempt + 1}/{_ATTEMPTS}), retrying in {wait}s")
                time.sleep(wait)
        raise last

    provider.GenLayerProvider.make_request = make_request
    provider.GenLayerProvider._verity_retry_installed = True


_install_transport_retry()


def revert_reason(receipt) -> str:
    """Pull the failure out of a receipt instead of asserting `False`.

    A bare `assert tx_execution_succeeded(...)` tells you a write failed
    and nothing about why, which turns every rule the contract enforces
    into a guessing game. The contract already answers the question — it
    raises UserError with a class prefix and a specific message — so this
    digs that message out and puts it in the assertion.
    """
    try:
        leader = receipt["consensus_data"]["leader_receipt"][0]
    except (KeyError, IndexError, TypeError):
        return f"no leader receipt: {str(receipt)[:200]}"

    result = leader.get("execution_result", "UNKNOWN")
    parts = [f"execution_result={result}"]

    genvm = leader.get("genvm_result") or {}
    for stream in ("stderr", "stdout"):
        text = (genvm.get(stream) or "").strip()
        if text:
            parts.append(f"{stream}: {text[-400:]}")

    # The contract's own message lives in the rollback payload. Pulling
    # it out by name means a test can assert on the RULE that refused a
    # call, not merely on the fact that something refused it.
    outcome = leader.get("result")
    if isinstance(outcome, dict):
        payload = outcome.get("payload")
        if payload:
            parts.append(f"{outcome.get('status', 'result')}: {str(payload)[:400]}")
    elif outcome:
        parts.append(f"result: {str(outcome)[:300]}")

    error = leader.get("error")
    if error:
        parts.append(f"error: {str(error)[:300]}")

    # Hosted StudioNet often returns the failure with no message attached
    # — execution_result=ERROR and nothing else. Say which keys were
    # present rather than pretending the detail exists, so a reader knows
    # the message is missing rather than assuming the test looked wrong.
    if len(parts) == 1:
        parts.append(f"(no message on receipt; leader keys: {sorted(leader)})")
    return " | ".join(parts)


def consensus_summary(receipt) -> str:
    """Whatever the receipt says about how the panel voted."""
    data = receipt.get("consensus_data") or {}
    votes = data.get("validator_votes_name") or data.get("validator_votes")
    status = receipt.get("status_name") or receipt.get("status")
    bits = []
    if status:
        bits.append(f"status={status}")
    if votes:
        bits.append(f"votes={votes}")
    return ", ".join(bits) or "no consensus data on receipt"


def must_succeed(receipt, what: str):
    """Assert a write landed, and say why it did not when it failed.

    Note the limit of this check for a NONDET round: `tx_execution_succeeded`
    inspects the LEADER's receipt only. A round where the leader executed
    fine but the validators did not agree still reports SUCCESS here
    while committing no state at all — which surfaces later as
    "accepted but stored no verdict". Tests that run a round must
    therefore assert the resulting STATE, not just this.
    """
    assert tx_execution_succeeded(receipt), f"{what} failed — {revert_reason(receipt)}"
    return receipt


def must_fail(receipt, what: str):
    """Assert a write was refused, and show what actually happened if not."""
    assert not tx_execution_succeeded(receipt), (
        f"{what} was expected to be refused but succeeded")
    return revert_reason(receipt)


def balance_of(address: str) -> int:
    """Real GEN held by an address, straight from the chain."""
    out = rpc("eth_getBalance", [str(address), "latest"])
    return int(out["result"], 16)


def read(contract, view: str, args: list):
    """Call a view and decode its result.

    Transport retries are handled underneath by the patched provider, so
    this stays a plain call.
    """
    value = getattr(contract, view)(args=args).call()
    return json.loads(value) if isinstance(value, str) else value


@pytest.fixture(scope="module")
def contract():
    return deploy_verity()
