"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useJob, useDispute, useEvidence, useVerdicts, useRequirements, useSettlement,
} from "@/lib/useVerity";
import {
  StatusChip, VerdictChip, ResultChip, Mono, Empty, Stat,
} from "@/components/ui";
import { formatGen } from "@/lib/format";

/**
 * §47 — the dispute room makes it obvious WHY each requirement passed or
 * failed, and keeps the two partisan accounts visibly separate from the
 * panel's determination.
 */
export default function DisputeRoom() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const job = useJob(id);
  const dispute = useDispute(id);
  const evidence = useEvidence(id);
  const verdicts = useVerdicts(id);
  const reqs = useRequirements(id);
  const settlement = useSettlement(id);

  if (job.isError) return <Empty>Unavailable — the RPC did not respond.</Empty>;
  if (job.isLoading || !job.data) return <Empty>Loading {id}…</Empty>;
  const j = job.data;
  const d = dispute.data;
  const latest = verdicts.data?.length ? verdicts.data[verdicts.data.length - 1] : null;
  const byId = new Map((reqs.data ?? []).map((r) => [r.id, r]));
  const evById = new Map((evidence.data ?? []).map((e) => [e.receipt_id, e]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Dispute room</div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
            {j.title}
          </h1>
          <div className="mt-1 flex items-center gap-3">
            <Mono value={j.job_id} chars={9} label="job id" />
            <StatusChip status={j.status} />
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/verification/${j.job_id}`} className="btn-ghost">Verification</Link>
          <Link href={`/jobs/${j.job_id}`} className="btn-ghost">Job detail</Link>
        </div>
      </div>

      {!d ? (
        <Empty>No dispute has been opened on this job.</Empty>
      ) : (
        <>
          <section className="card">
            <div className="card-header">Disputed requirements</div>
            <div className="card-body space-y-3">
              {d.disputed_requirements.map((rid) => {
                const r = byId.get(rid);
                const res = latest?.requirements.find((x) => x.id === rid);
                return (
                  <div key={rid}
                       className="rounded-lg border border-canvas-edge dark:border-night-edge p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{rid}</span>
                      {r?.critical && (
                        <span className="chip border-warn/40 bg-warn-soft text-warn">
                          <span aria-hidden="true">!</span>critical
                        </span>
                      )}
                      <span className="chip border-canvas-edge dark:border-night-edge
                                       text-ink-muted dark:text-night-muted">
                        weight {r?.weight ?? "—"}
                      </span>
                      {res
                        ? <ResultChip result={res.result} />
                        : <span className="text-xs text-ink-subtle">Not yet judged</span>}
                    </div>
                    <p className="mt-1.5 text-sm text-ink dark:text-night-text">
                      {r?.description ?? "—"}
                    </p>
                    {res && (
                      <p className="mt-1 text-xs font-mono text-ink-muted dark:text-night-muted">
                        reason: {res.reason_code}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="card">
              <div className="card-header">Requester claim</div>
              <div className="card-body space-y-3 text-sm">
                <p className="text-ink dark:text-night-text">{d.claim}</p>
                <div className="text-xs text-ink-muted dark:text-night-muted">
                  Bond posted: {formatGen(d.bond_wei)} · opened at tick {d.opened_tick}
                </div>
                {!!d.evidence_refs.length && (
                  <div>
                    <div className="label mb-1">Cited evidence</div>
                    <ul className="space-y-1">
                      {d.evidence_refs.map((r) => (
                        <li key={r} className="text-xs">
                          <Mono value={r} chars={10} label="receipt" />
                          {evById.get(r) && (
                            <a href={evById.get(r)!.url} target="_blank" rel="noreferrer"
                               className="link ml-2 font-mono break-all">
                              {evById.get(r)!.url}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-ink-subtle">
                  A partisan account from an interested party, not a finding.
                </p>
              </div>
            </section>

            <section className="card">
              <div className="card-header">Agent response</div>
              <div className="card-body space-y-3 text-sm">
                {d.agent_responded_tick === 0 ? (
                  <Empty>The agent has not responded yet.</Empty>
                ) : (
                  <>
                    <p className="text-ink dark:text-night-text">{d.agent_response}</p>
                    <div className="text-xs text-ink-muted dark:text-night-muted">
                      Responded at tick {d.agent_responded_tick}
                    </div>
                    {!!d.agent_counter_refs.length && (
                      <div>
                        <div className="label mb-1">Counter-evidence</div>
                        <ul className="space-y-1">
                          {d.agent_counter_refs.map((r) => (
                            <li key={r} className="text-xs">
                              <Mono value={r} chars={10} label="receipt" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[11px] text-ink-subtle">
                      Also partisan. The panel weighs retrieved sources above both accounts.
                    </p>
                  </>
                )}
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-header flex flex-wrap items-center gap-2">
              <span>Adjudication</span>
              {latest && <VerdictChip verdict={latest.verdict} />}
            </div>
            <div className="card-body">
              {!latest ? (
                <Empty>
                  No verdict yet. Evidence must be frozen, then a GenLayer adjudication run.
                </Empty>
              ) : (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-4 gap-6">
                    <Stat label="Score" value={`${latest.score}/100`} />
                    <Stat label="Evidence quality" value={latest.evidence_quality} />
                    <Stat label="Rounds" value={String(verdicts.data?.length ?? 0)} />
                    <Stat label="Escrow held" value={formatGen(j.escrow_held)} />
                  </div>
                  <p className="text-sm text-ink dark:text-night-text">{latest.reasoning}</p>
                  {!!latest.fraud_flags.length && (
                    <div className="text-xs text-bad">
                      Fraud flags: {latest.fraud_flags.join(", ")}
                    </div>
                  )}
                  {settlement.data && (
                    <div className="pt-3 border-t border-canvas-edge dark:border-night-edge
                                    grid sm:grid-cols-3 gap-6">
                      <Stat label="Policy" value={settlement.data.policy_applied} />
                      <Stat label="Agent" value={formatGen(settlement.data.agent_payout)} />
                      <Stat label="Requester" value={formatGen(settlement.data.requester_payout)} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
