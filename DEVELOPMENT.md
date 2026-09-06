# Development

Setting up, testing, deploying and debugging Verity.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Python | 3.12 | the direct-test harness targets it |
| Node | 20+ | Next.js 16 |
| GenLayer CLI | current | `npm i -g genlayer` |

```bash
pip install -r requirements.txt
cd app && npm install
```

Versions in `requirements.txt` are pinned to what this repository was
built and tested against. The direct-mode API has changed shape between
releases; if you unpin, expect to fix fixtures.

**One environment note that will cost you an afternoon.** If a package
named `genvm-sdk-python` is installed, every direct test fails at import
with `name 'allow_storage' is not defined`. It ships a `genlayer`
package that shadows the GenVM runner's own SDK, and because the test
harness imports `genlayer` eagerly, `sys.modules` is bound before the
runner SDK can be put on the path. The contract is fine; the import is
not. Uninstall it.

## 2. Everyday loop

```bash
# after every contract change, in this order
genvm-lint check contracts/verity.py
pytest tests/direct/ -q
```

Both must pass before anything else. The linter catches what a test
cannot — chiefly that every `gl.nondet.*` call sits somewhere the
equivalence machinery can actually reach.

On Windows, run with UTF-8 mode. The linter reads the contract with the
system default codec, and this file contains box-drawing characters:

```bash
PYTHONUTF8=1 genvm-lint check contracts/verity.py
```

Frontend:

```bash
cd app
npm run typecheck
npm run dev          # http://localhost:3120
```

## 3. Testing

### Direct suite — 101 tests, no network

```bash
pytest tests/direct/ -q            # ~30s
pytest tests/direct/test_settlement.py -v
```

| File | Covers |
|---|---|
| `test_job.py` | agreements, requirement parsing, weights, immutability |
| `test_escrow.py` | custody, bonds, §62 adversarial payout sequences |
| `test_evidence.py` | receipts, claims, freezing, cross-job binding |
| `test_adjudication.py` | disputes, verdict schema, LLM failure modes |
| `test_settlement.py` | policy mapping, critical override, appeals, recovery |
| `test_equivalence.py` | what reaches consensus, and what the model cannot touch |

**What direct mode can and cannot prove.** It runs the contract in a
real GenVM runner, but `mock_llm` answers the leader and every validator
with the same canned response — so a direct test can never demonstrate
that independent nodes *agree*. What it does pin down is every property
the fingerprint depends on: which fields survive normalisation, which
the contract derives rather than trusts, and which are free-form and
therefore excluded. That is `test_equivalence.py`. Real agreement is the
integration suite's job.

### Integration suite — a live network

**Status: 5 passed against StudioNet, real panel, 6m32s.** Two of the
five drive a full adjudication round through real consensus.

Needs two funded StudioNet accounts, so requester and agent are
genuinely different wallets:

```bash
cp .env.example .env        # fill in the two keys; .env is gitignored
```

Then add the accounts block to `gltest.config.yaml` under `studionet:`

```yaml
  studionet:
    accounts:
      - "${VERITY_REQUESTER_KEY}"
      - "${VERITY_AGENT_KEY}"
```

It is not committed with that block because gltest interpolates `${VAR}`
eagerly at config load — a placeholder in the committed file breaks
`pytest tests/direct/` for anyone who has not set the variables, and the
offline suite should need no setup at all.

```bash
gltest tests/integration -v -s --network studionet
VERITY_SKIP_PANEL=1 gltest tests/integration -v -s --network studionet
```

On Windows, prepend `$env:PYTHONUTF8 = "1"` — the config loader reads
files with the system codec.

Two of these tests drive a real panel: leader and validators each fetch
the evidence, each run the prompt, each compare fingerprints. Expect
minutes per round, and set `VERITY_SKIP_PANEL=1` to run only the fast
on-chain checks.

Not every network supports every feature — localnet has no fee
simulation, StudioNet does — so nothing in the suite assumes a capability
the selected network may not have. Each test deploys its own disposable
contract and never touches the deployment named in the README.

#### Three things that will bite you

**`ContractFactory.deploy()` cannot bind this contract on a hosted
network.** It derives the ABI from `get_contract_schema_for_code`, which
`genlayer_py` refuses outright off localnet, and which hexes the source
with `eth_utils.encode_hex` — ASCII only, so the `§` and `—` in the
contract's comments raise `UnicodeEncodeError` before the call leaves the
machine. `conftest.py` therefore sends the deploy, then fetches the
schema the CHAIN reports with `gen_getContractSchema`, then builds the
contract from that. Stripping characters out of the source to satisfy a
client bug would be the wrong repair.

**The RPC drops connections.** TLS record errors, resets, and CDN 502
pages arrive mid-flight, including while polling a receipt — where
aborting strands a transaction that was already submitted. `conftest.py`
patches the provider's transport to retry those, and only those: a
JSON-RPC error is a real answer and is raised immediately. Re-broadcast
is safe because the raw transaction is already signed, so its nonce and
hash are fixed.

**Assert on the rule, not on the failure.** `must_fail` returns the
contract's own rollback payload (`leader_receipt[0]["result"]["payload"]`),
so a test can require `illegal transition from FUNDED` rather than
accepting any error. A test satisfied by any failure keeps passing when
the call starts failing for an unrelated reason, and quietly stops
testing what it was written for.

## 4. Deployment

```bash
genlayer network set studionet
genlayer deploy --contract contracts/verity.py
```

Do not pass `--rpc` to point at StudioNet. It overrides the endpoint but
not the chain id, and the deploy fails with `InvalidChainId`. Select the
network instead.

Then check what actually landed:

```bash
genlayer schema  <address>
genlayer call    <address> get_protocol_info
genlayer code    <address> > onchain.py
python scripts/verify_deployment.py onchain.py
```

`verify_deployment.py` turns the README's address from a claim into a
check. It normalises three things and nothing else — CRLF line endings,
the CLI's BOM and `Result:` banner, and trailing blank lines — then
demands the rest match byte for byte, comments included.

Finally, point the app at it:

```bash
cp app/.env.example app/.env.local     # set NEXT_PUBLIC_CONTRACT_ADDRESS
```

Redeploying and forgetting this step is the classic failure: the app
keeps serving the old contract and every number on screen is quietly
stale.

## 5. Debugging a failed transaction

```bash
genlayer receipt <txHash> --stdout --stderr
```

The receipt is the first stop, not the last. Two specifics worth knowing:

**ACCEPTED is not success.** A transaction can be accepted by the
network and then revert. The frontend's `revertReason()` handles this;
if you are reading a receipt by hand, check the execution result rather
than the status.

**Read the error prefix.** Every revert message carries a class:

| Prefix | Means | Do |
|---|---|---|
| `[EXPECTED]` | a business rule refused you | read the message; it names the rule |
| `[EXTERNAL]` | evidence could not be retrieved | check the URL yourself |
| `[TRANSIENT]` | temporary infrastructure problem | retry |
| `[LLM_ERROR]` | the panel returned nothing usable | retry; nothing was consumed |

A failed adjudication leaves the job in `EVIDENCE_FROZEN` with no
verdict stored and no escrow moved. Call `adjudicate` again.

## 6. When consensus fails

`MAJORITY_DISAGREE` on a live round almost always means one thing: a
consensus-critical field whose value is a judgement call rather than a
derivation. Two honest validators read the same evidence, reach the same
conclusion, and describe it differently — the fingerprint compares the
descriptions and the round dies.

The fix is always to make the rule *total*, never to weaken the
fingerprint until disagreement becomes impossible. A total rule lands on
exactly one answer for every input, **including silence**.

This is why:

- `fraud_flags` is a closed vocabulary, validated in `_normalize_verdict`;
- `evidence_quality` has a counting rule in the prompt (how many sources
  returned `FETCH_SUCCESS`), not an aesthetic one;
- `unverifiable_items` is derived by the contract from the results;
- `reason_code` and `reasoning` are recorded but **excluded** from the
  fingerprint, because they are labels and prose.

If you add a field to the verdict, decide before you add it: is this a
determination, or a description? Determinations go in the fingerprint
and need a total rule. Descriptions stay out.

## 7. Changing the contract

Some changes are more expensive than they look.

- **Adding a field to a stored dataclass** changes the storage layout.
  Redeploy; there is no migration.
- **Changing anything `_compute_constitution_hash` covers** invalidates
  every existing verdict, by design — a verdict carries the hash it
  judged and `settle` refuses a mismatch.
- **Nested dataclasses and `DynArray` of dataclasses are not supported.**
  Store lists as canonical JSON via `_canon`.
- **Nondet closures must not capture `self`.** That is why the pure
  functions are module-level. A closure holding `self` drags contract
  storage into an environment that must not read it.
- **`gl.nondet.*` must be called directly inside the closure** passed to
  `run_nondet_unsafe`. Behind one more call frame, `genvm-lint` reports
  it as unreachable from the equivalence block. This is why the
  retrieval loop is duplicated in `leader_fn` and `validator_fn` rather
  than shared — and why the two copies must be kept identical.

## 8. Frontend notes

The connector list is curated (`connectorsForWallets`) rather than
RainbowKit's default set. The default set pulls in `@coinbase/cdp-sdk`,
which dynamically imports an x402 + Solana tree that is not installed;
the bundler cannot resolve it and the build fails. `next.config.js`
aliases those roots away, and `providers.tsx` lists the wallets the app
actually supports.

RainbowKit validates `projectId` at module init and throws without one
even when no WalletConnect wallet is listed, so a clearly-labelled
placeholder is passed when the deployment has not configured a real id —
and the WalletConnect entry is dropped from the list rather than shown as
a broken option. Settings states the limitation.

## 9. Useful commands

```bash
PYTHONUTF8=1 genvm-lint check contracts/verity.py --json
pytest tests/direct/ -q --tb=short
pytest tests/direct/ -k settlement -v
genlayer call <address> get_job --args '["<job id>"]'
genlayer call <address> list_jobs --args '[0, 50]'
cd app && npm run build
```
