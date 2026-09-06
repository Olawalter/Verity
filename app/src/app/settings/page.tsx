"use client";

import { useAccount } from "wagmi";
import { useProtocolInfo, useVerity } from "@/lib/useVerity";
import { WALLETCONNECT_AVAILABLE } from "@/lib/providers";
import { Mono, Empty, Banner } from "@/components/ui";
import {
  CHAIN_ID, CHAIN_NAME, CHAIN_RPC, EXPLORER, DEPLOY_ENV, getRpcUrl,
} from "@/lib/config";

export default function Settings() {
  const { address, chainId, isConnected } = useAccount();
  const { contractAddress, wrongNetwork } = useVerity();
  const { data: info } = useProtocolInfo();

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
          Settings
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          Effective configuration. Everything here is read from the running app, not assumed.
        </p>
      </div>

      <section className="card">
        <div className="card-header">Network</div>
        <div className="card-body">
          <dl className="grid sm:grid-cols-2 gap-4 text-sm">
            <Row label="Name" value={CHAIN_NAME} />
            <Row label="Chain ID" value={String(CHAIN_ID)} mono />
            <Row label="RPC" value={getRpcUrl()} mono />
            <Row label="Default RPC" value={CHAIN_RPC} mono />
            <Row label="Explorer" value={EXPLORER || "Not configured"} mono />
            <Row label="Deploy environment" value={DEPLOY_ENV} />
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-header">Contract</div>
        <div className="card-body space-y-3">
          {!contractAddress ? (
            <Banner kind="error">
              <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code> is not set.
              The app cannot read any protocol state without it.
            </Banner>
          ) : (
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="label">Address</dt>
                <dd className="mt-1"><Mono value={contractAddress} chars={10} label="contract" /></dd>
              </div>
              <Row label="Protocol version" value={info?.version ?? "Loading…"} />
              <Row label="Jobs on contract" value={info ? String(info.job_count) : "Loading…"} />
              <Row label="Protocol tick" value={info ? String(info.current_tick) : "Loading…"} />
            </dl>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">Wallet</div>
        <div className="card-body space-y-3 text-sm">
          {!isConnected ? (
            <Empty>No wallet connected.</Empty>
          ) : (
            <dl className="grid sm:grid-cols-2 gap-4">
              <div>
                <dt className="label">Address</dt>
                <dd className="mt-1"><Mono value={address!} chars={10} label="wallet" /></dd>
              </div>
              <Row label="Connected chain" value={String(chainId ?? "Unknown")} mono />
            </dl>
          )}
          {wrongNetwork && (
            <Banner kind="error">
              Connected to chain {chainId}, but this app targets {CHAIN_NAME} ({CHAIN_ID}).
              Switch networks before signing.
            </Banner>
          )}
          {!WALLETCONNECT_AVAILABLE && (
            <Banner kind="info">
              WalletConnect is not configured — set{" "}
              <code className="font-mono">NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code> to
              enable it. Injected wallets (MetaMask, Rabby, Trust, Coinbase and others
              that announce over EIP-6963) work without it.
            </Banner>
          )}
          <p className="text-[11px] text-ink-subtle">
            Verity never asks for a seed phrase, private key or wallet password, and never
            stores or logs one.
          </p>
        </div>
      </section>

      {info && (
        <section className="card">
          <div className="card-header">Protocol vocabulary</div>
          <div className="card-body">
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <Row label="Requirement types" value={info.requirement_types.join(", ")} />
              <Row label="Requirement results" value={info.requirement_results.join(", ")} />
              <Row label="Verdicts" value={info.verdicts.join(", ")} />
              <Row label="Settlement policies" value={info.settlement_policies.join(", ")} />
              <Row label="Evidence roles" value={info.evidence_roles.join(", ")} />
              <Row label="Independence classes" value={info.independence_classes.join(", ")} />
              <Row label="Retrieval labels" value={info.retrieval_labels.join(", ")} />
              <Row label="Evidence quality" value={info.evidence_quality_grades.join(", ")} />
              <Row label="Fraud flags" value={info.fraud_flags.join(", ")} />
              <Row label="Max appeals" value={String(info.max_appeals)} />
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
