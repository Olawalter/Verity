"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAccount } from "wagmi";
import { Lock, Snowflake, Scale } from "lucide-react";
import {
  useJob, useRequirements, useEvidence, useDispute, useVerdicts,
  useSettlement, useVerity, useRefreshJob,
} from "@/lib/useVerity";
import {
  StatusChip, VerdictChip, ResultChip, Mono, Stat, Banner, TxLifecycle, Empty,
} from "@/components/ui";
import { formatGen, genToWei } from "@/lib/format";
import type { TxPhase, EvidenceRole, Independence } from "@/lib/verity";

export default function JobDetail() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const { address } = useAccount();
  const { client, wrongNetwork } = useVerity();
  const refresh = useRefreshJob(id);

  const job = useJob(id);
  const reqs = useRequirements(id);
  const ev = useEvidence(id);
  const dispute = useDispute(id);
  const verdicts = useVerdicts(id);
  const settlement = useSettlement(id);

  const [phase, setPhase] = useState<TxPhase>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    if (!client) return;
    setBusy(label); setErr(null); setNote(null); setPhase("idle");
    client.onPhase = (p) => setPhase(p);
    try {
      await fn();
      setNote(`${label} — finalized`);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (job.isError) return <Empty>Job unavailable — the RPC did not respond.</Empty>;
  if (job.isLoading || !job.data) return <Empty>Loading {id}…</Empty>;

  const j = job.data;
  const me = address?.toLowerCase();
  const isRequester = !!me && me === j.requester.toLowerCase();
  const isAgent = !!me && me === j.agent.toLowerCase();
  const isParty = isRequester || isAgent;
  const latest = verdicts.data?.length ? verdicts.data[verdicts.data.length - 1] : null;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="card"><div className="card-body flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="label">Job</div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
            {j.title}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm
                          text-ink-muted dark:text-night-muted">
            <Mono value={j.job_id} chars={9} label="job id" />
            <span>·</span>
            <span>{j.requirement_count} requirements</span>
            {j.terms_locked && (
              <span className="inline-flex items-center gap-1 text-ok">
                <Lock className="w-3 h-3" aria-hidden="true" /> terms locked
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="label">Payment</div>
          <div className="text-2xl font-semibold tabular-nums text-ink dark:text-night-text">
            {formatGen(j.payment_wei)}
          </div>
          <div className="mt-2"><StatusChip status={j.status} /></div>
        </div>
      </div></div>

      {(err || note || busy) && (
        <div className="space-y-2">
          {err && <Banner kind="error" onDismiss={() => setErr(null)}>{err}</Banner>}
          {!err && note && <Banner kind="success" onDismiss={() => setNote(null)}>{note}</Banner>}
          {busy && !err && <Banner kind="info">{busy}…</Banner>}
          <TxLifecycle phase={phase} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* parties + terms */}
          <section className="card">
            <div className="card-header">Agreement</div>
            <div className="card-body space-y-4 text-sm">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="label">Requester</div>
                  <div className="mt-1"><Mono value={j.requester} chars={8} label="requester" /></div>
                  {isRequester && <div className="text-[11px] text-ok mt-0.5">✓ this is you</div>}
                </div>
                <div>
                  <div className="label">Designated agent</div>
                  <div className="mt-1"><Mono value={j.agent} chars={8} label="agent" /></div>
                  {isAgent && <div className="text-[11px] text-ok mt-0.5">✓ this is you</div>}
                </div>
              </div>
              <div>
                <div className="label">Description</div>
                <p className="mt-1 text-ink dark:text-night-text">{j.description}</p>
              </div>
              <div>
                <div className="label">Evidence rules</div>
                <p className="mt-1 text-ink-muted dark:text-night-muted">
                  {j.evidence_rules || "—"}
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <div className="label">Constitution hash</div>
                  <div className="mt-1"><Mono value={j.constitution_hash} chars={10} label="constitution hash" /></div>
                </div>
                <div>
                  <div className="label">Settlement policy</div>
                  <div className="mt-1 text-xs text-ink-muted dark:text-night-muted">
                    VERIFIED {j.settlement.verified} · PARTIAL {j.settlement.partial} ·
                    FAILED {j.settlement.failed} · UNVERIFIABLE {j.settlement.unverifiable}
                    <br />critical → {j.settlement.critical}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* requirements */}
          <section className="card">
            <div className="card-header">Requirements</div>
            <div className="scroll-x">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-ink-muted dark:text-night-muted">
                  <tr className="border-b border-canvas-edge dark:border-night-edge">
                    <th scope="col" className="text-left px-4 py-2">ID</th>
                    <th scope="col" className="text-left px-4 py-2">Requirement</th>
                    <th scope="col" className="text-left px-4 py-2">Type</th>
                    <th scope="col" className="text-right px-4 py-2">Weight</th>
                    <th scope="col" className="text-left px-4 py-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(reqs.data ?? []).map((r) => {
                    const res = latest?.requirements.find((x) => x.id === r.id);
                    return (
                      <tr key={r.id} className="border-b border-canvas-edge dark:border-night-edge last:border-0">
                        <td className="px-4 py-2 font-mono text-xs">
                          {r.id}
                          {r.critical && (
                            <span className="ml-1.5 chip border-warn/40 bg-warn-soft text-warn">
                              <span aria-hidden="true">!</span>critical
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-ink dark:text-night-text">{r.description}</td>
                        <td className="px-4 py-2 text-xs text-ink-muted dark:text-night-muted">{r.type}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.weight}</td>
                        <td className="px-4 py-2">
                          {res ? <ResultChip result={res.result} />
                               : <span className="text-xs text-ink-subtle">Not yet judged</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* evidence */}
          <section className="card">
            <div className="card-header flex items-center justify-between">
              <span>Evidence ({ev.data?.length ?? 0})</span>
              {j.evidence_frozen_at > 0 && (
                <span className="chip border-warn/40 bg-warn-soft text-warn">
                  <Snowflake className="w-3 h-3" aria-hidden="true" />
                  frozen at tick {j.evidence_frozen_at}
                </span>
              )}
            </div>
            <div className="card-body space-y-3">
              {!ev.data?.length ? <Empty>No evidence registered yet.</Empty> : ev.data.map((e) => (
                <div key={e.receipt_id}
                     className="rounded-lg border border-canvas-edge dark:border-night-edge p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <Mono value={e.receipt_id} chars={10} label="receipt id" />
                    <div className="flex items-center gap-1.5">
                      <span className="chip border-canvas-edge dark:border-night-edge
                                       text-ink-muted dark:text-night-muted">
                        {e.evidence_role}
                      </span>
                      <span className="chip border-canvas-edge dark:border-night-edge
                                       text-ink-muted dark:text-night-muted">
                        {e.requirement_id}
                      </span>
                    </div>
                  </div>
                  <a href={e.url} target="_blank" rel="noreferrer"
                     className="link block mt-2 font-mono text-xs break-all">{e.url}</a>
                  {e.captured_summary && (
                    <p className="mt-1.5 text-ink-muted dark:text-night-muted">{e.captured_summary}</p>
                  )}
                  {/* §11/§13 — say plainly that these are assertions */}
                  <div className="mt-2 grid sm:grid-cols-2 gap-1 text-[11px]
                                  text-ink-muted dark:text-night-muted">
                    <div>Claimed hash · <Mono value={e.claimed_content_hash} chars={6} label="claimed hash" /></div>
                    <div>Claimed independence · {e.claimed_independence}</div>
                    <div>Source · {e.source_host || "—"}</div>
                    <div>Submitted by · {e.submitted_by.toLowerCase() === j.agent.toLowerCase() ? "agent" : "requester"}</div>
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-subtle">
                    These are submitter assertions. Validators retrieve the URL themselves
                    during adjudication; nothing here is verified by the contract.
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* verdicts */}
          {!!verdicts.data?.length && (
            <section className="card">
              <div className="card-header">Verdict history</div>
              <div className="card-body space-y-4">
                {verdicts.data.map((v) => (
                  <div key={v.verdict_id}
                       className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink dark:text-night-text">
                        Round {v.round_number}
                      </span>
                      <VerdictChip verdict={v.verdict} />
                      <span className="chip border-canvas-edge dark:border-night-edge
                                       text-ink-muted dark:text-night-muted">
                        score {v.score}/100
                      </span>
                      {v.critical_failed && (
                        <span className="chip border-bad/40 bg-bad-soft text-bad">
                          <span aria-hidden="true">!</span>critical failed
                        </span>
                      )}
                      <span className="chip border-canvas-edge dark:border-night-edge
                                       text-ink-muted dark:text-night-muted">
                        evidence {v.evidence_quality}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ink dark:text-night-text">{v.reasoning}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {v.requirements.map((r) => (
                        <span key={r.id} className="chip border-canvas-edge dark:border-night-edge
                                                    text-ink-muted dark:text-night-muted">
                          {r.id} {r.result} · {r.reason_code}
                        </span>
                      ))}
                    </div>
                    {!!v.fraud_flags.length && (
                      <div className="mt-2 text-xs text-bad">
                        Fraud flags: {v.fraud_flags.join(", ")}
                      </div>
                    )}
                    {!!v.unverifiable_items.length && (
                      <div className="mt-1 text-xs text-warn">
                        Unverifiable: {v.unverifiable_items.join(", ")}
                      </div>
                    )}
                    <details className="mt-2">
                      <summary className="text-[11px] text-ink-subtle cursor-pointer">
                        Raw panel JSON
                      </summary>
                      <pre className="mt-2 scroll-x text-[11px] p-3 rounded-lg
                                      bg-canvas-sunken dark:bg-night-sunken max-h-64">{v.raw_json}</pre>
                    </details>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* sidebar */}
        <div className="space-y-6">
          <section className="card">
            <div className="card-header">Escrow</div>
            <div className="card-body space-y-4">
              <Stat label="Held in contract" value={formatGen(j.escrow_held)} />
              <dl className="space-y-2 text-xs">
                <Row label="Payment deposited" value={formatGen(j.payment_deposited)} />
                <Row label="Agent bond" value={formatGen(j.agent_bond_deposited)} />
                <Row label="Dispute bond" value={formatGen(j.dispute_bond_deposited)} />
                <Row label="Released" value={formatGen(j.total_released)} />
              </dl>
              {settlement.data && (
                <div className="pt-3 border-t border-canvas-edge dark:border-night-edge space-y-2 text-xs">
                  <div className="label">Settlement · {settlement.data.policy_applied}</div>
                  <Row label="Agent payout" value={formatGen(settlement.data.agent_payout)} />
                  <Row label="Requester payout" value={formatGen(settlement.data.requester_payout)} />
                  <Row label="Score" value={`${settlement.data.score}/100`} />
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <div className="card-header">Timeline</div>
            <div className="card-body">
              <Timeline j={j} />
            </div>
          </section>

          <section className="card">
            <div className="card-header">Actions</div>
            <div className="card-body space-y-2">
              {!isParty && (
                <Empty>You are a visitor on this job. Only the requester and the designated agent can act.</Empty>
              )}
              {wrongNetwork && <Banner kind="error">Wrong network.</Banner>}
              <Actions
                j={j} isRequester={isRequester} isAgent={isAgent}
                busy={!!busy} run={run} client={client}
                evidenceIds={(ev.data ?? []).map((e) => e.receipt_id)}
                requirementIds={(reqs.data ?? []).map((r) => r.id)}
              />
            </div>
          </section>

          <Link href={`/verification/${j.job_id}`} className="btn-ghost w-full">
            <Scale className="w-4 h-4" aria-hidden="true" /> Verification room
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted dark:text-night-muted">{label}</dt>
      <dd className="tabular-nums text-ink dark:text-night-text">{value}</dd>
    </div>
  );
}

/** §45/§46 — real contract ticks, never fabricated progress. */
function Timeline({ j }: { j: import("@/lib/verity").Job }) {
  const steps: [string, number][] = [
    ["Created", j.created_tick],
    ["Funded", j.funded_tick],
    ["Accepted", j.accepted_tick],
    ["Submitted", j.submitted_tick],
    ["Dispute opened", j.dispute_opened_tick],
    ["Evidence frozen", j.evidence_frozen_at],
    ["Adjudication started", j.adjudication_started_tick],
    ["Verdict", j.verdict_tick],
    ["Finalized", j.finalized_tick],
    ["Settled", j.settled_tick],
  ];
  return (
    <ol className="space-y-2 text-sm">
      {steps.map(([label, tick]) => (
        <li key={label} className="flex items-center gap-2">
          <span aria-hidden="true" className={tick > 0 ? "text-ok" : "text-ink-subtle"}>
            {tick > 0 ? "✓" : "○"}
          </span>
          <span className={tick > 0 ? "text-ink dark:text-night-text" : "text-ink-subtle"}>
            {label}
          </span>
          <span className="ml-auto text-xs tabular-nums text-ink-muted dark:text-night-muted">
            {tick > 0 ? `tick ${tick}` : "—"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Actions(props: {
  j: import("@/lib/verity").Job;
  isRequester: boolean; isAgent: boolean; busy: boolean;
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  client: import("@/lib/verity").VerityClient | null;
  evidenceIds: string[]; requirementIds: string[];
}) {
  const { j, isRequester, isAgent, busy, run, client } = props;
  const [planHash, setPlanHash] = useState("");
  const [uri, setUri] = useState("");
  const [dhash, setDhash] = useState("");
  const [claim, setClaim] = useState("");
  const [disputed, setDisputed] = useState<string[]>([]);
  const [response, setResponse] = useState("");
  const [grounds, setGrounds] = useState("");
  const [evReq, setEvReq] = useState(props.requirementIds[0] ?? "R1");
  const [evUrl, setEvUrl] = useState("");
  const [evRole, setEvRole] = useState<EvidenceRole>("DELIVERABLE");
  const [evIndep, setEvIndep] = useState<Independence>("UNKNOWN");
  if (!client) return null;
  const s = j.status;

  return (
    <div className="space-y-2 text-sm">
      {s === "DRAFT" && isRequester && (
        <>
          <button className="btn-primary w-full" disabled={busy}
                  onClick={() => run("Fund job", () => client.fundJob(j.job_id, BigInt(String(j.payment_wei))))}>
            Fund {formatGen(j.payment_wei)} — locks terms
          </button>
          <button className="btn-ghost w-full" disabled={busy}
                  onClick={() => run("Cancel job", () => client.cancelJob(j.job_id))}>Cancel</button>
        </>
      )}
      {s === "FUNDED" && isRequester && (
        <button className="btn-ghost w-full" disabled={busy}
                onClick={() => run("Cancel job", () => client.cancelJob(j.job_id))}>Cancel &amp; refund</button>
      )}
      {s === "FUNDED" && isAgent && (
        <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
          <summary className="label cursor-pointer">Accept job</summary>
          <input className="input mt-2 font-mono text-xs" placeholder="execution plan hash (optional)"
                 value={planHash} onChange={(e) => setPlanHash(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-muted dark:text-night-muted">
            A commitment, not a new acceptance criterion — only the locked constitution decides the outcome.
          </p>
          <button className="btn-primary w-full mt-2" disabled={busy}
                  onClick={() => run("Accept job",
                    () => client.acceptJob(j.job_id, planHash, BigInt(String(j.agent_bond_wei))))}>
            Accept {BigInt(String(j.agent_bond_wei)) > BigInt(0)
              ? `+ ${formatGen(j.agent_bond_wei)} bond` : ""}
          </button>
        </details>
      )}

      {(s === "ACTIVE" || s === "SUBMITTED" || s === "DISPUTED") && (isRequester || isAgent) && (
        <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
          <summary className="label cursor-pointer">Register evidence</summary>
          <div className="mt-2 space-y-2">
            <select className="input" value={evReq} onChange={(e) => setEvReq(e.target.value)}
                    aria-label="Requirement">
              {props.requirementIds.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input className="input font-mono text-xs" placeholder="https://…"
                   value={evUrl} onChange={(e) => setEvUrl(e.target.value)} aria-label="Evidence URL" />
            <div className="grid grid-cols-2 gap-2">
              <select className="input" value={evRole} aria-label="Evidence role"
                      onChange={(e) => setEvRole(e.target.value as EvidenceRole)}>
                {["DELIVERABLE", "SUPPORTING", "COUNTER", "REFERENCE"].map((r) =>
                  <option key={r} value={r}>{r}</option>)}
              </select>
              <select className="input" value={evIndep} aria-label="Claimed independence"
                      onChange={(e) => setEvIndep(e.target.value as Independence)}>
                {["UNKNOWN", "INDEPENDENT", "RELATED", "SAME_ORIGIN"].map((r) =>
                  <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <button className="btn-primary w-full" disabled={busy || !evUrl.trim()}
                    onClick={() => run("Register evidence", () => client.submitEvidence(j.job_id, {
                      requirementId: evReq, url: evUrl.trim(),
                      claimedContentHash: "sha256:unverified", contentType: "text/html",
                      sourceHost: (() => { try { return new URL(evUrl).host; } catch { return ""; } })(),
                      sourceIdentity: "", evidenceRole: evRole,
                      claimedIndependence: evIndep, capturedSummary: "",
                    }))}>Register</button>
          </div>
        </details>
      )}

      {s === "ACTIVE" && isAgent && (
        <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
          <summary className="label cursor-pointer">Submit deliverable</summary>
          <input className="input mt-2 font-mono text-xs" placeholder="deliverable URI"
                 value={uri} onChange={(e) => setUri(e.target.value)} />
          <input className="input mt-2 font-mono text-xs" placeholder="deliverable hash"
                 value={dhash} onChange={(e) => setDhash(e.target.value)} />
          <button className="btn-primary w-full mt-2" disabled={busy || !uri.trim() || !dhash.trim()}
                  onClick={() => run("Submit deliverable",
                    () => client.submitDeliverable(j.job_id, uri.trim(), dhash.trim()))}>Submit</button>
        </details>
      )}

      {s === "SUBMITTED" && isRequester && (
        <>
          <button className="btn-primary w-full" disabled={busy}
                  onClick={() => run("Accept work", () => client.acceptWork(j.job_id))}>
            Accept work — pays agent in full
          </button>
          <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
            <summary className="label cursor-pointer">Dispute</summary>
            <p className="mt-2 text-[11px] text-ink-muted dark:text-night-muted">
              Name the requirements you say failed. A dispute must be specific.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {props.requirementIds.map((r) => (
                <label key={r} className="text-xs flex items-center gap-1.5">
                  <input type="checkbox" checked={disputed.includes(r)}
                         onChange={(e) => setDisputed((p) =>
                           e.target.checked ? [...p, r] : p.filter((x) => x !== r))} />
                  {r}
                </label>
              ))}
            </div>
            <textarea className="textarea mt-2" placeholder="What specifically failed?"
                      value={claim} onChange={(e) => setClaim(e.target.value)} />
            <button className="btn-danger w-full mt-2"
                    disabled={busy || !disputed.length || !claim.trim()}
                    onClick={() => run("Open dispute", () => client.openDispute(
                      j.job_id, disputed, claim.trim(), [],
                      BigInt(String(j.dispute_bond_wei))))}>
              Open dispute {BigInt(String(j.dispute_bond_wei)) > BigInt(0)
                ? `+ ${formatGen(j.dispute_bond_wei)} bond` : ""}
            </button>
          </details>
        </>
      )}

      {s === "DISPUTED" && isAgent && (
        <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
          <summary className="label cursor-pointer">Respond to dispute</summary>
          <textarea className="textarea mt-2" value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    placeholder="Answer the specific disputed requirements." />
          <button className="btn-primary w-full mt-2" disabled={busy || !response.trim()}
                  onClick={() => run("Respond",
                    () => client.respondToDispute(j.job_id, response.trim(), []))}>Respond</button>
        </details>
      )}

      {s === "DISPUTED" && (isRequester || isAgent) && (
        <button className="btn-primary w-full" disabled={busy}
                onClick={() => run("Freeze evidence", () => client.freezeEvidence(j.job_id))}>
          <Snowflake className="w-4 h-4" aria-hidden="true" /> Freeze evidence
        </button>
      )}

      {(s === "EVIDENCE_FROZEN" || s === "APPEALED") && (isRequester || isAgent) && (
        <button className="btn-primary w-full" disabled={busy}
                onClick={() => run("GenLayer adjudication", () => client.adjudicate(j.job_id))}>
          Run GenLayer adjudication
        </button>
      )}

      {s === "VERDICT" && (isRequester || isAgent) && (
        <>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={busy}
                    onClick={() => run("Tick", () => client.tick())}>Tick</button>
            <button className="btn-primary flex-1" disabled={busy}
                    onClick={() => run("Finalize verdict", () => client.finalizeVerdict(j.job_id))}>
              Finalize
            </button>
          </div>
          {j.appeal_count < 1 && (
            <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
              <summary className="label cursor-pointer">Appeal (one only)</summary>
              <textarea className="textarea mt-2" value={grounds}
                        onChange={(e) => setGrounds(e.target.value)}
                        placeholder="New admissible evidence, or a specific adjudication error." />
              <button className="btn-ghost w-full mt-2" disabled={busy || !grounds.trim()}
                      onClick={() => run("Appeal", () => client.appeal(j.job_id, grounds.trim()))}>
                Appeal
              </button>
            </details>
          )}
        </>
      )}

      {(s === "ACCEPTED" || s === "FINALIZED") && (isRequester || isAgent) && (
        <button className="btn-primary w-full" disabled={busy}
                onClick={() => run("Settle", () => client.settle(j.job_id))}>
          Settle escrow
        </button>
      )}

      {(s === "EXPIRED" || s === "VERDICT" || s === "FINALIZED") && (isRequester || isAgent) && (
        <details className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
          <summary className="label cursor-pointer">Recover escrow</summary>
          <p className="mt-2 text-[11px] text-ink-muted dark:text-night-muted">
            Only for a job that cannot settle normally — an expired job, or a verdict
            whose policy is HUMAN_REVIEW.
          </p>
          <button className="btn-ghost w-full mt-2" disabled={busy}
                  onClick={() => run("Recover escrow", () => client.recoverEscrow(j.job_id))}>
            Recover
          </button>
        </details>
      )}

      {s === "ACTIVE" && (isRequester || isAgent) && (
        <button className="btn-ghost w-full" disabled={busy}
                onClick={() => run("Expire job", () => client.expireJob(j.job_id))}>
          Mark expired
        </button>
      )}
    </div>
  );
}
