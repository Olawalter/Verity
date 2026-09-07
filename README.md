<p align="center">
  <img src="https://raw.githubusercontent.com/Olawalter/Verity/main/app/src/app/icon.svg" width="140" alt="Verity"/>
</p>

# Verity - verification and settlement for autonomous agent work

**Verify what agents promise.**

Verity is a GenLayer protocol for agreements between autonomous agents, where
payment depends on whether the work was actually done. GenLayer decides what
the evidence shows; the contract decides what follows from it, and holds the
escrow until it does. The two are separated on purpose, and there is no code
path from a model's output to an amount of money.

Live app: not yet deployed. The contract is live and byte-verified - see
[Contract](#contract).

---

## What it is

- **A verification constitution, frozen at funding.** Requirements with integer
  weights summing to 100, each typed DETERMINISTIC, EVIDENCE or JUDGMENT, and
  each optionally critical. Hashed at funding and re-checked before every
  adjudication and every settlement.
- **An adversarial panel, not a rubber stamp.** Leader and validators each
  retrieve the evidence themselves, each run the prompt, and compare
  determinations. A validator does not inspect the leader's answer for
  well-formedness and call that verification.
- **Escrow the model cannot reach.** The panel returns per-requirement results.
  The contract sums the frozen weights, resolves the policy, and pays. A verdict
  that names its own payout is not rejected - the field is never read.
- **Evidence treated as a claim until retrieved.** Fields are stored as
  `claimed_content_hash` and `claimed_independence`. Only a `FETCH_SUCCESS`
  carries content into the prompt; a 404 page body is not the document.
- **Consensus on what has a consequence, and only that.** Fields that change a
  payout must match across validators. Fields that are merely recorded must not
  gate the round - that lesson cost two live rounds, and is documented below.

## How it works

### For a requester hiring an agent

1. Write the agreement and the requirements, with weights and critical flags.
   Set the settlement policy for each possible verdict.
2. Fund the job. The payment moves into escrow, the terms lock, and the
   constitution is hashed. Nothing is editable after this.
3. Review the deliverable. Accept it and the agent is paid in full.
4. Or dispute it - naming which requirements failed, because "I don't like it"
   is not a dispute. Evidence freezes and the panel is asked.
5. After the appeal window closes, finalize and settle. Payment splits by the
   score the contract derived.

### For an agent taking work

1. Accept the job. Post the performance bond if the agreement asks for one, and
   optionally commit to an execution plan hash.
2. File evidence against specific requirements - a URL, its role, and what you
   claim about it.
3. Submit the deliverable before the execution deadline.
4. If disputed, respond with your account and counter-evidence, then let the
   panel read the frozen record.
5. Collect. Your bond comes back whether you won or lost: underperforming is not
   misconduct.

## Verdicts

| Verdict | Meaning | Default settlement |
|---|---|---|
| `VERIFIED` | every requirement passed | `FULL` - agent takes the payment |
| `PARTIAL` | some passed, some failed | `PROPORTIONAL` - agent takes score%, requester the rest |
| `FAILED` | the work does not meet the agreement | `REFUND` - requester takes the payment |
| `UNVERIFIABLE` | the record cannot support a conclusion | `HUMAN_REVIEW` - nothing settles, escrow waits |

A failed **critical** requirement overrides the score entirely under the
`FAIL_JOB` policy. A job can score 85 and still refund in full, because the one
requirement the requester declared non-negotiable did not hold.

## Lifecycle

```text
DRAFT ──fund──► FUNDED ──accept──► ACTIVE ──submit──► SUBMITTED
  │                                   │                   │
  └──cancel──► CANCELLED              └──expire──► EXPIRED │
                                                           │
                          ┌────────────────────────────────┴──────┐
                    accept_work                              open_dispute
                          │                                        │
                     ACCEPTED ──settle──► SETTLED             DISPUTED
                                                                   │
                                                          freeze_evidence
                                                                   │
                                                           EVIDENCE_FROZEN
                                                                   │
                                                             adjudicate
                                                                   │
                                                            ADJUDICATING
                                                                   │
                                                              VERDICT
                                                      ┌────────────┴──────────┐
                                                   appeal          finalize_verdict
                                                      │                       │
                                                 APPEALED                FINALIZED
                                                      │                       │
                                          adjudicate  ▼                       │
                                              FINAL_ADJUDICATION              │
                                                      │                       │
                                                      └──► VERDICT ───────────┤
                                                                              │
                                                   ┌──────────────────────────┤
                                                settle                 recover_escrow
                                                   │                          │
                                               SETTLED                    REFUNDED
```

| Status | Escrow held | What can happen next |
|---|---|---|
| `DRAFT` | no | fund, cancel, amend the terms |
| `FUNDED` | yes | agent accepts, or requester cancels |
| `ACTIVE` | yes | agent submits, or the deadline expires it |
| `SUBMITTED` | yes | requester accepts or disputes |
| `ACCEPTED` | yes | settle in full |
| `DISPUTED` | yes | freeze the evidence |
| `EVIDENCE_FROZEN` | yes | adjudicate |
| `ADJUDICATING` | yes | the round resolves, or fails and returns here |
| `VERDICT` | yes | appeal, finalize, or recover if unverifiable |
| `APPEALED` | yes | one further adjudication |
| `FINAL_ADJUDICATION` | yes | the appeal round resolves |
| `FINALIZED` | yes | settle, or recover if unverifiable |
| `SETTLED` `CANCELLED` `REFUNDED` | no | terminal |
| `EXPIRED` | yes | recover the escrow |

`VERDICT` is deliberately not `FINALIZED`. A verdict accepted by consensus is
not yet spendable; it becomes spendable only once the appeal window has actually
elapsed, and `final_verdict_id` pins which verdict a settlement pays on so a
later round cannot redirect it.

## GenLayer consensus functions

| Function | Kind | What runs under consensus |
|---|---|---|
| `adjudicate` | `run_nondet_unsafe` | Every node fetches the frozen evidence URLs itself, classifies each retrieval, runs the adjudication prompt, normalises the response with the same code, and compares decision fingerprints. Agreement means independent nodes reading the same record reached the same determinations. |

Everything else in this protocol is deterministic and could run on any chain.
The judgment could not: it needs a model to read unstructured evidence, and
several independent parties to agree on what that evidence shows.

**What the fingerprint compares**

```text
job_id · verdict · per-requirement (id, result) · unverifiable_items
```

**What it deliberately excludes** - `reasoning`, `reason_code`,
`evidence_quality` and `fraud_flags`. All four are stored on the verdict and
shown in the UI. None of them is read by `_compute_settlement`, `_resolve_policy`,
the score, or any state transition. Requiring independent validators to agree on
a field that changes nothing can only lose rounds, and it did - see
[Verified end-to-end](#verified-end-to-end).

## Contract

| | |
|---|---|
| Network | GenLayer StudioNet |
| Chain ID | 61999 |
| RPC | `https://studio.genlayer.com/api` |
| Address | `0xf1443Af9A2c708E09BeA2EAbcD608502c016Dc2c` |
| Runner | `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` |
| Source | [`contracts/verity.py`](contracts/verity.py) - sha256 `7db00c085cb9d6eaf443182b71c75436b594549e7f5a7396d175f7803e2ea9eb` |
| Verify | `genlayer code <address> > onchain.py && python scripts/verify_deployment.py onchain.py` |

No explorer link: the public Studio explorer is returning 503, and the Studio
Next explorer indexes a different chain, so a link to either would be decoration
rather than evidence. The address above is a claim until someone checks it, so
the check ships with the repository instead. `verify_deployment.py` normalises CRLF, the CLI's BOM and
`Result:` banner, and trailing blank lines - then demands the rest match byte
for byte, comments included. It was run against this deployment and matched.

### Write methods

| Method | Who | Payable | Notes |
|---|---|---|---|
| `create_job` | requester | no | Names the agent, the requirements and the settlement policies |
| `update_draft` | requester | no | DRAFT only; the amendment path exists so tampering has something to fail against |
| `fund_job` | requester | **yes** | Records `gl.message.value`; locks the terms and hashes the constitution |
| `accept_job` | agent | **yes** | Exact performance bond, or zero if the job asks for none |
| `submit_evidence` | either party | no | A receipt binding a URL to a requirement; every field is a claim |
| `submit_deliverable` | agent | no | Closes execution and opens the acceptance window |
| `accept_work` | requester | no | Ends it without adjudication; the agent is paid in full |
| `open_dispute` | requester | **yes** | Must name which requirements failed; exact dispute bond |
| `respond_to_dispute` | agent | no | The agent's account and counter-evidence |
| `freeze_evidence` | either party | no | Snapshots and hashes the admissible set; nothing is admissible after |
| `adjudicate` | either party | no | The consensus round; leaves state untouched if it fails |
| `appeal` | either party | no | One bounded appeal, reading the same frozen record |
| `finalize_verdict` | either party or owner | no | Only once the appeal window has elapsed; pins `final_verdict_id` |
| `settle` | either party or owner | no | Derives the split and releases escrow |
| `cancel_job` | requester | no | Before acceptance; refunds in full |
| `expire_job` | either party | no | Past the execution deadline with no delivery |
| `recover_escrow` | either party or owner | no | Escape hatch for a job that cannot settle normally |
| `tick` | anyone | no | Advances the protocol clock |

### Read methods

`get_protocol_info` · `get_job` · `list_jobs` · `get_requirements` ·
`get_evidence` · `get_dispute` · `list_verdicts` · `get_verdict` ·
`get_settlement` · `get_passport`

### Consensus guarantees

- The panel returns requirement-level results. It never returns an amount, a
  percentage, a recipient or a weight, and `_normalize_verdict` returns a fixed
  key set, so an invented `agent_payout` is dropped structurally rather than
  rejected by name.
- The score is the contract's own sum over the frozen weights, computed after
  consensus.
- Terms and custody are separate fields. Settlement reads `payment_deposited`,
  what the chain actually moved - not `payment_wei`, what was agreed.
- All value leaves through one helper, from three call sites. The held balance
  is driven to zero and the terminal state persisted before a single wei moves.
- A failed round consumes nothing: no verdict stored, no escrow moved, and the
  job stays in `EVIDENCE_FROZEN` so the call can simply be retried.
- Unavailable evidence supports `UNVERIFIABLE`, never `PASS`.

## Verified end-to-end

Six tests against StudioNet with a real validator panel - no mocks, real
retrieval, real GEN.

```text
$ gltest tests/integration -v -s --network studionet

deployed disposable Verity at 0x4Bc8d70A01CDd9E6da9A656016e1B503F29D9363
test_protocol_surface_is_live_and_closed              PASSED
test_funding_locks_terms_and_records_real_custody     PASSED
test_cancel_returns_escrow_before_acceptance          PASSED
test_live_panel_reaches_consensus_on_retrievable_evidence  PASSED
test_unreachable_evidence_does_not_pass               PASSED
test_settlement_moves_real_balances
  panel returned VERIFIED score=100 -> policy FULL
  settled FULL: agent +2.0 GEN, requester +0.0 GEN
                                                      PASSED

======================== 6 passed in 570.64s (0:09:30) ========================
```

What those six establish:

- **A real panel agrees.** Independent validators fetched the same document, ran
  the prompt separately, and produced matching determinations.
- **Unreachable evidence does not pass.** Against a domain that cannot resolve,
  both requirements came back exactly `UNVERIFIABLE`, the score was 0, and the
  escrow did not move. The test demands `UNVERIFIABLE` specifically rather than
  accepting `FAIL` too - tolerating either answer is tolerating the ambiguity
  that splits validators.
- **Money actually moves.** Settling from `VERDICT` was refused; after the appeal
  window closed, `finalize_verdict` then `settle` ran to FINALIZED and the
  agent's on-chain balance rose by exactly 2 GEN. The expected figure is derived
  independently from the frozen weights, so the test does not merely agree with
  whatever the contract computed.

> **The round that failed first, and why it mattered.** An earlier run failed two
> adjudications with the leader receipt reporting SUCCESS while nothing was
> committed. The cause was `evidence_quality` sitting inside the fingerprint. It
> had a genuinely total rule - count the sources that returned `FETCH_SUCCESS` -
> and it still broke rounds, because retrieval itself differs between nodes. One
> validator's fetch times out, its count differs by one, and the round dies over
> a field that could not have moved a payout by a wei. A total rule is necessary
> and not sufficient; the input has to be identical too, and retrieval is not.
> The fix was to require agreement on everything that has a consequence, and only
> on that.

Offline: **104 direct tests**, plus `genvm-lint` clean at 28 methods (10 view,
18 write), `tsc --noEmit` clean, and a clean frontend build across 12 routes.
CI runs all four on every push.

## Tech stack

| Layer | Choice |
|---|---|
| Contract | Python on GenVM, pinned runner |
| Consensus | `gl.vm.run_nondet_unsafe` with a re-running validator |
| Retrieval | `gl.nondet.web.get`, classified fail-closed |
| Contract tests | `gltest` direct mode + `pytest` |
| Live tests | `gltest` against StudioNet |
| Frontend | Next.js 16, React 19, TypeScript strict, Tailwind |
| Wallet | RainbowKit + Wagmi + Viem, EIP-6963 discovery |
| Chain client | `genlayer-js` |
| Data | TanStack Query, refetched from chain after every write |

## Repository

```text
contracts/verity.py          the protocol, one file
scripts/verify_deployment.py proves the deployment matches the source
tests/direct/                104 tests, offline
  test_job.py                agreements, weights, immutability
  test_escrow.py             custody, bonds, adversarial payout sequences
  test_evidence.py           receipts, claims, freezing, cross-job binding
  test_adjudication.py       disputes, verdict schema, LLM failure modes
  test_settlement.py         policy mapping, critical override, appeals
  test_equivalence.py        what reaches consensus, and what cannot touch money
tests/integration/           6 tests, live panel
app/                         Next.js frontend, 12 routes
  src/app/icon.svg           the build's mark, served as the favicon
.github/workflows/ci.yml     lint, direct suite, typecheck, build
```

## Getting started

```bash
pip install -r requirements.txt
genvm-lint check contracts/verity.py
pytest tests/direct/ -q
```

```bash
cd app
npm install
cp .env.example .env.local        # set NEXT_PUBLIC_CONTRACT_ADDRESS
npm run dev                       # http://localhost:3120
```

Deploy and verify:

```bash
genlayer network set studionet
genlayer deploy --contract contracts/verity.py
genlayer code <address> > onchain.py
python scripts/verify_deployment.py onchain.py
```

The live suite needs two funded StudioNet accounts and takes minutes per round.
[DEVELOPMENT.md](DEVELOPMENT.md) covers the setup, the three tooling traps it
works around, and what to do when consensus fails.

## Security

- Every write opens with a named guard: the job exists, the caller is the right
  party, the transition is legal, the constitution still hashes the same.
- Deposits come only from `gl.message.value`. Bond amounts are exact - over- and
  under-payment both revert, and no change is given.
- One transfer helper, three call sites, recipients read from storage. There is
  no function that takes a recipient and an amount from the caller.
- Payouts are asserted to sum to custody exactly, twice. Integer arithmetic
  throughout; rounding remainders fall to the requester by construction.
- Retrieved text is data, never instructions. A source containing directions to
  the adjudicator is flagged, not obeyed.
- The owner is a keeper, not an authority: it may tick, settle and recover, and
  every one of those runs the same computation it would for anyone else.
- No seed phrase, private key or wallet password is requested, stored or logged
  anywhere in the app.

[SECURITY.md](SECURITY.md) has the full model, including the assumptions this
protocol makes and does not hide.

## Design notes

- **Bonds return to whoever posted them.** A requester who disputes and loses is
  not punished, and an agent who underperforms is not slashed. Punishing a
  good-faith dispute deters legitimate disputes, and ordinary task failure is not
  misconduct - slashing needs explicit bad-faith criteria this protocol does not
  claim to have.
- **`UNVERIFIABLE` is a real answer, not a failure to answer.** It routes to
  human review with the escrow untouched. Guessing a split for a record that
  cannot support a conclusion would be inventing a verdict.
- **The clock is a tick counter, not a wall clock.** `gl.message.datetime` is not
  populated in every runtime this contract must run in, and a deadline that
  silently reads zero is worse than one that is openly abstract. Deadlines are
  absolute tick values, and the UI shows `PROTOCOL TICK` rather than dressing it
  up as elapsed time.
- **Content hashes are not verified.** `claimed_content_hash` is never compared
  against retrieved bytes. The guarantee is that validators read the real source,
  not that the bytes matched a hash the submitter supplied - and the field is
  named as a claim so nothing reads it as more.
- **Evidence has exactly one home in storage.** One array, with pointers into it.
  A record stored twice is a record that drifts.

## Disclaimer

Verity is a hackathon build on GenLayer StudioNet, a test network. It has not
been audited. The escrow logic moves real network tokens on the chain it is
deployed to, and the settlement path has been exercised end to end, but nothing
here should hold value you are not prepared to lose. A validator majority acting
in coordinated bad faith can agree on a false verdict; that is the platform's
trust model, and the bounded appeal is a way to contest one bad round rather
than a defence against a captured panel.
