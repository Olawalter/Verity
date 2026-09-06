"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2, Lock } from "lucide-react";
import { useVerity } from "@/lib/useVerity";
import { genToWei, formatGen } from "@/lib/format";
import { Banner, TxLifecycle } from "@/components/ui";
import type {
  RequirementType, SettlementPolicy, TxPhase,
} from "@/lib/verity";

type Draft = {
  id: string; description: string; type: RequirementType;
  weight: number; critical: boolean;
  verification_method: string; evidence_requirements: string;
};

// §9 — the MVP coding-agent scenario, pre-filled but fully editable.
const SEED: Draft[] = [
  { id: "R1", description: "Issue is actually resolved", type: "JUDGMENT",
    weight: 30, critical: true,
    verification_method: "Read the linked PR against the issue",
    evidence_requirements: "PR URL and issue URL" },
  { id: "R2", description: "Regression test added", type: "EVIDENCE",
    weight: 25, critical: false,
    verification_method: "Inspect the diff for a new test",
    evidence_requirements: "Diff or test file URL" },
  { id: "R3", description: "Existing tests pass", type: "EVIDENCE",
    weight: 20, critical: false,
    verification_method: "Read the CI run", evidence_requirements: "CI run URL" },
  { id: "R4", description: "PR references issue", type: "DETERMINISTIC",
    weight: 10, critical: false,
    verification_method: "Search the PR body for the issue reference",
    evidence_requirements: "PR URL" },
  { id: "R5", description: "No unrelated changes", type: "JUDGMENT",
    weight: 10, critical: false,
    verification_method: "Review the diff scope", evidence_requirements: "Diff URL" },
  { id: "R6", description: "Documentation updated", type: "EVIDENCE",
    weight: 5, critical: false,
    verification_method: "Check the docs diff", evidence_requirements: "Docs URL" },
];

const STEPS = ["Agreement", "Requirements", "Evidence rules", "Settlement", "Review & fund"];

export default function CreateJob() {
  const router = useRouter();
  const { client, isConnected, wrongNetwork, contractAddress } = useVerity();

  const [step, setStep] = useState(0);
  const [agent, setAgent] = useState("");
  const [title, setTitle] = useState("Fix GitHub Issue #143");
  const [description, setDescription] = useState(
    "Resolve the reported crash, add a regression test, and keep the change scoped.");
  const [payment, setPayment] = useState("100");
  const [agentBond, setAgentBond] = useState("0");
  const [disputeBond, setDisputeBond] = useState("0");
  const [execTicks, setExecTicks] = useState(50);
  const [acceptTicks, setAcceptTicks] = useState(20);
  const [reqs, setReqs] = useState<Draft[]>(SEED);
  const [evidenceRules, setEvidenceRules] = useState(
    "Prefer CI output, commit history and the PR diff over prose. " +
    "A source that cannot be retrieved is not evidence.");
  const [sVerified, setSVerified] = useState<SettlementPolicy>("FULL");
  const [sPartial, setSPartial] = useState<SettlementPolicy>("PROPORTIONAL");
  const [sFailed, setSFailed] = useState<SettlementPolicy>("REFUND");
  const [sUnverifiable, setSUnverifiable] = useState<SettlementPolicy>("HUMAN_REVIEW");
  const [criticalPolicy, setCriticalPolicy] = useState<"FAIL_JOB" | "PROPORTIONAL">("FAIL_JOB");

  const [phase, setPhase] = useState<TxPhase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalWeight = reqs.reduce((a, r) => a + (Number(r.weight) || 0), 0);
  const idsUnique = new Set(reqs.map((r) => r.id.trim())).size === reqs.length;
  const allNamed = reqs.every((r) => r.id.trim() && r.description.trim());
  // §44 — the UI prevents invalid weights reaching the contract.
  const reqsValid = totalWeight === 100 && idsUnique && allNamed && reqs.length > 0;
  const agreementValid = /^0x[a-fA-F0-9]{40}$/.test(agent.trim())
    && title.trim() && description.trim() && Number(payment) > 0
    && execTicks > 0 && acceptTicks > 0;

  function update(i: number, patch: Partial<Draft>) {
    setReqs((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    if (!client) return;
    setBusy(true); setErr(null); setPhase("idle");
    client.onPhase = (p) => setPhase(p);
    try {
      await client.createJob({
        agent: agent.trim(), title: title.trim(), description: description.trim(),
        requirementsJson: JSON.stringify(reqs),
        paymentWei: genToWei(payment),
        executionDeadlineTicks: Number(execTicks),
        acceptanceDeadlineTicks: Number(acceptTicks),
        evidenceRules,
        settlementVerified: sVerified, settlementPartial: sPartial,
        settlementFailed: sFailed, settlementUnverifiable: sUnverifiable,
        criticalPolicy,
        agentBondWei: genToWei(agentBond), disputeBondWei: genToWei(disputeBond),
      });
      // The contract mints the id; read it back rather than predicting it (§68).
      const list = await client.listJobs(0, 500);
      const mine = [...list.rows].reverse().find(
        (r) => r.agent.toLowerCase() === agent.trim().toLowerCase()
            && r.title === title.trim());
      router.push(mine ? `/jobs/${mine.job_id}` : "/jobs");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink dark:text-night-text">
          Create job
        </h1>
        <p className="text-sm text-ink-muted dark:text-night-muted mt-1">
          You are the requester. The agent wallet you name is the only wallet that can accept.
        </p>
      </div>

      {/* step indicator */}
      <ol className="flex flex-wrap gap-x-2 gap-y-1 text-xs" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1
              ${i === step ? "bg-brand-500 text-white"
                : i < step ? "text-ok" : "text-ink-subtle"}`}
              aria-current={i === step ? "step" : undefined}>
              <span aria-hidden="true">{i < step ? "✓" : i + 1}</span>{s}
            </span>
            {i < STEPS.length - 1 && <span className="text-ink-subtle" aria-hidden="true">→</span>}
          </li>
        ))}
      </ol>

      <div className="card"><div className="card-body space-y-5">
        {step === 0 && (
          <>
            <Field label="Agent wallet" hint="Only this wallet can accept the job.">
              <input className="input font-mono" placeholder="0x…" value={agent}
                     onChange={(e) => setAgent(e.target.value)} />
            </Field>
            <Field label="Title">
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Description">
              <textarea className="textarea" value={description}
                        onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <div className="grid sm:grid-cols-3 gap-4">
              <Field label="Payment (GEN)">
                <input className="input font-mono" value={payment}
                       onChange={(e) => setPayment(e.target.value)} />
              </Field>
              <Field label="Agent bond (GEN)" hint="Optional. Returned unless misconduct.">
                <input className="input font-mono" value={agentBond}
                       onChange={(e) => setAgentBond(e.target.value)} />
              </Field>
              <Field label="Dispute bond (GEN)" hint="Optional. Returned either way.">
                <input className="input font-mono" value={disputeBond}
                       onChange={(e) => setDisputeBond(e.target.value)} />
              </Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Execution deadline (ticks after accept)">
                <input type="number" className="input" value={execTicks}
                       onChange={(e) => setExecTicks(Number(e.target.value))} />
              </Field>
              <Field label="Acceptance window (ticks after submit)">
                <input type="number" className="input" value={acceptTicks}
                       onChange={(e) => setAcceptTicks(Number(e.target.value))} />
              </Field>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="flex items-center justify-between">
              <div className="label">Requirements</div>
              <div className={`text-sm font-medium tabular-nums
                ${totalWeight === 100 ? "text-ok" : "text-bad"}`}>
                {totalWeight}/100
                {totalWeight !== 100 && <span className="ml-2 text-xs">must total exactly 100</span>}
              </div>
            </div>
            <div className="space-y-3">
              {reqs.map((r, i) => (
                <div key={i} className="rounded-lg border border-canvas-edge
                                        dark:border-night-edge p-3 space-y-3">
                  <div className="grid sm:grid-cols-[6rem_1fr_5rem] gap-2">
                    <input className="input font-mono" aria-label={`Requirement ${i + 1} id`}
                           value={r.id} onChange={(e) => update(i, { id: e.target.value })} />
                    <input className="input" aria-label={`Requirement ${i + 1} description`}
                           value={r.description}
                           onChange={(e) => update(i, { description: e.target.value })} />
                    <input type="number" className="input tabular-nums"
                           aria-label={`Requirement ${i + 1} weight`} value={r.weight}
                           onChange={(e) => update(i, { weight: Number(e.target.value) })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="text-xs flex items-center gap-2">
                      <span className="text-ink-muted dark:text-night-muted">Type</span>
                      <select className="input py-1 w-auto" value={r.type}
                              onChange={(e) => update(i, { type: e.target.value as RequirementType })}>
                        <option value="DETERMINISTIC">DETERMINISTIC</option>
                        <option value="EVIDENCE">EVIDENCE</option>
                        <option value="JUDGMENT">JUDGMENT</option>
                      </select>
                    </label>
                    <label className="text-xs flex items-center gap-2">
                      <input type="checkbox" checked={r.critical}
                             onChange={(e) => update(i, { critical: e.target.checked })} />
                      <span className="text-ink-muted dark:text-night-muted">
                        Critical — failing this can fail the whole job
                      </span>
                    </label>
                    <button type="button" className="ml-auto text-ink-subtle hover:text-bad"
                            aria-label={`Remove requirement ${r.id}`}
                            onClick={() => setReqs((p) => p.filter((_, k) => k !== i))}>
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  <input className="input text-xs" placeholder="Evidence requirements"
                         aria-label={`Requirement ${i + 1} evidence requirements`}
                         value={r.evidence_requirements}
                         onChange={(e) => update(i, { evidence_requirements: e.target.value })} />
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost"
                    onClick={() => setReqs((p) => [...p, {
                      id: `R${p.length + 1}`, description: "", type: "JUDGMENT",
                      weight: 0, critical: false,
                      verification_method: "", evidence_requirements: "",
                    }])}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Add requirement
            </button>
            {!idsUnique && <Banner kind="error">Requirement ids must be unique.</Banner>}
            {!allNamed && <Banner kind="error">Every requirement needs an id and a description.</Banner>}
          </>
        )}

        {step === 2 && (
          <Field label="Evidence rules"
                 hint="Guidance the panel reads alongside the requirements. Frozen with the constitution.">
            <textarea className="textarea min-h-[140px]" value={evidenceRules}
                      onChange={(e) => setEvidenceRules(e.target.value)} />
          </Field>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-ink-muted dark:text-night-muted">
              These map a verdict onto money. The panel never chooses a policy or an amount.
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <Policy label="VERIFIED" value={sVerified} onChange={setSVerified} />
              <Policy label="PARTIAL" value={sPartial} onChange={setSPartial} />
              <Policy label="FAILED" value={sFailed} onChange={setSFailed} />
              <Policy label="UNVERIFIABLE" value={sUnverifiable} onChange={setSUnverifiable} />
            </div>
            <Field label="Critical-failure policy"
                   hint="What a failed critical requirement does to an otherwise-passing job.">
              <select className="input" value={criticalPolicy}
                      onChange={(e) => setCriticalPolicy(e.target.value as "FAIL_JOB" | "PROPORTIONAL")}>
                <option value="FAIL_JOB">FAIL_JOB — the whole job takes the FAILED policy</option>
                <option value="PROPORTIONAL">PROPORTIONAL — the score stands on its own</option>
              </select>
            </Field>
          </>
        )}

        {step === 4 && (
          <>
            <Banner kind="info">
              <span className="inline-flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                Terms lock when the job is funded. After that, requirements, weights,
                critical flags and settlement policy cannot change.
              </span>
            </Banner>
            <dl className="grid sm:grid-cols-2 gap-4 text-sm">
              <Review label="Agent" value={agent || "—"} mono />
              <Review label="Payment" value={formatGen(genToWei(payment))} />
              <Review label="Agent bond" value={formatGen(genToWei(agentBond))} />
              <Review label="Dispute bond" value={formatGen(genToWei(disputeBond))} />
              <Review label="Requirements" value={`${reqs.length} · ${totalWeight}/100`} />
              <Review label="Critical" value={reqs.filter((r) => r.critical).map((r) => r.id).join(", ") || "none"} />
            </dl>
            <div className="scroll-x rounded-lg border border-canvas-edge dark:border-night-edge">
              <table className="w-full text-xs">
                <thead className="text-ink-muted dark:text-night-muted">
                  <tr><th className="text-left px-3 py-2">ID</th>
                      <th className="text-left px-3 py-2">Requirement</th>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-right px-3 py-2">Weight</th>
                      <th className="text-left px-3 py-2">Critical</th></tr>
                </thead>
                <tbody>
                  {reqs.map((r) => (
                    <tr key={r.id} className="border-t border-canvas-edge dark:border-night-edge">
                      <td className="px-3 py-2 font-mono">{r.id}</td>
                      <td className="px-3 py-2">{r.description}</td>
                      <td className="px-3 py-2 text-ink-muted dark:text-night-muted">{r.type}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.weight}</td>
                      <td className="px-3 py-2">{r.critical ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!contractAddress && <Banner kind="error">No contract configured.</Banner>}
            {!isConnected && <Banner kind="error">Connect a wallet to create the job.</Banner>}
            {wrongNetwork && <Banner kind="error">Switch to the correct network first.</Banner>}
            {err && <Banner kind="error" onDismiss={() => setErr(null)}>{err}</Banner>}
            <TxLifecycle phase={phase} />
          </>
        )}

        <div className="flex items-center justify-between pt-2 border-t
                        border-canvas-edge dark:border-night-edge">
          <button type="button" className="btn-ghost" disabled={step === 0 || busy}
                  onClick={() => setStep((s) => s - 1)}>Back</button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn-primary"
                    disabled={(step === 0 && !agreementValid) || (step === 1 && !reqsValid)}
                    onClick={() => setStep((s) => s + 1)}>Continue</button>
          ) : (
            <button type="button" className="btn-primary"
                    disabled={busy || !isConnected || !!wrongNetwork || !contractAddress
                              || !agreementValid || !reqsValid}
                    onClick={submit}>
              {busy ? "Creating…" : "Create job"}
            </button>
          )}
        </div>
      </div></div>
    </div>
  );
}

function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label block mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-muted dark:text-night-muted">{hint}</p>}
    </div>
  );
}

function Policy({ label, value, onChange }: {
  label: string; value: SettlementPolicy;
  onChange: (v: SettlementPolicy) => void;
}) {
  return (
    <Field label={label}>
      <select className="input" value={value}
              onChange={(e) => onChange(e.target.value as SettlementPolicy)}>
        <option value="FULL">FULL — agent receives the payment</option>
        <option value="PROPORTIONAL">PROPORTIONAL — agent receives score%</option>
        <option value="REFUND">REFUND — requester receives the payment</option>
        <option value="HUMAN_REVIEW">HUMAN_REVIEW — nothing settles</option>
      </select>
    </Field>
  );
}

function Review({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-xs break-all" : ""}`}>{value}</dd>
    </div>
  );
}
