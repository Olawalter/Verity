"use client";

import { useMemo } from "react";
import { useAccount, useConnectorClient } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { VerityClient, type Eip1193Provider } from "./verity";
import { getContractAddress, getRpcUrl, CHAIN_ID } from "./config";

/**
 * The contract client, bound to the wallet the user actually connected.
 * The provider is taken from wagmi's connector rather than a global.
 */
export function useVerity() {
  const { address, chainId, isConnected } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const contractAddress = getContractAddress();

  const client = useMemo(() => {
    if (!contractAddress) return null;
    const provider = connectorClient?.transport as unknown as Eip1193Provider | undefined;
    return new VerityClient(contractAddress, address ?? null, getRpcUrl(), provider);
  }, [contractAddress, address, connectorClient]);

  return {
    client,
    contractAddress,
    address,
    isConnected,
    wrongNetwork: isConnected && chainId !== undefined && chainId !== CHAIN_ID,
  };
}

const KEY = "verity";

export function useProtocolInfo() {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "protocol"],
    queryFn: () => client!.getProtocolInfo(),
    enabled: !!client,
  });
}

export function useJobs() {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "jobs"],
    queryFn: async () => (await client!.listJobs(0, 500)).rows,
    enabled: !!client,
  });
}

export function useJob(id: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "job", id],
    queryFn: () => client!.getJob(id),
    enabled: !!client && !!id,
  });
}

export function useRequirements(id: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "requirements", id],
    queryFn: () => client!.getRequirements(id),
    enabled: !!client && !!id,
  });
}

export function useEvidence(id: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "evidence", id],
    queryFn: () => client!.getEvidence(id),
    enabled: !!client && !!id,
  });
}

export function useDispute(id: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "dispute", id],
    queryFn: async () => {
      try { return await client!.getDispute(id); } catch { return null; }
    },
    enabled: !!client && !!id,
  });
}

export function useVerdicts(id: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "verdicts", id],
    queryFn: async () => {
      const ids = await client!.listVerdicts(id);
      return Promise.all(ids.map((v) => client!.getVerdict(id, v)));
    },
    enabled: !!client && !!id,
  });
}

export function useSettlement(id: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "settlement", id],
    queryFn: async () => {
      try { return await client!.getSettlement(id); } catch { return null; }
    },
    enabled: !!client && !!id,
  });
}

export function usePassport(agent: string) {
  const { client } = useVerity();
  return useQuery({
    queryKey: [KEY, "passport", agent?.toLowerCase()],
    queryFn: () => client!.getPassport(agent),
    enabled: !!client && !!agent,
  });
}

/**
 * §70 — after a write, authoritative state is REFETCHED, never patched
 * optimistically. Caching a state that has moved on is how a UI ends up
 * showing a finality it cannot back up.
 */
export function useRefreshJob(id: string) {
  const qc = useQueryClient();
  return () => {
    for (const k of ["job", "requirements", "evidence", "dispute",
                     "verdicts", "settlement"]) {
      qc.invalidateQueries({ queryKey: [KEY, k, id] });
    }
    qc.invalidateQueries({ queryKey: [KEY, "jobs"] });
    qc.invalidateQueries({ queryKey: [KEY, "protocol"] });
  };
}
