"use client";

import Link from "next/link";
import { useJobs } from "@/lib/useVerity";
import { StatusChip, Empty, Mono } from "@/components/ui";
import { formatGen } from "@/lib/format";
import type { JobStatus } from "@/lib/verity";

const TERMINAL: JobStatus[] = ["SETTLED", "CANCELLED", "REFUNDED", "EXPIRED"];

export default function History() {
  const { data: jobs, isLoading, isError } = useJobs();
  const rows = (jobs ?? []).filter((j) => TERMINAL.includes(j.status)).reverse();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
          History
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          Jobs that reached a terminal state. Newest first.
        </p>
      </div>
      <section className="card">
        {isError ? <div className="card-body"><Empty>Unavailable.</Empty></div>
          : isLoading ? <div className="card-body"><Empty>Loading…</Empty></div>
          : rows.length === 0 ? <div className="card-body"><Empty>No completed jobs yet.</Empty></div>
          : (
            <div className="scroll-x">
              <table className="w-full text-sm">
                <caption className="sr-only">Completed jobs</caption>
                <thead className="text-[11px] uppercase tracking-wide text-ink-muted dark:text-night-muted">
                  <tr className="border-b border-canvas-edge dark:border-night-edge">
                    <th scope="col" className="text-left px-4 py-3">Job</th>
                    <th scope="col" className="text-left px-4 py-3">Title</th>
                    <th scope="col" className="text-left px-4 py-3">Agent</th>
                    <th scope="col" className="text-left px-4 py-3">Payment</th>
                    <th scope="col" className="text-left px-4 py-3">Outcome</th>
                    <th scope="col" className="text-right px-4 py-3"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((j) => (
                    <tr key={j.job_id} className="border-b border-canvas-edge dark:border-night-edge last:border-0">
                      <td className="px-4 py-3"><Mono value={j.job_id} chars={9} label="job id" /></td>
                      <td className="px-4 py-3 text-ink dark:text-night-text">{j.title}</td>
                      <td className="px-4 py-3">
                        <Link href={`/passport/${j.agent}`} className="link">
                          <Mono value={j.agent} chars={6} label="agent" />
                        </Link>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{formatGen(j.payment_wei)}</td>
                      <td className="px-4 py-3"><StatusChip status={j.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/jobs/${j.job_id}`} className="link">Open</Link>
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
