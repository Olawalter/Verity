"use client";

/**
 * §49 — wallet stack: RainbowKit + Wagmi + Viem.
 *
 * RainbowKit's connector set is EIP-6963-aware, so every injected wallet
 * that announces itself is offered and the user picks. Nothing here
 * reaches for `window.ethereum` directly: with more than one extension
 * installed that global is whichever won the race, and the user can end
 * up signing from a wallet they never chose. WalletConnect is the
 * compatibility fallback.
 *
 * No seed phrase, private key or wallet password is ever requested,
 * stored or logged.
 */
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import {
  RainbowKitProvider, connectorsForWallets, lightTheme, darkTheme,
} from "@rainbow-me/rainbowkit";
import {
  injectedWallet, metaMaskWallet, rabbyWallet, trustWallet, walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import type { Chain } from "viem";
import "@rainbow-me/rainbowkit/styles.css";

import { CHAIN, CHAIN_ID, CHAIN_NAME, CHAIN_RPC, EXPLORER } from "./config";

// The GenLayer chain expressed as a viem Chain, derived from the SDK's
// own object so the two cannot drift (§52).
const genlayerChain: Chain = {
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: {
    name: CHAIN.nativeCurrency.name,
    symbol: CHAIN.nativeCurrency.symbol,
    decimals: CHAIN.nativeCurrency.decimals,
  },
  rpcUrls: { default: { http: [CHAIN_RPC] } },
  ...(EXPLORER
    ? { blockExplorers: { default: { name: "Explorer", url: EXPLORER } } }
    : {}),
};

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
export const WALLETCONNECT_AVAILABLE = Boolean(projectId);

/**
 * The connector list is CURATED rather than taken from
 * `getDefaultConfig`. Two reasons, and the second is the load-bearing one:
 *
 *  1. §49 asks for injected wallets plus WalletConnect as the fallback.
 *     Listing them explicitly means the UI offers exactly what the app
 *     actually supports.
 *  2. RainbowKit's default set includes the Coinbase/Base connector,
 *     which drags in @coinbase/cdp-sdk and its optional x402 + Solana
 *     dependency tree. Those are dynamically imported behind runtime
 *     feature checks that never fire here, but the bundler still has to
 *     resolve them and the build fails. Not importing the connector is
 *     the honest fix; aliasing a dozen packages to false is not.
 *
 * `injectedWallet` is EIP-6963-aware, so every extension that announces
 * itself is offered and the user picks — nothing reaches for
 * `window.ethereum` directly.
 */
const injectedGroup = {
  groupName: "Installed",
  wallets: [injectedWallet, metaMaskWallet, rabbyWallet, trustWallet],
};
const wcGroup = { groupName: "More", wallets: [walletConnectWallet] };

/**
 * RainbowKit validates `projectId` at module init and throws without
 * one, even when no WalletConnect wallet is listed. When the deployment
 * has not configured a real id we pass a clearly-labelled placeholder
 * and DROP the WalletConnect wallet from the list, so injected wallets
 * still work and nothing silently pretends WC is available. Settings
 * states the limitation outright.
 */
const connectors = connectorsForWallets(
  projectId ? [injectedGroup, wcGroup] : [injectedGroup],
  { appName: "Verity", projectId: projectId || "VERITY_WALLETCONNECT_NOT_CONFIGURED" },
);

const wagmiConfig = createConfig({
  connectors,
  chains: [genlayerChain],
  transports: { [genlayerChain.id]: http(CHAIN_RPC) },
  ssr: true,
});

export function Providers({ children }: { children: React.ReactNode }) {
  // §70 — one QueryClient per mount, with conservative defaults. Reads
  // are cached briefly; authoritative state is always refetched after a
  // write rather than optimistically patched.
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <RainbowKitProvider
          theme={{
            lightMode: lightTheme({ accentColor: "#6D5EF7", borderRadius: "medium" }),
            darkMode: darkTheme({ accentColor: "#6D5EF7", borderRadius: "medium" }),
          }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
