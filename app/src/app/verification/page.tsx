"use client";

import Link from "next/link";
import { useJobs } from "@/lib/useVerity";
import { StatusChip, Empty, Mono } from "@/components/ui";
import type { JobStatus } from "@/lib/verity";

const IN_VERIFICATION: JobStatus[] = [
  "EVIDENCE_FROZEN", "ADJUDICATING", "VERDICT", "APPEALED",
  "FINAL_ADJUDICATION", "FINALIZED",
];

export default function VerificationIndex() {
  const { data: jobs, isLoading, isError } = useJobs();
  const rows = (jobs ?? []).filter((j) => IN_VERIFICATION.includes(j.status));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
          Verification
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          Jobs whose evidence is frozen and under, or past, GenLayer adjudication.
        </p>
      </div>
      <section className="card">
        {isError ? <div className="card-body"><Empty>Unavailable.</Empty></div>
          : isLoading ? <div className="card-body"><Empty>Loading…</Empty></div>
          : rows.length === 0 ? <div className="card-body"><Empty>Nothing in verification.</Empty></div>
          : (
            <ul className="divide-y divide-canvas-edge dark:divide-night-edge">
              {rows.map((j) => (
                <li key={j.job_id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <Mono value={j.job_id} chars={9} label="job id" />
                  <span className="text-ink dark:text-night-text">{j.title}</span>
                  <StatusChip status={j.status} />
                  <Link href={`/verification/${j.job_id}`} className="link ml-auto">Room</Link>
                </li>
              ))}
            </ul>
          )}
      </section>
    </div>
  );
}
