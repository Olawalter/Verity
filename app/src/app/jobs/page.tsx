"use client";

import Link from "next/link";
import { useJobs } from "@/lib/useVerity";
import { Empty } from "@/components/ui";
import { JobTable } from "../dashboard/page";

export default function JobsPage() {
  const { data: jobs, isLoading, isError } = useJobs();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
            Jobs
          </h1>
          <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
            Every job on the contract. Public and enumerable.
          </p>
        </div>
        <Link href="/jobs/create" className="btn-primary">Create job</Link>
      </div>

      <section className="card">
        {isError ? (
          <div className="card-body"><Empty>Job list unavailable — the RPC did not respond.</Empty></div>
        ) : isLoading || !jobs ? (
          <div className="card-body"><Empty>Loading…</Empty></div>
        ) : jobs.length === 0 ? (
          <div className="card-body"><Empty>No jobs on this contract yet.</Empty></div>
        ) : (
          <JobTable rows={jobs} />
        )}
      </section>
    </div>
  );
}
