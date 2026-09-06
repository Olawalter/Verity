const WEI = BigInt(10) ** BigInt(18);

export function weiToGen(wei: bigint | string | number): string {
  const n = typeof wei === "bigint" ? wei : BigInt(String(wei));
  const whole = n / WEI;
  const frac = n % WEI;
  if (frac === BigInt(0)) return whole.toString();
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

export function genToWei(input: string | number): bigint {
  const s = String(input).trim();
  if (!s) return BigInt(0);
  const [whole, frac = ""] = s.split(".");
  const w = whole.replace(/^0+(\d)/, "$1") || "0";
  const f = (frac + "000000000000000000").slice(0, 18);
  return BigInt(w) * WEI + BigInt(f || "0");
}

export function formatGen(wei: bigint | string | number, decimals = 2): string {
  const s = weiToGen(wei);
  if (!s.includes(".")) return `${s} GEN`;
  const [w, f] = s.split(".");
  return `${w}.${f.slice(0, decimals).padEnd(decimals, "0")} GEN`;
}

/** §57 — long identifiers truncated, never silently mangled. */
export function truncate(v?: string, chars = 6): string {
  if (!v) return "";
  return v.length <= chars * 2 + 2 ? v : `${v.slice(0, chars + 2)}…${v.slice(-chars)}`;
}

/** §68 — an unavailable value renders as a word, never a fabricated 0. */
export function orUnknown(v: number | null | undefined, suffix = ""): string {
  return v === null || v === undefined ? "Unavailable" : `${v}${suffix}`;
}

export function pct(bps: number | null): string {
  return bps === null ? "Unavailable" : `${(bps / 100).toFixed(1)}%`;
}
