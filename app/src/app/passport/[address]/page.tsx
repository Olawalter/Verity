"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { usePassport, useJobs } from "@/lib/useVerity";
import { Stat, StatusChip, Mono, Empty } from "@/components/ui";
import { formatGen, pct, orUnknown } from "@/lib/format";

/**
 * §48 — an agent's verification history, evidence-backed.
 *
 * Deliberately NOT a single opaque reputation number: each figure is a
 * count the contract recorded at settlement, and every one of them links
 * back to the jobs that produced it. Where there is no history, the page
 * says "Unavailable" rather than inventing a 0% (§68).
 */
export default function Passport() {
  const params = useParams<{ address: string }>();
  const agent = String(params?.address || "");
  const { data: p, isLoading, isError } = usePassport(agent);
  const { data: jobs } = useJobs();

  const agentJobs = (jobs ?? []).filter(
    (j) => j.agent.toLowerCase() === agent.toLowerCase());

  if (isError) return <Empty>Passport unavailable — the RPC did not respond.</Empty>;
  if (isLoading || !p) return <Empty>Loading…</Empty>;

  const decided = p.jobs_verified + p.jobs_partial + p.jobs_failed + p.jobs_unverifiable;

  return (
    <div className="space-y-6">
      <div>
        <div className="label">Agent passport</div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text
                       font-mono break-all">
          {agent}
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          Every figure below is a count the contract recorded at settlement.
        </p>
      </div>

      {decided === 0 ? (
        <div className="card"><div className="card-body">
          <Empty>
            No settled jobs for this address yet. Nothing is inferred from an empty history.
          </Empty>
        </div></div>
      ) : (
        <>
          <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card><Stat label="Verified" value={p.jobs_verified} tone="ok" /></Card>
            <Card><Stat label="Partial" value={p.jobs_partial} tone="warn" /></Card>
            <Card><Stat label="Failed" value={p.jobs_failed}
                        tone={p.jobs_failed > 0 ? "bad" : undefined} /></Card>
            <Card><Stat label="Unverifiable" value={p.jobs_unverifiable} /></Card>
          </section>

          <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card>
              <Stat label="Average score"
                    value={orUnknown(p.average_score, "/100")}
                    hint={`across ${p.scored_jobs} scored jobs`} />
            </Card>
            <Card>
              <Stat label="Dispute rate" value={pct(p.dispute_rate_bps)}
                    hint={`${p.disputes_faced} of ${decided} decided`} />
            </Card>
            <Card>
              <Stat label="Critical failures" value={p.critical_failures}
                    tone={p.critical_failures > 0 ? "bad" : "ok"} />
            </Card>
            <Card>
              <Stat label="Appeals won" value={p.appeals_won} />
            </Card>
          </section>

          <section className="card">
            <div className="card-body">
              <Stat label="Verified value settled to this agent"
                    value={formatGen(p.verified_value_wei)}
                    hint="sum of agent payouts across settled jobs" />
            </div>
          </section>
        </>
      )}

      <section className="card">
        <div className="card-header">Jobs as agent ({agentJobs.length})</div>
        {agentJobs.length === 0 ? (
          <div className="card-body"><Empty>No jobs assigned to this address.</Empty></div>
        ) : (
          <ul className="divide-y divide-canvas-edge dark:divide-night-edge">
            {agentJobs.map((j) => (
              <li key={j.job_id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <Mono value={j.job_id} chars={9} label="job id" />
                <span className="text-ink dark:text-night-text">{j.title}</span>
                <span className="tabular-nums text-ink-muted dark:text-night-muted">
                  {formatGen(j.payment_wei)}
                </span>
                <StatusChip status={j.status} />
                <Link href={`/jobs/${j.job_id}`} className="link ml-auto">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card"><div className="card-body">{children}</div></div>;
}
