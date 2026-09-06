"use client";

import Link from "next/link";
import { useJobs } from "@/lib/useVerity";
import { StatusChip, Empty, Mono } from "@/components/ui";
import { formatGen } from "@/lib/format";
import type { JobStatus } from "@/lib/verity";

const DISPUTED: JobStatus[] = [
  "DISPUTED", "EVIDENCE_FROZEN", "ADJUDICATING", "VERDICT",
  "APPEALED", "FINAL_ADJUDICATION",
];

export default function Disputes() {
  const { data: jobs, isLoading, isError } = useJobs();
  const rows = (jobs ?? []).filter((j) => DISPUTED.includes(j.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
          Disputes
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          Jobs where a requester named specific requirements as failed.
        </p>
      </div>

      <section className="card">
        {isError ? (
          <div className="card-body"><Empty>Unavailable — the RPC did not respond.</Empty></div>
        ) : isLoading ? (
          <div className="card-body"><Empty>Loading…</Empty></div>
        ) : rows.length === 0 ? (
          <div className="card-body"><Empty>No open disputes.</Empty></div>
        ) : (
          <div className="scroll-x">
            <table className="w-full text-sm">
              <caption className="sr-only">Disputed jobs</caption>
              <thead className="text-[11px] uppercase tracking-wide text-ink-muted dark:text-night-muted">
                <tr className="border-b border-canvas-edge dark:border-night-edge">
                  <th scope="col" className="text-left px-4 py-3">Job</th>
                  <th scope="col" className="text-left px-4 py-3">Title</th>
                  <th scope="col" className="text-left px-4 py-3">Escrow</th>
                  <th scope="col" className="text-left px-4 py-3">Rounds</th>
                  <th scope="col" className="text-left px-4 py-3">Status</th>
                  <th scope="col" className="text-right px-4 py-3"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((j) => (
                  <tr key={j.job_id} className="border-b border-canvas-edge dark:border-night-edge last:border-0">
                    <td className="px-4 py-3"><Mono value={j.job_id} chars={9} label="job id" /></td>
                    <td className="px-4 py-3 text-ink dark:text-night-text">{j.title}</td>
                    <td className="px-4 py-3 tabular-nums">{formatGen(j.escrow_held)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {j.latest_verdict_id}{j.appeal_count > 0 ? " (appealed)" : ""}
                    </td>
                    <td className="px-4 py-3"><StatusChip status={j.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/disputes/${j.job_id}`} className="link">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
