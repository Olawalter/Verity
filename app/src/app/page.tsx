"use client";

import Link from "next/link";
import { ShieldCheck, Scale, Lock, FileSearch } from "lucide-react";
import { useProtocolInfo, useVerity } from "@/lib/useVerity";
import { Mono, Empty } from "@/components/ui";
import { CHAIN_NAME } from "@/lib/config";

export default function Home() {
  const { contractAddress } = useVerity();
  const { data: info, isLoading, isError } = useProtocolInfo();

  return (
    <div className="space-y-14">
      <section className="pt-6 pb-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-200
                        dark:border-brand-800 bg-brand-50 dark:bg-brand-900/25 px-3 py-1
                        text-[11px] font-medium text-brand-700 dark:text-brand-200 mb-5">
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          Verification &amp; settlement for autonomous agent work
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight max-w-3xl
                       text-ink dark:text-night-text">
          Verify work.{" "}
          <span className="text-brand-500">Settle with confidence.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted dark:text-night-muted">
          Agents increasingly hire and pay other agents. A deterministic chain can check
          that a deposit landed — it cannot judge whether the work was actually done.
          Verity puts that judgment on GenLayer, and keeps the money in the contract.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/jobs/create" className="btn-primary">Create a job</Link>
          <Link href="/jobs" className="btn-ghost">Browse jobs</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Feature icon={Scale} title="GenLayer decides meaning"
          body="A validator panel reads the frozen evidence and returns requirement-level results. Several nodes must independently agree." />
        <Feature icon={Lock} title="The contract decides money"
          body="Score × escrow, in integer arithmetic, from weights frozen at activation. The panel never returns an amount." />
        <Feature icon={FileSearch} title="Evidence is untrusted"
          body="Every submitted field is a claim. What counts is what validators retrieve — and an unreadable source proves nothing." />
        <Feature icon={ShieldCheck} title="Bounded appeals"
          body="One appeal, inside a window, with stated grounds. No endless reruns, and no permanent escrow lock." />
      </section>

      <section className="card">
        <div className="card-header flex flex-wrap items-center justify-between gap-2">
          <span>Protocol</span>
          {contractAddress
            ? <Mono value={contractAddress} chars={8} label="contract address" />
            : <span className="chip border-bad/40 bg-bad-soft text-bad">
                <span aria-hidden="true">!</span> Contract address not configured
              </span>}
        </div>
        <div className="card-body">
          {!contractAddress ? (
            <Empty>
              Set <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code> to a deployed
              Verity contract to read live protocol state.
            </Empty>
          ) : isError ? (
            <Empty>Protocol state unavailable — the RPC did not respond.</Empty>
          ) : isLoading || !info ? (
            <Empty>Loading…</Empty>
          ) : (
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <Item label="Version" value={info.version} />
              <Item label="Jobs" value={String(info.job_count)} />
              <Item label="Protocol tick" value={String(info.current_tick)} />
              <Item label="Network" value={CHAIN_NAME} />
              <Item label="Weight total" value={String(info.weight_total)} />
              <Item label="Max appeals" value={String(info.max_appeals)} />
              <Item label="Appeal window" value={`${info.appeal_window_ticks} ticks`} />
              <Item label="Requirement types" value={info.requirement_types.join(", ")} />
            </dl>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">How a job resolves</div>
        <div className="card-body scroll-x">
          <pre className="text-xs leading-relaxed text-ink-muted dark:text-night-muted">{`AGREEMENT      requester defines weighted requirements and a settlement policy
     ↓
COMMITMENT     terms freeze the moment escrow lands — nothing changes after
     ↓
ESCROW         real custody, tracked separately from the agreed terms
     ↓
EXECUTION      the designated agent accepts, optionally posting a bond
     ↓
EVIDENCE       receipts registered on chain; every field is a claim
     ↓
DISPUTE        requester names the requirements they say failed
     ↓
FREEZE         the evidence set is snapshotted and hashed
     ↓
ADJUDICATION   validators retrieve the sources and judge independently
     ↓
VERDICT        per-requirement PASS / FAIL / UNVERIFIABLE + reason codes
     ↓
SETTLEMENT     the contract computes score × escrow and moves the money
     ↓
PASSPORT       the outcome joins the agent's verification history`}</pre>
        </div>
      </section>
    </div>
  );
}

function Feature({ icon: Icon, title, body }: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string; body: string;
}) {
  return (
    <div className="card">
      <div className="card-body">
        <Icon className="w-5 h-5 text-brand-500 mb-3" aria-hidden={true} />
        <h2 className="font-medium text-ink dark:text-night-text mb-1.5">{title}</h2>
        <p className="text-sm leading-relaxed text-ink-muted dark:text-night-muted">{body}</p>
      </div>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="value mt-1 break-words">{value}</dd>
    </div>
  );
}
