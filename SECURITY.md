# Security

What Verity guarantees, what it assumes, and what it does not claim.

---

## 1. Threat model

The protocol holds GEN in escrow and releases it on the strength of a
decision made by a model panel. Four parties can misbehave:

| Actor | What they might try |
|---|---|
| **Requester** | dispute good work to claw back payment; edit the acceptance criteria after seeing the deliverable; drain escrow twice |
| **Agent** | submit fabricated or unreachable evidence; pass off one source as several; claim payment for work that failed a critical requirement |
| **A third party** | call a privileged function; settle someone else's job; re-enter a payout |
| **Evidence itself** | carry text designed to instruct the panel rather than inform it |

The model is treated as *fallible but not adversarial*: it may be wrong,
malformed or unavailable, and every one of those is handled. A validator
majority acting in coordinated bad faith is outside what this contract
can defend against — see §8.

## 2. Authorisation

Every write begins with an explicit guard, and the guards are named
rather than inlined so the intent is auditable at a glance:

```
_require_job(job_id)        the job exists
_require_requester(j)       caller is the requester
_require_agent(j)           caller is the agent
_require_party(j, owner?)   caller is a party (optionally the owner)
_require_state(j, allowed)  the transition is legal from here
_require_constitution_intact(j)   the frozen terms still hash the same
```

Address comparison goes through `_key`, so the same wallet in two
casings is one identity and a case-flipped address cannot impersonate a
party.

`settle`, `cancel_job` and `recover_escrow` all require a party.
The owner may call `settle` and `recover_escrow` — a keeper role for
jobs whose parties have gone quiet — but the owner can only trigger the
computation, never influence its result. There is no admin function that
changes a payout, a score, a verdict or a constitution.

## 3. Escrow invariants

These hold at every point in the lifecycle.

1. **Custody is tracked separately from terms.** `payment_wei` is the
   agreement; `payment_deposited` is what `gl.message.value` delivered.
   Settlement reads the deposited figure. Paying the agreed figure rather
   than the received one pays out money the contract may not hold.
2. **Deposits come from `gl.message.value` only.** No payable function
   takes an amount argument.
3. **Zero-value deposits are rejected.** `fund_job` requires `> 0`.
4. **Bond amounts are exact.** `accept_job` and `open_dispute` require
   `sent == required`; over- and under-payment both revert. There is no
   "close enough", and no change is given.
5. **One transfer helper.** All value leaves through `_send_gen`, called
   from exactly three places: `settle`, `cancel_job`, `recover_escrow`.
   `_send_gen` refuses a non-positive amount and refuses an empty
   recipient.
6. **Balance drained before transfer.** `total_released += held` runs
   before any emission, so `_escrow_held` is already zero when value
   moves.
7. **Terminal state persisted before transfer.** A second call fails
   `_require_state` before reaching the arithmetic.
8. **Payouts sum to custody, exactly.** `settle` asserts
   `agent + requester + agent_bond + dispute_bond == held` and reverts
   otherwise. `_compute_settlement` separately asserts
   `agent_amt + requester_amt == payment` and that neither exceeds it.
9. **No floating point.** Every amount, weight and score is an integer;
   the proportional payout is `payment * score // 100`. Rounding
   remainders fall to the requester by construction, since
   `requester_amt` is a subtraction.
10. **No arbitrary transfers.** There is no function that takes a
    recipient and an amount from the caller. Recipients are always
    `j.agent` or `j.requester`, read from storage.
11. **No permanent lock.** Every escrow-bearing state is listed in
    `ESCROW_HELD_STATES` and every one has an exit: `settle`,
    `cancel_job`, or `recover_escrow`.

## 4. Immutability of the agreement

Terms are editable in `DRAFT` and frozen at `FUNDED`. Two independent
mechanisms enforce it:

- **State guard.** `update_draft` accepts calls from `DRAFT` only.
- **Constitution hash.** `_compute_constitution_hash` covers the
  requirement set, weights, critical flags and all settlement policies.
  It is computed at funding and re-derived by
  `_require_constitution_intact` before adjudication and before
  settlement. A stored `Verdict` also carries the hash it judged, and
  `settle` refuses a verdict whose hash does not match the job's:

  ```python
  if v.constitution_hash != j.constitution_hash:
      raise ...  # verdict judged a different constitution
  ```

So even a verdict reached honestly under old terms cannot pay out under
new ones.

## 5. The model cannot move money

This is enforced structurally, in three layers.

**Layer 1 — the prompt never asks.** The panel is asked for
per-requirement results, evidence quality, fraud flags and unverifiable
items. It is told explicitly that it does not decide payment.

**Layer 2 — normalisation drops everything else.**
`_normalize_verdict` builds and returns a fixed key set:

```
job_id · verdict · requirements · evidence_quality
       · fraud_flags · unverifiable_items · reasoning
```

A response containing `"agent_payout": 999999999` is not rejected as
malicious — the field is simply never copied out, so nothing downstream
can read it. Rejection would depend on anticipating the field name; a
fixed key set does not.

**Layer 3 — the score is derived by the contract.** After consensus, the
contract sums the weights of the requirements marked `PASS`, using
weights from the frozen constitution. The model never supplies a number
that reaches arithmetic.

There is no code path from a model output to `_send_gen`.

## 6. Evidence is untrusted input

- Every submitted field is stored under a name that says it is a claim:
  `claimed_content_hash`, `claimed_independence`. The contract verifies
  neither.
- Retrieval happens during adjudication, on each node. `_classify_fetch`
  returns `(label, content)` and **only `FETCH_SUCCESS` carries
  content** — an error page body, an empty body and a failed fetch all
  yield empty content with a label saying why. A panel cannot
  accidentally reason over a 404 page as though it were the document.
- **Unavailable evidence is not verified evidence.** It supports
  `UNVERIFIABLE`, never `PASS`. Fail-closed is the default everywhere
  retrieval is involved.
- **Prompt injection.** Retrieved text is inserted as data, and the
  prompt states that instructions appearing inside a source are content
  to be reported, not directions to follow, and that such a source is a
  `fraud_flags` candidate. Evidence cannot redefine a requirement, a
  weight, a policy or a verdict — those come from the frozen
  constitution, which is not part of the retrieved text.
- **Freezing.** `freeze_evidence` snapshots and hashes the admissible
  set. After that, `submit_evidence` fails the state guard, and the
  frozen flag is a second check behind it. Every round, appeal included,
  reads the same snapshot.

## 7. Failure handling

A failed adjudication round must not be worse than no round at all.

| Class | Meaning | Effect |
|---|---|---|
| `[EXPECTED]` | a business rule refused the call | revert with a specific reason |
| `[EXTERNAL]` | evidence could not be retrieved | recorded as a retrieval label; feeds `UNVERIFIABLE` |
| `[TRANSIENT]` | a temporary infrastructure problem | revert; the call can simply be retried |
| `[LLM_ERROR]` | absent or malformed model output | revert; no verdict stored, no escrow moved |

`_handle_leader_error` distinguishes these rather than collapsing them
into a generic failure. A failed round leaves the job in
`EVIDENCE_FROZEN` with the same evidence, and `adjudicate` can be called
again. Nothing is consumed, and no partial state is written.

Consensus failure is a *correct* outcome, not a bug to route around. If
validators disagree, the round fails and no verdict is recorded. The fix
is always to make the prompt's rules more total — never to weaken the
fingerprint until disagreement becomes impossible.

## 8. Assumptions

Stated plainly, because an unstated assumption reads as a guarantee.

1. **GenLayer's consensus is honest.** A validator majority in
   coordinated bad faith can agree on a false verdict. That is the
   platform's trust model, not something a contract can fix from inside.
   The bounded appeal (`MAX_APPEALS = 1`) exists so a single bad round
   can be contested; it is not a defence against a captured panel.
2. **Retrieval reflects reality at read time.** A source that changes
   between funding and adjudication is judged as it reads during
   adjudication. The frozen snapshot fixes *which URLs* are admissible,
   not what those URLs will say.
3. **Content hashes are unverified.** `claimed_content_hash` is never
   compared against retrieved bytes. The guarantee is "validators read
   the real source", not "the bytes matched a hash the submitter
   provided".
4. **The clock is a tick counter.** Deadlines advance with protocol
   activity, not with elapsed time. `tick()` is permissionless, so any
   account can age a job forward — this is deliberate (a deadline nobody
   can reach is not a deadline) and means deadlines are orderings, not
   wall-clock promises.
5. **The owner is a keeper, not an authority.** The owner may call
   `settle`, `recover_escrow` and `tick`. Each of those runs the same
   computation for the owner as for anyone else.
6. **Direct tests exercise the leader path.** `mock_llm` answers leader
   and validators identically, so agreement itself cannot be staged
   offline. What the direct suite proves is every property the
   fingerprint rests on. Real agreement between independent nodes is the
   integration suite's job, and it has been run: two full rounds reached
   consensus on StudioNet, one on retrievable evidence and one on a
   source that could not be reached. Settlement itself is still covered
   only by the direct suite.

## 9. Frontend security

- **No key material is ever requested, stored or logged.** No seed
  phrase, private key or wallet password appears anywhere in the app,
  including in error paths.
- **EIP-6963 discovery.** `injectedWallet` enumerates wallets that
  announce themselves and the user picks. Nothing touches
  `window.ethereum` directly: with two extensions installed that global
  is whichever won the race, and the user can end up signing from a
  wallet they never chose.
- **Wrong network is surfaced, not silently coerced.** If the connected
  chain is not the configured one, the UI says which chain is connected
  and which is expected, and blocks signing.
- **ACCEPTED is not success.** `revertReason()` inspects the receipt for
  a transaction that was accepted by the network and then reverted, and
  reports the revert reason. Reading acceptance as success is how a
  failed write ends up showing a success toast.
- **No fabricated data.** A missing `NEXT_PUBLIC_CONTRACT_ADDRESS`
  produces a stated error rather than a default address. Unavailable
  values render as `Unavailable`, `Pending` or `Unknown` — never as a
  plausible-looking number.

## 10. Security checklist

Contract:

- [x] authorization enforced on every write
- [x] state transitions enforced, with the illegal move named
- [x] escrow custody tracked separately from terms
- [x] payable amounts read from `gl.message.value`
- [x] zero-value deposits rejected
- [x] exact bond amounts enforced
- [x] all payouts via one transfer helper
- [x] held balance drained before transfer
- [x] state persisted before transfer
- [x] duplicate settlement prevented by the state machine
- [x] payout ≤ deposited funds, asserted twice
- [x] no floating-point money
- [x] no arbitrary transfers — recipients read from storage
- [x] no unsupported storage constructs
- [x] deadlines enforced against the tick clock
- [x] timeout recovery exists (`expire_job`, `recover_escrow`)
- [x] requirements immutable after funding, hash-checked
- [x] evidence freezable, and frozen for every round
- [x] evidence cannot redefine rules
- [x] the model cannot control funds
- [x] verdict schema validated and structurally narrowed
- [x] critical requirements enforced
- [x] `UNVERIFIABLE` explicit, with its own settlement policy
- [x] appeals bounded (`MAX_APPEALS = 1`)

Frontend:

- [x] wallet integration via RainbowKit + Wagmi
- [x] no private key collection
- [x] no seed phrase collection
- [x] EIP-6963-aware discovery
- [x] wrong-network UX
- [x] full transaction lifecycle UX
- [x] rejected-transaction UX distinguished from failure
- [x] failed-transaction UX with the revert reason
- [x] accessible UI — semantic landmarks, focus states, labelled controls
- [x] responsive from 375px
- [x] no fabricated protocol data

## 11. Reporting a vulnerability

Open an issue describing the affected function, the state required to
reach it, and the impact. Do not include private keys, seed phrases or
funded account details in a report.
