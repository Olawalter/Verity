import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

// ─── contract types (§75 — typed integration, no `any`) ─────────────────────

export type RequirementType = "DETERMINISTIC" | "EVIDENCE" | "JUDGMENT";
export type RequirementResult = "PASS" | "FAIL" | "UNVERIFIABLE";
export type VerdictValue = "VERIFIED" | "PARTIAL" | "FAILED" | "UNVERIFIABLE";
export type EvidenceQuality = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
export type SettlementPolicy = "FULL" | "PROPORTIONAL" | "REFUND" | "HUMAN_REVIEW";
export type EvidenceRole = "DELIVERABLE" | "SUPPORTING" | "COUNTER" | "REFERENCE";
export type Independence = "INDEPENDENT" | "RELATED" | "SAME_ORIGIN" | "UNKNOWN";

export type JobStatus =
  | "DRAFT" | "FUNDED" | "ACTIVE" | "SUBMITTED" | "ACCEPTED" | "DISPUTED"
  | "EVIDENCE_FROZEN" | "ADJUDICATING" | "VERDICT" | "APPEALED"
  | "FINAL_ADJUDICATION" | "FINALIZED" | "SETTLED" | "CANCELLED"
  | "EXPIRED" | "REFUNDED";

export type Requirement = {
  id: string;
  description: string;
  type: RequirementType;
  weight: number;
  critical: boolean;
  verification_method: string;
  evidence_requirements: string;
};

export type JobRow = {
  job_id: string;
  title: string;
  requester: string;
  agent: string;
  status: JobStatus;
  payment_wei: number | string;
  escrow_held: number | string;
  requirement_count: number;
  latest_verdict_id: number;
  appeal_count: number;
  created_tick: number;
};

export type Job = {
  job_id: string;
  requester: string;
  agent: string;
  title: string;
  description: string;
  requirement_count: number;
  evidence_rules: string;
  settlement: {
    verified: SettlementPolicy; partial: SettlementPolicy;
    failed: SettlementPolicy; unverifiable: SettlementPolicy;
    critical: "FAIL_JOB" | "PROPORTIONAL";
  };
  constitution_hash: string;
  terms_locked: boolean;
  payment_wei: number | string;
  payment_deposited: number | string;
  agent_bond_wei: number | string;
  agent_bond_deposited: number | string;
  dispute_bond_wei: number | string;
  dispute_bond_deposited: number | string;
  total_released: number | string;
  escrow_held: number | string;
  status: JobStatus;
  execution_plan_hash: string;
  deliverable_uri: string;
  deliverable_hash: string;
  evidence_frozen_at: number;
  evidence_snapshot_hash: string;
  latest_verdict_id: number;
  final_verdict_id: number;
  appeal_count: number;
  appeal_deadline_tick: number;
  created_tick: number;
  funded_tick: number;
  accepted_tick: number;
  execution_deadline_tick: number;
  submitted_tick: number;
  acceptance_deadline_tick: number;
  dispute_opened_tick: number;
  adjudication_started_tick: number;
  verdict_tick: number;
  finalized_tick: number;
  settled_tick: number;
  current_tick: number;
  can_settle: boolean;
};

export type EvidenceReceipt = {
  receipt_id: string;
  job_id: string;
  requirement_id: string;
  submitted_by: string;
  url: string;
  claimed_content_hash: string;
  content_type: string;
  source_host: string;
  source_identity: string;
  evidence_role: EvidenceRole;
  claimed_independence: Independence;
  captured_summary: string;
  submitted_tick: number;
  frozen: boolean;
};

export type DisputeRecord = {
  dispute_id: number;
  job_id: string;
  requester: string;
  disputed_requirements: string[];
  claim: string;
  evidence_refs: string[];
  agent_response: string;
  agent_counter_refs: string[];
  agent_responded_tick: number;
  bond_wei: number | string;
  opened_tick: number;
  status: string;
};

export type Verdict = {
  verdict_id: number;
  job_id: string;
  round_number: number;
  verdict: VerdictValue;
  requirements: { id: string; result: RequirementResult; reason_code: string }[];
  evidence_quality: EvidenceQuality;
  fraud_flags: string[];
  unverifiable_items: string[];
  reasoning: string;
  score: number;
  critical_failed: boolean;
  constitution_hash: string;
  evaluated_tick: number;
  raw_json: string;
};

export type SettlementRecord = {
  job_id: string;
  verdict_id: number;
  policy_applied: SettlementPolicy;
  score: number;
  agent_payout: number | string;
  requester_payout: number | string;
  agent_bond_returned: number | string;
  dispute_bond_returned: number | string;
  escrow_before: number | string;
  escrow_after: number | string;
  settled_tick: number;
};

/** §68 — nulls mean "no history", never a fabricated zero. */
export type Passport = {
  agent: string;
  jobs_verified: number;
  jobs_partial: number;
  jobs_failed: number;
  jobs_unverifiable: number;
  disputes_faced: number;
  appeals_won: number;
  critical_failures: number;
  scored_jobs: number;
  average_score: number | null;
  dispute_rate_bps: number | null;
  verified_value_wei: number | string;
};

export type ProtocolInfo = {
  version: string;
  job_count: number;
  current_tick: number;
  weight_total: number;
  max_appeals: number;
  appeal_window_ticks: number;
  requirement_types: string[];
  verdicts: string[];
  requirement_results: string[];
  settlement_policies: string[];
  evidence_roles: string[];
  independence_classes: string[];
  retrieval_labels: string[];
  /** Closed vocabulary — the panel may emit only these (§35). */
  fraud_flags: string[];
  evidence_quality_grades: string[];
};

// ─── receipt handling ───────────────────────────────────────────────────────

type ReceiptShape = {
  consensus_data?: { leader_receipt?: unknown };
  result?: { leader_receipt?: unknown };
  leader_receipt?: unknown;
};

function leaderReceipts(r: unknown): Array<Record<string, unknown>> {
  const rr = r as ReceiptShape | null;
  const direct = rr?.consensus_data?.leader_receipt;
  if (Array.isArray(direct)) return direct;
  const nested = rr?.result?.leader_receipt ?? rr?.leader_receipt;
  if (Array.isArray(nested)) return nested;
  return [];
}

/**
 * A GenLayer receipt can read ACCEPTED while the contract REVERTED — the
 * transaction landed, execution failed, no state changed. A wrapper that
 * only checks for a hash reports success over a no-op.
 */
function revertReason(r: unknown): string | null {
  for (const lr of leaderReceipts(r)) {
    const res = lr?.result as Record<string, unknown> | undefined;
    if (String(res?.status ?? "") === "rollback" && typeof res?.payload === "string") {
      return res.payload as string;
    }
  }
  return null;
}

function returnedValue(r: unknown): unknown {
  for (const lr of leaderReceipts(r)) {
    const res = lr?.result as Record<string, unknown> | undefined;
    if (String(res?.status ?? "") !== "return") continue;
    const payload = res?.payload as Record<string, unknown> | undefined;
    let v: unknown = payload?.readable ?? payload;
    for (let i = 0; i < 3 && typeof v === "string"; i++) {
      try { v = JSON.parse(v as string); } catch { return v; }
    }
    return v;
  }
  return null;
}

/** §55 — human-readable errors; the class prefix is for validators. */
export function humanError(m: string): string {
  return m.replace(/^\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\]\s*/, "");
}

/**
 * Thrown when a write was submitted but its receipt could not be read.
 * NOT a refusal, and must never render as one: the signature happened,
 * the transaction may well have landed, and telling the user it failed
 * invites them to sign the same value-bearing action twice.
 */
export class PendingReceipt extends Error {
  readonly hash: string;
  constructor(hash: string, detail: string) {
    super(`Submitted, but the receipt could not be read: ${detail}`);
    this.name = "PendingReceipt";
    this.hash = hash;
  }
}

export type TxPhase =
  | "idle" | "wallet" | "submitted" | "pending" | "finalizing"
  | "finalized" | "rejected" | "failed";

export class VerityClient {
  private address: `0x${string}`;
  private client: ReturnType<typeof createClient>;
  private rpcUrl?: string;
  private provider?: Eip1193Provider;
  onPhase?: (phase: TxPhase, hash?: string) => void;

  constructor(contractAddress: string, account?: string | null,
              rpcUrl?: string, provider?: Eip1193Provider) {
    this.address = contractAddress as `0x${string}`;
    this.rpcUrl = rpcUrl;
    this.provider = provider;
    this.client = this.build(account);
  }

  /**
   * Build the client WITH the connected wallet's provider. Without it,
   * genlayer-js sends eth_sendTransaction straight over HTTP — no wallet
   * prompt — and with several extensions installed the global fallback is
   * whichever won the race. The signer must be the one the user chose.
   */
  private build(account?: string | null) {
    const cfg: Record<string, unknown> = { chain: studionet };
    if (account) cfg.account = account as `0x${string}`;
    if (this.rpcUrl) cfg.endpoint = this.rpcUrl;
    if (this.provider) cfg.provider = this.provider;
    return createClient(cfg as never);
  }

  private async read<T>(fn: string, args: unknown[] = []): Promise<T> {
    const raw = await this.client.readContract({
      address: this.address, functionName: fn, args: args as never,
    } as never);
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
  }

  getProtocolInfo() { return this.read<ProtocolInfo>("get_protocol_info"); }
  listJobs(offset = 0, limit = 200) {
    return this.read<{ total: number; offset: number; count: number; rows: JobRow[] }>(
      "list_jobs", [offset, limit]);
  }
  getJob(id: string) { return this.read<Job>("get_job", [id]); }
  getRequirements(id: string) { return this.read<Requirement[]>("get_requirements", [id]); }
  getEvidence(id: string) { return this.read<EvidenceReceipt[]>("get_evidence", [id]); }
  getDispute(id: string) { return this.read<DisputeRecord>("get_dispute", [id]); }
  listVerdicts(id: string) { return this.read<number[]>("list_verdicts", [id]); }
  getVerdict(id: string, vid: number) { return this.read<Verdict>("get_verdict", [id, vid]); }
  getSettlement(id: string) { return this.read<SettlementRecord>("get_settlement", [id]); }
  getPassport(agent: string) { return this.read<Passport>("get_passport", [agent]); }

  private async write(fn: string, args: unknown[],
                      opts: { value?: bigint; wait?: "ACCEPTED" | "FINALIZED" } = {}) {
    let hash: `0x${string}`;
    this.onPhase?.("wallet");
    try {
      hash = await this.client.writeContract({
        address: this.address, functionName: fn, args: args as never,
        ...(opts.value ? { value: opts.value } : {}),
      } as never);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // §51 — a user declining in their wallet is not a failure.
      this.onPhase?.(/reject|denied|User denied/i.test(msg) ? "rejected" : "failed");
      throw new Error(humanError(msg));
    }
    this.onPhase?.("submitted", hash);
    let receipt: unknown;
    try {
      this.onPhase?.(opts.wait === "FINALIZED" ? "finalizing" : "pending", hash);
      receipt = await this.client.waitForTransactionReceipt({
        hash, status: (opts.wait ?? "ACCEPTED") as never,
        retries: 60, interval: 3000,
      } as never);
    } catch (err) {
      throw new PendingReceipt(hash, err instanceof Error ? err.message : String(err));
    }
    const reason = revertReason(receipt);
    if (reason) {
      this.onPhase?.("failed", hash);
      throw new Error(humanError(reason));
    }
    this.onPhase?.("finalized", hash);
    return receipt;
  }

  // ── writes ──
  createJob(p: {
    agent: string; title: string; description: string;
    requirementsJson: string; paymentWei: bigint;
    executionDeadlineTicks: number; acceptanceDeadlineTicks: number;
    evidenceRules: string;
    settlementVerified: SettlementPolicy; settlementPartial: SettlementPolicy;
    settlementFailed: SettlementPolicy; settlementUnverifiable: SettlementPolicy;
    criticalPolicy: "FAIL_JOB" | "PROPORTIONAL";
    agentBondWei: bigint; disputeBondWei: bigint;
  }) {
    return this.write("create_job", [
      p.agent, p.title, p.description, p.requirementsJson,
      p.paymentWei.toString(), p.executionDeadlineTicks, p.acceptanceDeadlineTicks,
      p.evidenceRules, p.settlementVerified, p.settlementPartial,
      p.settlementFailed, p.settlementUnverifiable, p.criticalPolicy,
      p.agentBondWei.toString(), p.disputeBondWei.toString(),
    ]);
  }
  fundJob(id: string, paymentWei: bigint) {
    return this.write("fund_job", [id], { value: paymentWei });
  }
  acceptJob(id: string, planHash: string, bondWei: bigint) {
    return this.write("accept_job", [id, planHash],
      bondWei > BigInt(0) ? { value: bondWei } : {});
  }
  submitEvidence(id: string, e: {
    requirementId: string; url: string; claimedContentHash: string;
    contentType: string; sourceHost: string; sourceIdentity: string;
    evidenceRole: EvidenceRole; claimedIndependence: Independence;
    capturedSummary: string;
  }) {
    return this.write("submit_evidence", [
      id, e.requirementId, e.url, e.claimedContentHash, e.contentType,
      e.sourceHost, e.sourceIdentity, e.evidenceRole, e.claimedIndependence,
      e.capturedSummary,
    ]);
  }
  submitDeliverable(id: string, uri: string, hash: string) {
    return this.write("submit_deliverable", [id, uri, hash]);
  }
  acceptWork(id: string) { return this.write("accept_work", [id], { wait: "FINALIZED" }); }
  openDispute(id: string, disputed: string[], claim: string,
              refs: string[], bondWei: bigint) {
    return this.write("open_dispute",
      [id, JSON.stringify(disputed), claim, JSON.stringify(refs)],
      bondWei > BigInt(0) ? { value: bondWei } : {});
  }
  respondToDispute(id: string, explanation: string, refs: string[]) {
    return this.write("respond_to_dispute", [id, explanation, JSON.stringify(refs)]);
  }
  freezeEvidence(id: string) { return this.write("freeze_evidence", [id], { wait: "FINALIZED" }); }
  adjudicate(id: string) { return this.write("adjudicate", [id], { wait: "FINALIZED" }); }
  appeal(id: string, grounds: string) { return this.write("appeal", [id, grounds]); }
  finalizeVerdict(id: string) { return this.write("finalize_verdict", [id], { wait: "FINALIZED" }); }
  settle(id: string) { return this.write("settle", [id], { wait: "FINALIZED" }); }
  cancelJob(id: string) { return this.write("cancel_job", [id], { wait: "FINALIZED" }); }
  expireJob(id: string) { return this.write("expire_job", [id]); }
  recoverEscrow(id: string) { return this.write("recover_escrow", [id], { wait: "FINALIZED" }); }
  tick() { return this.write("tick", []); }
}

export { returnedValue };
