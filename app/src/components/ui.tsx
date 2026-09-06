"use client";

import { useState } from "react";
import { Check, Copy, AlertCircle, CircleDot, Circle, CircleCheck, X } from "lucide-react";
import type { JobStatus, VerdictValue, RequirementResult, TxPhase } from "@/lib/verity";
import { truncate } from "@/lib/format";

/* §59 — status is never colour alone: every chip carries a glyph too. */

const JOB_CHIP: Record<JobStatus, [string, string]> = {
  DRAFT:              ["○", "border-canvas-edge dark:border-night-edge text-ink-muted dark:text-night-muted"],
  FUNDED:             ["◆", "border-brand-200 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"],
  ACTIVE:             ["▸", "border-info-400/40 bg-info-500/10 text-info-600 dark:text-info-400"],
  SUBMITTED:          ["▣", "border-info-400/40 bg-info-500/10 text-info-600 dark:text-info-400"],
  ACCEPTED:           ["✓", "border-ok/30 bg-ok-soft text-ok dark:bg-ok/15"],
  DISPUTED:           ["!", "border-bad/30 bg-bad-soft text-bad dark:bg-bad/15"],
  EVIDENCE_FROZEN:    ["❄", "border-warn/30 bg-warn-soft text-warn dark:bg-warn/15"],
  ADJUDICATING:       ["◐", "border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"],
  VERDICT:            ["⚖", "border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"],
  APPEALED:           ["↺", "border-warn/30 bg-warn-soft text-warn dark:bg-warn/15"],
  FINAL_ADJUDICATION: ["◑", "border-brand-300 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200"],
  FINALIZED:          ["✓", "border-ok/30 bg-ok-soft text-ok dark:bg-ok/15"],
  SETTLED:            ["✓", "border-ok/40 bg-ok-soft text-ok dark:bg-ok/20"],
  CANCELLED:          ["✕", "border-canvas-edge dark:border-night-edge text-ink-muted dark:text-night-muted"],
  EXPIRED:            ["⏱", "border-warn/30 bg-warn-soft text-warn dark:bg-warn/15"],
  REFUNDED:           ["↩", "border-canvas-edge dark:border-night-edge text-ink-muted dark:text-night-muted"],
};

export function StatusChip({ status }: { status: JobStatus }) {
  const [glyph, cls] = JOB_CHIP[status] ?? ["○", "border-canvas-edge text-ink-muted"];
  return (
    <span className={`chip ${cls}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>{status.replace(/_/g, " ")}</span>
    </span>
  );
}

const VERDICT_CHIP: Record<VerdictValue, [string, string]> = {
  VERIFIED:     ["✓", "border-ok/40 bg-ok-soft text-ok dark:bg-ok/20"],
  PARTIAL:      ["◐", "border-warn/40 bg-warn-soft text-warn dark:bg-warn/20"],
  FAILED:       ["✕", "border-bad/40 bg-bad-soft text-bad dark:bg-bad/20"],
  UNVERIFIABLE: ["?", "border-canvas-edge dark:border-night-edge text-ink-muted dark:text-night-muted"],
};

export function VerdictChip({ verdict }: { verdict: VerdictValue }) {
  const [glyph, cls] = VERDICT_CHIP[verdict];
  return (
    <span className={`chip ${cls}`}>
      <span aria-hidden="true">{glyph}</span><span>{verdict}</span>
    </span>
  );
}

const RESULT_CHIP: Record<RequirementResult, [string, string]> = {
  PASS:         ["✓", "border-ok/40 bg-ok-soft text-ok dark:bg-ok/20"],
  FAIL:         ["✕", "border-bad/40 bg-bad-soft text-bad dark:bg-bad/20"],
  UNVERIFIABLE: ["?", "border-canvas-edge dark:border-night-edge text-ink-muted dark:text-night-muted"],
};

export function ResultChip({ result }: { result: RequirementResult }) {
  const [glyph, cls] = RESULT_CHIP[result];
  return (
    <span className={`chip ${cls}`}>
      <span aria-hidden="true">{glyph}</span><span>{result}</span>
    </span>
  );
}

/** §57 — long identifiers readable, with a copy control. */
export function Mono({ value, chars = 6, label }: {
  value: string; chars?: number; label?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-ink-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="font-mono text-xs" title={value}>{truncate(value, chars)}</code>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
            () => {},
          );
        }}
        className="text-ink-subtle hover:text-brand-600 rounded p-0.5"
        aria-label={`Copy ${label || "value"}`}
      >
        {copied
          ? <Check className="w-3 h-3" aria-hidden="true" />
          : <Copy className="w-3 h-3" aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">{copied ? "Copied" : ""}</span>
    </span>
  );
}

/** §68 — an unavailable value says so; it is never a fabricated zero. */
export function Stat({ label, value, hint, tone }: {
  label: string; value: React.ReactNode; hint?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneCls = tone === "ok" ? "text-ok"
    : tone === "warn" ? "text-warn"
    : tone === "bad" ? "text-bad"
    : "text-ink dark:text-night-text";
  return (
    <div>
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted dark:text-night-muted">{hint}</div>}
    </div>
  );
}

/** §55 — human-readable, dismissible, announced to screen readers. */
export function Banner({ kind, children, onDismiss }: {
  kind: "info" | "error" | "success"; children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const map = {
    info:    ["border-brand-200 bg-brand-50 text-brand-800 dark:bg-brand-900/25 dark:text-brand-100", CircleDot],
    error:   ["border-bad/30 bg-bad-soft text-bad dark:bg-bad/15", AlertCircle],
    success: ["border-ok/30 bg-ok-soft text-ok dark:bg-ok/15", CircleCheck],
  } as const;
  const [cls, Icon] = map[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"}
         className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${cls}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded p-0.5">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * §51 — the real transaction lifecycle. Never shows a success state
 * before the actual transaction state supports it.
 */
const PHASES: { key: TxPhase; label: string }[] = [
  { key: "wallet",     label: "Wallet" },
  { key: "submitted",  label: "Submitted" },
  { key: "pending",    label: "Pending" },
  { key: "finalizing", label: "Finalizing" },
  { key: "finalized",  label: "Finalized" },
];

export function TxLifecycle({ phase }: { phase: TxPhase }) {
  if (phase === "idle") return null;
  if (phase === "rejected" || phase === "failed") {
    return (
      <div className="mt-2 text-xs font-medium text-bad">
        {phase === "rejected"
          ? "Rejected in wallet — nothing was sent."
          : "Transaction failed. No state changed."}
      </div>
    );
  }
  const idx = PHASES.findIndex((p) => p.key === phase);
  return (
    <ol className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
        aria-label="Transaction progress">
      {PHASES.map((p, i) => {
        const done = idx > i;
        const now = idx === i;
        return (
          <li key={p.key} className="flex items-center gap-1.5">
            {done ? <CircleCheck className="w-3 h-3 text-ok" aria-hidden="true" />
              : now ? <CircleDot className="w-3 h-3 text-brand-500" aria-hidden="true" />
              : <Circle className="w-3 h-3 text-ink-subtle" aria-hidden="true" />}
            <span className={done ? "text-ok" : now ? "text-brand-600 font-medium"
                                                     : "text-ink-subtle"}>
              {p.label}
            </span>
            {i < PHASES.length - 1 && <span className="text-ink-subtle" aria-hidden="true">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-ink-muted dark:text-night-muted py-6">{children}</div>;
}
