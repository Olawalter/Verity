"use client";

/**
 * §52 — typed network configuration.
 *
 * The chain object comes FROM genlayer-js rather than being re-declared
 * from environment variables, so the app's idea of the network cannot
 * drift from the SDK's. Nothing here hardcodes an unverified chain id.
 */
import { studionet } from "genlayer-js/chains";

export const CHAIN = studionet;
export const CHAIN_ID = CHAIN.id;
export const CHAIN_HEX = `0x${CHAIN.id.toString(16)}` as `0x${string}`;
export const CHAIN_NAME = CHAIN.name;
export const CHAIN_RPC = CHAIN.rpcUrls.default.http[0];
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER_URL ||
  CHAIN.blockExplorers?.default?.url ||
  "";

export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_GENLAYER_RPC_URL || CHAIN_RPC;
}

/**
 * The deployed contract. Deliberately no fallback: a stale hardcoded
 * address silently points the whole app at the wrong contract, which is
 * worse than an empty state the UI can report honestly (§68).
 */
export function getContractAddress(): string {
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
}

export const DEPLOY_ENV =
  process.env.NEXT_PUBLIC_DEPLOY_ENV || "development";

/** EIP-3085 params, built from the same chain object the client signs against. */
export const ADD_CHAIN_PARAMS = {
  chainId: CHAIN_HEX,
  chainName: CHAIN_NAME,
  rpcUrls: [CHAIN_RPC],
  nativeCurrency: {
    name: CHAIN.nativeCurrency.name,
    symbol: CHAIN.nativeCurrency.symbol,
    decimals: CHAIN.nativeCurrency.decimals,
  },
  blockExplorerUrls: EXPLORER ? [EXPLORER.replace(/\/+$/, "")] : [],
};
