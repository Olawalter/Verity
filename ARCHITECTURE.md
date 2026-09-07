# Architecture

How Verity is put together, and why each boundary sits where it does.

---

## 1. The central split

```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│  GENLAYER                    │      │  THE CONTRACT                │
│  determines MEANING          │ ───► │  determines CONSEQUENCES     │
├──────────────────────────────┤      ├──────────────────────────────┤
│ per-requirement              │      │ score  = Σ weight of PASS    │
│   PASS / FAIL / UNVERIFIABLE │      │ policy = constitution lookup │
│ evidence_quality             │      │ payout = escrow × score ÷ 100│
│ fraud_flags                  │      │ recipient, timing, custody   │
│ unverifiable_items           │      │ state transition             │
│ ─ recorded, not consensus ─  │      │                              │
│ evidence_quality · fraud_    │      │                              │
│ flags · reasoning · reason_  │      │                              │
│ code                         │      │                              │
└──────────────────────────────┘      └──────────────────────────────┘
        ▲                                        │
        │ frozen evidence + constitution         │ GEN out via _send_gen
        └────────────────────────────────────────┘
```

The panel is asked *what is true*. The contract decides *what follows*.
There is no code path from model output to an amount: `_compute_settlement`
reads `Job.payment_deposited`, `Verdict.score` (derived by the contract),
and the constitution — never the raw model object.

## 2. Repository layout

```
contracts/verity.py        the Intelligent Contract — the whole protocol
tests/direct/              104 tests, leader path, no network
tests/integration/         gltest suite for a live network
app/                       Next.js 16 frontend
  src/lib/verity.ts        typed contract client + receipt lifecycle
  src/lib/config.ts        chain, RPC, explorer, contract address
  src/lib/providers.tsx    curated wallet stack
  src/lib/useVerity.ts     TanStack Query hooks, one per view method
  src/components/          shared UI primitives
  src/app/                 12 routes
gltest.config.yaml         network + contract paths for gltest
```

## 3. Contract structure

`contracts/verity.py` is one file in five bands, in dependency order.

**Band 1 — vocabulary.** Every state, requirement type, result, verdict,
quality grade, evidence role, independence class, retrieval label,
settlement policy and limit is a module constant. Nothing compares
against a bare string literal, so a typo is a `NameError` at load rather
than a silently-false branch at runtime.

**Band 2 — storage models.** `Job`, `EvidenceReceipt`, `Dispute`,
`Verdict`, `Settlement`, `PassportEntry`.

**Band 3 — module-level pure functions.** `_parse_requirements`,
`_normalize_verdict`, `_decision_fingerprint`, `_classify_fetch`,
`_handle_leader_error`, `_canon`, `_sha256_hex`. These are module-level
and not methods for a specific reason: they run inside nondet closures,
and a closure that captured `self` would drag contract storage into an
environment where it must not be read.

**Band 4 — the contract class.** Guards (`_require_*`), then writes in
lifecycle order, then `_send_gen` — the single point where value leaves.

**Band 5 — views.** Ten read methods; every one returns plain JSON-safe
types.

## 4. Storage model

GenLayer storage does not accept a `DynArray` of dataclasses or nested
dataclasses. Two consequences shape the whole design:

- **Lists are canonical JSON strings.** `requirements_json`,
  `disputed_requirements_json`, `requirement_results_json` and
  `fraud_flags_json` are stored as text and parsed on read. `_canon`
  gives one byte-exact encoding (sorted keys, no whitespace) so hashing
  is reproducible.
- **Collections are `TreeMap` keyed by string.** Job ids, evidence ids,
  verdict ids and passport addresses are all string keys.

Evidence has exactly one home. `evidence` is a single `DynArray` of
receipts; `evidence_owner` and `evidence_index` are `TreeMap`s that point
into it. Storing a receipt in both a per-job list and a global list is
how records drift — one copy gets updated, the other does not, and the
audit trail quietly disagrees with itself.

Addresses are normalised through `_key` before use as a map key, so the
same wallet in two casings is one identity.

## 5. State machine

Sixteen states. Every transition is guarded by `_require_state`, and the
error names the illegal move rather than saying "invalid":

```
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

Three properties worth stating explicitly:

1. **`VERDICT` is not `FINALIZED`.** A consensus-accepted verdict is not
   spendable. `finalize_verdict` requires the appeal window to have
   actually elapsed (`APPEAL_WINDOW_TICKS`) or the appeal budget to be
   exhausted. Settlement is legal only from `FINALIZED`.
2. **`final_verdict_id` pins the payout.** Settlement reads that id, not
   "the latest verdict", so an appeal round cannot redirect a payout that
   was already made final.
3. **Terminal is terminal.** `SETTLED`, `CANCELLED` and `REFUNDED` have
   no outgoing edges. Every escrow-bearing state is enumerated in
   `ESCROW_HELD_STATES`, so no state can hold money without a listed
   exit.

## 6. Immutability

Terms are mutable in `DRAFT` and frozen at `FUNDED`. `update_draft`
rejects any call from a state other than `DRAFT`, so nothing is editable
once money is in custody.

Beyond the state guard, the constitution is hashed.
`_compute_constitution_hash` covers the requirement set, weights,
critical flags and every settlement policy;
`_require_constitution_intact` re-derives that hash and compares before
adjudication and before settlement. A silent storage mutation would have
to reproduce a sha256 to go unnoticed.

## 7. Escrow

**Terms and custody are different fields.**

```
payment_wei          agent_bond_wei          dispute_bond_wei        ← terms
payment_deposited    agent_bond_deposited    dispute_bond_deposited  ← money
```

`payment_wei` is what the parties agreed. `payment_deposited` is what
`gl.message.value` actually delivered. Settlement reads the second. A
contract that pays out the agreed figure rather than the received figure
pays out money it may not hold.

**Three payable entry points**, each recording `gl.message.value`:

| Function | Purpose |
|---|---|
| `fund_job` | requester deposits the payment; DRAFT → FUNDED |
| `accept_job` | agent posts the performance bond, if the job requires one |
| `open_dispute` | requester posts the dispute bond, if the job requires one |

**One exit point.** All value leaves through `_send_gen`, which wraps a
`_Recipient` EVM contract interface — an empty `@gl.evm.contract_interface`
proxy, because reaching for a contract handle at a plain wallet address
is not a supported operation. Three callers only: `settle`, `cancel_job`,
`recover_escrow`.

**One ordering, everywhere:**

```
read ledgers → validate → compute amounts → DRAIN the held balance
                                          → persist state → emit transfers
```

Held custody is a derived figure:

```python
def _escrow_held(self, j):
    return (payment_deposited + agent_bond_deposited
            + dispute_bond_deposited) - total_released
```

Draining means `total_released += held`, which takes `_escrow_held` to
zero before a single wei moves. A re-entrant call therefore finds nothing
left to take, and because the terminal state is persisted first, it fails
a state guard before it reaches the arithmetic at all. Both guards are
present; either alone would do.

The deposit ledgers are never rewritten, so the record of what was
received stays readable after settlement — `escrow_before` and
`escrow_after` on the `Settlement` row show the transition explicitly.

**Bonds are returned, not slashed.** A requester who disputes and loses
gets the dispute bond back; an agent who underperforms gets the
performance bond back. Punishing a good-faith dispute deters legitimate
disputes, and ordinary task failure is not misconduct. Slashing needs
explicit bad-faith criteria, and this protocol does not claim to have
them.

## 8. Evidence

Every submitter-provided field is a claim, and is named as one:
`claimed_content_hash`, `claimed_independence`. The contract verifies
neither. `submit_evidence` records who submitted, when, for which
requirement, in which role, at which URL — the *provenance* of a claim,
not its truth.

Truth enters at adjudication, where each node retrieves the URL itself.
`_classify_fetch` returns `(label, content)` and **only `FETCH_SUCCESS`
carries content**:

| Label | Content | Meaning |
|---|---|---|
| `FETCH_SUCCESS` | the body | retrieved |
| `NON_SUCCESS_RESPONSE` | empty | an error page is not the document |
| `EMPTY_CONTENT` | empty | reachable, nothing there |
| `FETCH_FAILURE` | empty | unreachable |

A 404 page body is not evidence, and a panel that reasons over one is
reasoning over an error message. Unavailable evidence supports
`UNVERIFIABLE`, never `PASS`.

Retrieved text is data. The prompt states that any instructions appearing
inside a source are content to be reported, not directions to follow, and
that such a source is a `fraud_flags` candidate.

**Independence is a verification property, not arithmetic.** Two hosts
republishing one origin are not two independent sources. The submitter
declares `INDEPENDENT | RELATED | SAME_ORIGIN | UNKNOWN`; the panel
judges that claim against what it actually retrieved.

**Freezing.** `freeze_evidence` snapshots the admissible set,
canonicalises it and stores a sha256. After that the state is
`EVIDENCE_FROZEN`, and `submit_evidence` fails the state guard first and
the frozen flag second — defence in depth. Every adjudication round,
including an appeal, reads the same frozen snapshot, so a second round is
a second reading of one record rather than a second record.

## 9. Adjudication

```
adjudicate(job_id)
  │
  ├─ guards: state, party, constitution hash intact
  ├─ build prompt from FROZEN evidence + constitution + dispute
  │
  └─ gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        │
        ├─ leader_fn:     retrieve URLs → classify → prompt → parse
        │                 → _normalize_verdict → return
        │
        └─ validator_fn:  retrieve URLs → classify → prompt → parse
                          → _normalize_verdict
                          → compare _decision_fingerprint(mine)
                                 vs _decision_fingerprint(leader)
```

The validator **re-runs the work**. It does not check that the leader's
JSON has the right keys — a shape check accepts a well-formed wrong
answer, which is the failure mode that matters. Agreement here means
several nodes independently read the same evidence and reached the same
determinations.

**The fingerprint is the equivalence rule.** `_decision_fingerprint`
projects a verdict down to exactly the fields that must match:

```
job_id · verdict
       · per-requirement (id, result), sorted by id
       · unverifiable_items, sorted
```

That list is short on purpose. The rule it follows, arrived at by
watching live rounds fail:

> **Require agreement on everything that has a consequence, and only on
> that.**

`reasoning` and `reason_code` are prose and labels. `evidence_quality`
and `fraud_flags` are descriptions of the record: they are stored on the
verdict and shown in the UI, but nothing reads them — not
`_compute_settlement`, not `_resolve_policy`, not the score, not one
state transition. Two direct tests pin that down by swapping both fields
and showing the payout is byte-identical.

`evidence_quality` was the instructive one. It had a perfectly total
counting rule — how many sources returned `FETCH_SUCCESS` — and it still
broke rounds, because *retrieval itself differs between nodes*. One
validator's fetch times out, its count differs by one, and a round dies
over a field that could not have moved a payout by a single wei. A total
rule is necessary and not sufficient: the input has to be identical too,
and retrieval is not.

What remains has a total rule behind it — one that lands on exactly one
answer for every input, including silence:

| Field | What makes it derivable |
|---|---|
| `(id, result)` | the determination itself, from a fixed vocabulary, with `FAIL` vs `UNVERIFIABLE` decided by a total test (see below) |
| `verdict` | implied by the results, and coherence-checked during normalisation |
| `unverifiable_items` | derived by the contract from the results, never taken from the model |

**`FAIL` and `UNVERIFIABLE` are not interchangeable, and the prompt now
says which applies.** `FAIL` means something was read that contradicts
the requirement. `UNVERIFIABLE` means what was needed could not be read —
and if *every* source filed against a requirement failed to return
`FETCH_SUCCESS`, the answer is `UNVERIFIABLE`, never `FAIL`. Leaving that
open was a real defect: two honest validators split on it, and the two
settle very differently — `FAIL` scores zero, `UNVERIFIABLE` sends the
job to human review with the escrow untouched.

**The prompt does the load-bearing work.** It states each rule
explicitly, and tells the panel outright which fields gate consensus and
which are merely recorded, so a node does not try to match another's
wording on a field nobody compares.

**`_normalize_verdict` returns a fixed key set:**

```
job_id · verdict · requirements · evidence_quality
       · fraud_flags · unverifiable_items · reasoning
```

An invented `agent_payout` field is not rejected — it is structurally
dropped, because nothing reads it. Normalisation also enforces that every
requirement in the constitution appears exactly once, with a legal
result, and that no requirement the constitution never named appears at
all.

**The score is computed by the contract, after consensus:**

```python
score = 0
critical_failed = False
for r in norm["requirements"]:
    if r["result"] == R_PASS:
        score += weights[r["id"]]
    elif r["result"] == R_FAIL and r["id"] in criticals:
        critical_failed = True
```

Weights come from the frozen constitution, never from the model.

**LLM failure taxonomy.** `_handle_leader_error` distinguishes a
malformed or absent model response (`[LLM_ERROR]`) from an expected
business rejection (`[EXPECTED]`), an external retrieval problem
(`[EXTERNAL]`) and a transient one (`[TRANSIENT]`). A failed round leaves
the job in `EVIDENCE_FROZEN` and consumes nothing — no verdict is stored,
no escrow moves, and the call can simply be retried.

## 10. Settlement

```python
payment = int(j.payment_deposited)          # custody, not terms
policy  = self._resolve_policy(j, v)        # constitution lookup

FULL          → agent_amt = payment
REFUND        → agent_amt = 0
PROPORTIONAL  → agent_amt = payment * score // WEIGHT_TOTAL
HUMAN_REVIEW  → raise; nothing settles

requester_amt = payment - agent_amt         # subtraction, so the two
                                            # always sum to the escrow
```

`_resolve_policy` maps the verdict through the constitution, then applies
the critical-requirement policy: under `FAIL_JOB`, a failed critical
requirement forces `REFUND` regardless of score. A job can score 85 and
still refund in full, because the one requirement the requester declared
non-negotiable failed.

Integer arithmetic throughout. Because `requester_amt` is a subtraction,
any rounding remainder falls to the requester — the party owed a refund
is never short by a rounding artefact.

`UNVERIFIABLE` maps to `HUMAN_REVIEW` by default. The escrow stays put
until `recover_escrow`. Guessing a split for a record that cannot support
a conclusion would be inventing a verdict.

## 11. The clock

`gl.message.datetime` is not populated in every runtime this contract
must run in, and a deadline that silently reads zero is a deadline that
never fires. Verity uses an explicit monotonic tick counter: `_tick()`
reads it, `tick()` is a public write that advances it, and deadlines are
absolute tick values.

This is stated in the README's limitations and shown in the UI as
`PROTOCOL TICK`, not dressed up as wall-clock time. Consequence:
deadlines advance with protocol activity rather than with elapsed
seconds.

## 12. Frontend

Next.js 16 App Router, React 19, TypeScript strict, Tailwind, RainbowKit
+ Wagmi + Viem, TanStack Query, genlayer-js.

- `src/lib/config.ts` — the only place the chain, RPC, explorer and
  contract address are read. A missing `NEXT_PUBLIC_CONTRACT_ADDRESS`
  produces a stated error, never a fabricated default.
- `src/lib/verity.ts` — one typed function per contract method.
  `revertReason()` handles the case that matters on GenLayer: a
  transaction that is **ACCEPTED but REVERTED**. Treating acceptance as
  success shows a success toast for a failed write.
- `src/lib/providers.tsx` — a curated connector list rather than
  RainbowKit's default set, so the app offers exactly the wallets it
  supports. `injectedWallet` is EIP-6963-aware; nothing reaches for
  `window.ethereum` directly, because with two extensions installed that
  global is whichever won the race and the user can end up signing from a
  wallet they never chose.
- `src/lib/useVerity.ts` — a TanStack Query hook per view. After a write
  the app refetches authoritative state; it does not optimistically patch
  a local cache and call that the chain.

Every write surfaces the full lifecycle — `signing → submitted →
confirming → reconciling → confirmed | reverted` — with the transaction
hash exposed as soon as one exists.

## 13. What is deliberately absent

- **No admin override on settlement.** No owner key can redirect a
  payout. The owner can tick and read; that is all.
- **No off-chain verdict store.** Everything a verdict rests on is on
  chain, or is a frozen hash of what it rested on.
- **No confidence score.** A number that is not derived from anything is
  decoration, and decoration next to money reads as evidence.
- **No slashing.** See §7.
