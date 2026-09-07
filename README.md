# Verity

> A GenLayer-native verification and settlement protocol for autonomous
> agent work.
>
> **Verify what agents promise.**

---

## The problem

Agents increasingly hire, pay, and work for other agents. A deterministic
smart contract can verify a great deal:

- wallet addresses, token deposits, deadlines, signatures, hashes,
  contract state, whether a required transaction occurred.

It cannot answer the question that actually decides most agreements:

- *Did the agent actually complete the work?*
- *Does the deliverable satisfy the agreed acceptance criteria?*
- *Does the evidence support the claim?*
- *Are two sources genuinely independent, or the same wire story twice?*

Verity splits deterministic enforcement from decentralized judgment:

```
GenLayer determines MEANING.        The contract determines CONSEQUENCES.

per-requirement PASS / FAIL /       score = Σ weight of passed requirements
  UNVERIFIABLE                      payout = escrow × score ÷ 100
evidence quality                    who receives it, and when
fraud flags
```

The adjudicating panel returns requirement-level results against an
immutable constitution. It never returns an amount, a percentage, a
recipient, or a weight — and that is a property of the code, not a
policy: `_normalize_verdict` returns a fixed key set, so a verdict
carrying `agent_payout: 999999999` is not rejected, it is simply never
read. There is no code path from model output to money.

## Why GenLayer is the native core

Everything except the judgment could run on any chain. The judgment
cannot: it needs a model to read unstructured evidence, and it needs
several independent parties to agree on what that evidence shows.

`adjudicate()` runs `gl.vm.run_nondet_unsafe` with a custom validator.
Leader **and every validator** independently retrieve the same evidence
URLs, run the same prompt, normalise with the same code, and compare
decision fingerprints. A validator does not inspect the leader's answer
for well-formedness and call that verification — it produces its own
verdict. Agreement means several nodes reading the same evidence reached
the same determinations.

## Lifecycle

```
DRAFT ──fund──► FUNDED ──accept──► ACTIVE ──submit──► SUBMITTED
  │                │                  │                   │
  │                │                  └──expire──►EXPIRED │
  └─cancel─►CANCELLED                                      │
                                        ┌──────────────────┴──────────────┐
                                     accept_work                     open_dispute
                                        │                                 │
                                    ACCEPTED                          DISPUTED
                                        │                                 │
                                        │                        freeze_evidence
                                        │                                 │
                                        │                         EVIDENCE_FROZEN
                                        │                                 │
                                        │                          adjudicate
                                        │                                 │
                                        │                             VERDICT
                                        │                        ┌────────┴────────┐
                                        │                     appeal          finalize
                                        │                        │                 │
                                        │                    APPEALED         FINALIZED
                                        │                        │                 │
                                        │                  adjudicate              │
                                        └───────────────────┬────────────────────┬─┘
                                                         settle              recover_escrow
                                                            │                    │
                                                        SETTLED              REFUNDED
```

`VERDICT` is **not** `FINALIZED`. A verdict accepted by consensus is not
yet spendable; it becomes spendable only after the appeal window has
actually elapsed. `final_verdict_id` pins which verdict settlement pays
on, so a later round cannot redirect an already-final payout.

## Verification constitution

Every job carries a machine-readable constitution, frozen at funding:

```json
{
  "requirements": [
    { "id": "R1", "description": "Issue is actually resolved",
      "type": "JUDGMENT", "weight": 30, "critical": true }
  ],
  "settlement": {
    "verified": "FULL", "partial": "PROPORTIONAL",
    "failed": "REFUND", "unverifiable": "HUMAN_REVIEW",
    "critical": "FAIL_JOB"
  }
}
```

Requirement types:

| Type | Meaning |
|---|---|
| `DETERMINISTIC` | the contract itself could check it — a hash exists, a deadline held |
| `EVIDENCE` | external information is required — a CI result, a diff |
| `JUDGMENT` | semantic interpretation is required — *does this actually fix the issue?* |

Weights are integers summing to exactly 100. The model may never
redefine a weight, a payout percentage, a settlement policy, or the
critical-requirement policy. It determines results **under** the
constitution.

## Settlement

```
score          = Σ weight[r] for every requirement marked PASS
policy         = constitution[verdict]     (critical failure may override)
FULL           → agent takes the payment
PROPORTIONAL   → agent takes payment × score ÷ 100, requester the rest
REFUND         → requester takes the payment
HUMAN_REVIEW   → nothing settles; escrow waits for recover_escrow
```

The spec's worked example, and a passing test:

```
escrow 100 GEN · R1 PASS 30 · R2 PASS 25 · R3 PASS 20
                 R4 FAIL 10 · R5 FAIL 10 · R6 PASS  5
score 80 → agent 80 GEN, requester 20 GEN, escrow 0
```

Integer arithmetic throughout; no float touches a weight or an amount.
Rounding remainders go to the **requester**, because `requester_payout`
is computed by subtraction — the party owed a refund is never short by a
rounding artefact.

What must match across validators is the *determination*, so the
fingerprint is a narrow projection: `job_id`, the verdict, each
requirement's `(id, result)`, and `unverifiable_items`. The rule, learned
by watching live rounds fail:

> **Require agreement on everything that has a consequence, and only on
> that.**

`reasoning`, `reason_code`, `evidence_quality` and `fraud_flags` are all
recorded on the verdict and shown in the UI, and none of them is read by
`_compute_settlement`, `_resolve_policy`, the score, or any state
transition. Two direct tests prove it by swapping them and showing the
payout is byte-identical. Demanding that independent nodes agree on a
field that cannot move a wei only loses rounds.

## Escrow

Custody and terms are separate fields, and settlement reads custody:

```
payment_wei          agent_bond_wei          dispute_bond_wei        ← TERMS
payment_deposited    agent_bond_deposited    dispute_bond_deposited  ← MONEY
```

`fund_job` is `@gl.public.write.payable` and records `gl.message.value`,
the figure the chain actually moved. All value leaves through one helper,
`_send_gen`, on three paths only — `settle`, `cancel_job`,
`recover_escrow` — and every one follows:

```
read ledgers → validate → compute → ZERO ledgers → persist → emit transfer
```

Bonds return to whoever posted them. A requester who disputes and loses
is **not** punished, and an agent who merely underperforms is **not**
slashed — bad faith needs explicit criteria, and ordinary task failure is
not misconduct.

## Evidence

Every field a submitter provides is a **claim**, and the record names it
as one: `claimed_content_hash`, `claimed_independence`. The contract
verifies none of it. What establishes anything is retrieval during
adjudication, where validators fetch the URL themselves and each outcome
is classified:

| Label | Carries content? |
|---|---|
| `FETCH_SUCCESS` | **yes** |
| `NON_SUCCESS_RESPONSE` | no — an error page is not the document |
| `EMPTY_CONTENT` | no |
| `FETCH_FAILURE` | no |

> **unavailable evidence ≠ verified evidence**

Unread is also not the same as *refuted*. If every source filed against
a requirement failed to return `FETCH_SUCCESS`, the answer is
`UNVERIFIABLE`, never `FAIL` — absence of proof is not proof of absence,
and the two settle very differently: `FAIL` scores zero, `UNVERIFIABLE`
sends the job to human review with the escrow untouched.

Source independence is a verification property, not a URL-counting
trick: two hosts republishing one origin are not two independent sources.
The submitter declares `INDEPENDENT | RELATED | SAME_ORIGIN | UNKNOWN`;
the panel judges the claim from what it retrieved.

When a dispute opens, `freeze_evidence` snapshots and hashes the set.
After that nothing is admissible, and the panel reads the frozen
snapshot.

External text is **data, never instructions**. The prompt says so, and a
source that appears to contain directions is flagged rather than obeyed.

## Quick start

```bash
pip install -r requirements.txt
genvm-lint check contracts/verity.py       # lint
pytest tests/direct/ -v                    # 90 tests, ~80s

cd app && npm install
npm run typecheck && npm run build
npm run dev                                # http://localhost:3120
```

Deploy:

```bash
genlayer network set studionet
genlayer deploy --contract contracts/verity.py
genlayer schema <address>
```

Then set `NEXT_PUBLIC_CONTRACT_ADDRESS` in `app/.env.local`.

## Live deployment

- Network: **GenLayer StudioNet** (chain id 61999)
- Contract: `0xf1443Af9A2c708E09BeA2EAbcD608502c016Dc2c`
- Deploy tx: `0xce903a4d168c69220fa9b638a266ec58846060b6339cac2d360d1b0ed6a0b031`
- Consensus on deploy: 5 validators, 5 AGREE
- Runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`
- Source sha256: `7db00c085cb9d6eaf443182b71c75436b594549e7f5a7396d175f7803e2ea9eb`

The address is a claim until someone checks it, so the check ships with
the repository:

```bash
genlayer code 0xf1443Af9A2c708E09BeA2EAbcD608502c016Dc2c > onchain.py
python scripts/verify_deployment.py onchain.py
# MATCH   sha256 7db00c085cb9d6eaf443182b71c75436b594549e7f5a7396d175f7803e2ea9eb
```

That comparison was run against this deployment and matched.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ADDRESS` | **yes** | deployed Verity contract; without it the app reads nothing and says so |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | no | overrides the SDK's default RPC |
| `NEXT_PUBLIC_EXPLORER_URL` | no | block explorer base URL |
| `NEXT_PUBLIC_DEPLOY_ENV` | no | label shown in Settings |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | no | enables WalletConnect; injected wallets work without it |

## Routes

```
/                    landing + live protocol state
/dashboard           your jobs, escrow held, awaiting review, disputed
/jobs                every job on the contract
/jobs/create         five-step wizard: agreement → requirements →
                     evidence rules → settlement → review & fund
/jobs/[id]           agreement, requirements, evidence, verdicts,
                     escrow, timeline, and every legal action
/disputes            open disputes
/disputes/[id]       disputed requirements, requester claim, agent
                     response, adjudication, settlement
/verification        jobs under or past adjudication
/verification/[id]   progress sequence, frozen evidence, verdict
/passport/[address]  an agent's evidence-backed verification history
/history             terminal jobs
/settings            effective configuration, read from the running app
```

## Testing

```
genvm-lint check      passes — 28 methods (10 view, 18 write)
pytest tests/direct   104 passed
gltest tests/integr.  6 passed on StudioNet, real panel  (9m30s)
tsc --noEmit          clean
next build            clean, 12 routes
```

Direct tests cover agreements, escrow (including the §62 adversarial
payout sequences), evidence and freezing, disputes, verdict validation
and LLM failure modes, settlement policy mapping, critical-requirement
override, UNVERIFIABLE handling, appeals, the passport, and the
equivalence rules that decide what can reach consensus.

`tests/integration/` drives a **real panel on StudioNet** — no mocks. Two
of the five tests run a full round in which leader and validators each
retrieve the evidence themselves, each run the prompt, and each compare
decision fingerprints:

- **consensus on retrievable evidence** — accept → submit evidence →
  deliver → dispute → freeze → adjudicate. The panel agreed, a verdict
  was stored, and the contract's own score matched the weighted sum of
  the requirements it marked PASS. Escrow stayed held: a verdict is not
  a payout.
- **unreachable evidence does not pass** — the same flow against a
  domain that cannot resolve. Both requirements came back exactly
  `UNVERIFIABLE`, the verdict was `UNVERIFIABLE`, the score was 0, and
  the escrow did not move. The test demands `UNVERIFIABLE` specifically
  rather than accepting `FAIL` as well: tolerating either answer is
  tolerating the ambiguity that splits validators.

- **settlement moves real balances** — the whole arc, carried past the
  verdict. Settling straight from `VERDICT` is refused; the appeal
  window is ticked closed; `finalize_verdict` pins `final_verdict_id`;
  then `settle` runs to **FINALIZED**, because payouts emit
  `on="finalized"`. The panel returned VERIFIED / score 100, the
  constitution maps that to FULL, and the agent's on-chain balance rose
  by exactly the escrowed 2 GEN. The expected figure is derived
  independently from the frozen weights and the panel's determinations,
  so the test does not simply agree with whatever the contract computed.

Plus three on-chain checks with no panel: the live protocol vocabulary,
funding recording real custody and locking terms (refused with
`[EXPECTED] illegal transition from FUNDED`), and cancellation returning
escrow.

Running it needs two funded accounts — see
[DEVELOPMENT.md](./DEVELOPMENT.md#3-testing).

Further reading: [ARCHITECTURE.md](./ARCHITECTURE.md) ·
[SECURITY.md](./SECURITY.md) · [DEVELOPMENT.md](./DEVELOPMENT.md)

## Known limitations

Stated plainly rather than left implicit.

- **The clock is a tick counter, not a wall clock.**
  `gl.message.datetime` is not populated in every runtime this contract
  must work in, and a deadline that silently reads zero is worse than one
  that is explicitly abstract. Deadlines are absolute tick values, and
  `tick()` is public so any account can age one forward. Consequence:
  deadlines advance with protocol activity rather than elapsed time.
- **Content hashes are not verified.** A `claimed_content_hash` is never
  compared against retrieved bytes. The guarantee is *"validators read
  the real source"*, not *"the hash matched"*. The field is named as a
  claim so the UI and the panel both treat it as one.
- **Direct mode runs the leader only.** Validator agreement is exercised
  by the shared normaliser and fingerprint — those functions *are* the
  equivalence rule — and on a live network.
- **Retrieval outcomes can legitimately differ between validators.** A
  source reachable for one node and not another produces different inputs
  and can break a round. That is correct behaviour, but a flaky source
  costs rounds.
- **Panel capture is out of scope.** A compromised validator majority can
  agree on a false verdict; that is GenLayer's trust model. The bounded
  appeal exists so a bad round can be contested once.
- **The appeal path is proven in direct tests only.** `appeal` and a
  second adjudication round are covered offline; the live suite settles
  on a first-round verdict. Nothing about the appeal changes the payout
  arithmetic — `final_verdict_id` pins which verdict pays either way —
  but it has not been driven through a live panel twice.
- **A live round depends on sources being reachable from every node.**
  Both panel tests passed on the first attempt, but a flaky source
  produces different inputs for different validators and can legitimately
  break a round. That is correct behaviour, not a bug — it just costs a
  round.
