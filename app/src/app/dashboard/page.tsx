"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { useJobs } from "@/lib/useVerity";
import { Stat, StatusChip, Empty, Mono } from "@/components/ui";
import { formatGen } from "@/lib/format";
import type { JobRow, JobStatus } from "@/lib/verity";

const ACTIVE: JobStatus[] = [
  "FUNDED", "ACTIVE", "SUBMITTED", "DISPUTED", "EVIDENCE_FROZEN",
  "ADJUDICATING", "VERDICT", "APPEALED", "FINAL_ADJUDICATION", "FINALIZED",
];
const AWAITING: JobStatus[] = ["SUBMITTED"];
const DISPUTED: JobStatus[] = [
  "DISPUTED", "EVIDENCE_FROZEN", "ADJUDICATING", "VERDICT", "APPEALED",
  "FINAL_ADJUDICATION",
];
const HOLDING: JobStatus[] = [...ACTIVE, "EXPIRED"];

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const { data: jobs, isLoading, isError } = useJobs();

  if (!isConnected) {
    return (
      <Empty>Connect a wallet to see the jobs you are party to.</Empty>
    );
  }
  if (isError) return <Empty>Job list unavailable — the RPC did not respond.</Empty>;
  if (isLoading || !jobs) return <Empty>Loading…</Empty>;

  const me = address!.toLowerCase();
  const mine = jobs.filter(
    (j) => j.requester.toLowerCase() === me || j.agent.toLowerCase() === me);

  const count = (set: JobStatus[]) => mine.filter((j) => set.includes(j.status)).length;
  const escrow = mine
    .filter((j) => HOLDING.includes(j.status))
    .reduce((a, j) => a + BigInt(String(j.escrow_held)), BigInt(0));
  const verifiedValue = mine
    .filter((j) => j.status === "SETTLED")
    .reduce((a, j) => a + BigInt(String(j.payment_wei)), BigInt(0));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
          Overview
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          Jobs where you are the requester or the designated agent.
        </p>
      </div>

      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="card"><div className="card-body">
          <Stat label="Active jobs" value={count(ACTIVE)} />
        </div></div>
        <div className="card"><div className="card-body">
          <Stat label="Awaiting review" value={count(AWAITING)}
                hint="submitted, not yet accepted or disputed" />
        </div></div>
        <div className="card"><div className="card-body">
          <Stat label="Disputed" value={count(DISPUTED)}
                tone={count(DISPUTED) > 0 ? "warn" : undefined} />
        </div></div>
        <div className="card"><div className="card-body">
          <Stat label="Escrow held" value={formatGen(escrow)}
                hint="real custody across your open jobs" />
        </div></div>
      </section>

      <section className="card">
        <div className="card-header flex items-center justify-between">
          <span>Your jobs</span>
          <Link href="/jobs/create" className="text-xs text-brand-600 dark:text-brand-300">
            + new job
          </Link>
        </div>
        {mine.length === 0 ? (
          <div className="card-body">
            <Empty>
              No jobs yet — you are neither requester nor agent on any job on this contract.
            </Empty>
          </div>
        ) : (
          <JobTable rows={mine} me={me} />
        )}
      </section>

      <section className="card">
        <div className="card-header">Settled value</div>
        <div className="card-body">
          <Stat label="Total payment settled" value={formatGen(verifiedValue)}
                hint="sum of job payments that reached SETTLED" />
        </div>
      </section>
    </div>
  );
}

export function JobTable({ rows, me }: { rows: JobRow[]; me?: string }) {
  return (
    <div className="scroll-x">
      <table className="w-full text-sm">
        <caption className="sr-only">Jobs</caption>
        <thead className="text-[11px] uppercase tracking-wide text-ink-muted dark:text-night-muted">
          <tr className="border-b border-canvas-edge dark:border-night-edge">
            <th scope="col" className="text-left px-4 py-3">Job</th>
            <th scope="col" className="text-left px-4 py-3">Title</th>
            {me && <th scope="col" className="text-left px-4 py-3">Your role</th>}
            <th scope="col" className="text-left px-4 py-3">Payment</th>
            <th scope="col" className="text-left px-4 py-3">Escrow</th>
            <th scope="col" className="text-left px-4 py-3">Status</th>
            <th scope="col" className="text-right px-4 py-3">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.job_id} className="border-b border-canvas-edge dark:border-night-edge last:border-0">
              <td className="px-4 py-3"><Mono value={j.job_id} chars={9} label="job id" /></td>
              <td className="px-4 py-3 text-ink dark:text-night-text">{j.title}</td>
              {me && (
                <td className="px-4 py-3 text-ink-muted dark:text-night-muted">
                  {j.requester.toLowerCase() === me ? "Requester" : "Agent"}
                </td>
              )}
              <td className="px-4 py-3 tabular-nums">{formatGen(j.payment_wei)}</td>
              <td className="px-4 py-3 tabular-nums text-ink-muted dark:text-night-muted">
                {formatGen(j.escrow_held)}
              </td>
              <td className="px-4 py-3"><StatusChip status={j.status} /></td>
              <td className="px-4 py-3 text-right">
                <Link href={`/jobs/${j.job_id}`} className="link">Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
