"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Menu, X, ShieldCheck } from "lucide-react";
import { useVerity } from "@/lib/useVerity";
import { CHAIN_NAME } from "@/lib/config";

// §42
const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/jobs", label: "Jobs" },
  { href: "/jobs/create", label: "Create Job" },
  { href: "/disputes", label: "Disputes" },
  { href: "/verification", label: "Verification" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const { wrongNetwork, contractAddress } = useVerity();

  return (
    <header className="sticky top-0 z-40 border-b border-canvas-edge dark:border-night-edge
                       bg-canvas-raised/90 dark:bg-night-raised/90 backdrop-blur">
      {/* §55 — wrong-network is surfaced, not silently ignored */}
      {wrongNetwork && (
        <div role="alert" className="bg-warn text-white text-xs px-4 py-1.5 text-center">
          Wrong network — switch to {CHAIN_NAME} to sign transactions.
        </div>
      )}
      {!contractAddress && (
        <div role="alert" className="bg-bad text-white text-xs px-4 py-1.5 text-center">
          NEXT_PUBLIC_CONTRACT_ADDRESS is not set — the app has no contract to read.
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-8 min-w-0">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-brand-500 grid place-items-center">
              <ShieldCheck className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div className="leading-tight">
              <div className="font-semibold tracking-tight text-ink dark:text-night-text">VERITY</div>
              {/* Hidden below `sm`: at 375px the wordmark, the tagline and
                  the connect button compete for the same row and the
                  tagline is the one that can go. */}
              <div className="hidden sm:block text-[9px] uppercase tracking-widest text-ink-muted dark:text-night-muted">
                verify what agents promise
              </div>
            </div>
          </Link>

          <nav aria-label="Main" className="hidden lg:flex items-center gap-5 text-sm">
            {LINKS.map((l) => {
              const active = path === l.href || path.startsWith(l.href + "/");
              return (
                <Link key={l.href} href={l.href}
                      aria-current={active ? "page" : undefined}
                      className={active
                        ? "text-brand-600 dark:text-brand-300 font-medium"
                        : "text-ink-muted dark:text-night-muted hover:text-ink dark:hover:text-night-text"}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ConnectButton showBalance={false} chainStatus="icon" />
          <button
            className="lg:hidden rounded-lg p-2 border border-canvas-edge dark:border-night-edge"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X className="w-4 h-4" aria-hidden="true" />
                  : <Menu className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="lg:hidden border-t border-canvas-edge
                        dark:border-night-edge px-4 py-3 space-y-1">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)}
                  className="block px-2 py-2 rounded-lg text-sm text-ink dark:text-night-text
                             hover:bg-canvas-sunken dark:hover:bg-night-sunken">
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
