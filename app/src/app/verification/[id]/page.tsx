"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useJob, useVerdicts, useEvidence, useSettlement } from "@/lib/useVerity";
import { VerdictChip, ResultChip, Mono, Empty, Stat } from "@/components/ui";
import { formatGen } from "@/lib/format";
import type { Job } from "@/lib/verity";

/**
 * §46 — the verification room shows ACTUAL contract state.
 *
 * Nothing here fabricates validator counts, consensus percentages, AI
 * confidence, or a finality the contract has not reached. Each step is
 * derived from a tick the contract itself recorded.
 */
export default function VerificationRoom() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const job = useJob(id);
  const verdicts = useVerdicts(id);
  const evidence = useEvidence(id);
  const settlement = useSettlement(id);

  if (job.isError) return <Empty>Unavailable — the RPC did not respond.</Empty>;
  if (job.isLoading || !job.data) return <Empty>Loading {id}…</Empty>;
  const j = job.data;
  const latest = verdicts.data?.length ? verdicts.data[verdicts.data.length - 1] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Verification room</div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
            {j.title}
          </h1>
          <div className="mt-1"><Mono value={j.job_id} chars={9} label="job id" /></div>
        </div>
        <Link href={`/jobs/${j.job_id}`} className="btn-ghost">Job detail</Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <section className="card lg:col-span-1">
          <div className="card-header">Progress</div>
          <div className="card-body">
            <Sequence j={j} />
            <p className="mt-4 text-[11px] text-ink-muted dark:text-night-muted">
              Each step reflects a tick recorded by the contract. Validator counts and
              consensus percentages are not exposed by the protocol, so this room does
              not display them.
            </p>
          </div>
        </section>

        <section className="card lg:col-span-2">
          <div className="card-header">Frozen evidence</div>
          <div className="card-body space-y-3">
            {j.evidence_frozen_at === 0 ? (
              <Empty>Evidence is not frozen yet. The panel reads a frozen snapshot only.</Empty>
            ) : (
              <>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="label">Snapshot hash</div>
                    <div className="mt-1">
                      <Mono value={j.evidence_snapshot_hash} chars={10} label="snapshot hash" />
                    </div>
                  </div>
                  <div>
                    <div className="label">Frozen at</div>
                    <div className="mt-1 value">tick {j.evidence_frozen_at}</div>
                  </div>
                </div>
                <ul className="space-y-2">
                  {(evidence.data ?? []).map((e) => (
                    <li key={e.receipt_id}
                        className="rounded-lg border border-canvas-edge dark:border-night-edge p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Mono value={e.receipt_id} chars={10} label="receipt" />
                        <span className="chip border-canvas-edge dark:border-night-edge
                                         text-ink-muted dark:text-night-muted">
                          {e.requirement_id} · {e.evidence_role}
                        </span>
                      </div>
                      <a href={e.url} target="_blank" rel="noreferrer"
                         className="link block mt-1 font-mono text-xs break-all">{e.url}</a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>

      {latest && (
        <section className="card">
          <div className="card-header flex flex-wrap items-center gap-2">
            <span>Verdict</span>
            <VerdictChip verdict={latest.verdict} />
            <span className="chip border-canvas-edge dark:border-night-edge
                             text-ink-muted dark:text-night-muted">
              round {latest.round_number} of {verdicts.data?.length}
            </span>
          </div>
          <div className="card-body space-y-4">
            <div className="grid sm:grid-cols-3 gap-6">
              <Stat label="Score" value={`${latest.score}/100`}
                    hint="derived by the contract from frozen weights" />
              <Stat label="Evidence quality" value={latest.evidence_quality} />
              <Stat label="Critical failure"
                    value={latest.critical_failed ? "Yes" : "No"}
                    tone={latest.critical_failed ? "bad" : "ok"} />
            </div>

            {/* §47 — make it obvious WHY each requirement passed or failed */}
            <div className="scroll-x">
              <table className="w-full text-sm">
                <caption className="sr-only">Requirement results</caption>
                <thead className="text-[11px] uppercase tracking-wide
                                  text-ink-muted dark:text-night-muted">
                  <tr className="border-b border-canvas-edge dark:border-night-edge">
                    <th scope="col" className="text-left px-3 py-2">Requirement</th>
                    <th scope="col" className="text-left px-3 py-2">Result</th>
                    <th scope="col" className="text-left px-3 py-2">Reason code</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.requirements.map((r) => (
                    <tr key={r.id} className="border-b border-canvas-edge dark:border-night-edge last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{r.id}</td>
                      <td className="px-3 py-2"><ResultChip result={r.result} /></td>
                      <td className="px-3 py-2 font-mono text-xs
                                     text-ink-muted dark:text-night-muted">{r.reason_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div className="label">Panel reasoning</div>
              <p className="mt-1 text-sm text-ink dark:text-night-text">{latest.reasoning}</p>
              <p className="mt-1 text-[11px] text-ink-subtle">
                Explanatory only. Consensus compares the structured fields above, never prose.
              </p>
            </div>

            {settlement.data && (
              <div className="pt-4 border-t border-canvas-edge dark:border-night-edge
                              grid sm:grid-cols-3 gap-6">
                <Stat label="Policy applied" value={settlement.data.policy_applied} />
                <Stat label="Agent payout" value={formatGen(settlement.data.agent_payout)} />
                <Stat label="Requester payout" value={formatGen(settlement.data.requester_payout)} />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Sequence({ j }: { j: Job }) {
  const steps: [string, boolean, boolean][] = [
    ["Agreement", j.created_tick > 0, false],
    ["Escrow funded", j.funded_tick > 0, false],
    ["Agent committed", j.accepted_tick > 0, false],
    ["Work submitted", j.submitted_tick > 0, false],
    ["Evidence frozen", j.evidence_frozen_at > 0, false],
    ["Adjudication", j.verdict_tick > 0, j.status === "ADJUDICATING"],
    ["Finality", j.finalized_tick > 0, j.status === "VERDICT"],
    ["Settlement", j.settled_tick > 0, j.status === "FINALIZED"],
  ];
  return (
    <ol className="space-y-2.5 text-sm">
      {steps.map(([label, done, active]) => (
        <li key={label} className="flex items-center gap-2.5">
          <span aria-hidden="true"
                className={done ? "text-ok" : active ? "text-brand-500" : "text-ink-subtle"}>
            {done ? "✓" : active ? "●" : "○"}
          </span>
          <span className={done ? "text-ink dark:text-night-text"
                : active ? "text-brand-600 dark:text-brand-300 font-medium"
                : "text-ink-subtle"}>
            {label}
          </span>
          <span className="sr-only">
            {done ? "complete" : active ? "in progress" : "not started"}
          </span>
        </li>
      ))}
    </ol>
  );
}
