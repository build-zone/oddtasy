"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PoolStatus } from "@/lib/types";

export function useFixtures() {
  return useQuery({
    queryKey: ["fixtures"],
    queryFn: api.fixtures,
    refetchInterval: 60_000,
  });
}

export function useSocialOptions(
  fixtureId: number | null,
  lambdas?: { homeLambda: number; awayLambda: number; rho: number } | null,
  source: "txline" | "ranktasy" | "hybrid" = "hybrid",
) {
  return useQuery({
    queryKey: ["social-options", fixtureId, source, lambdas ?? null],
    enabled: fixtureId != null,
    queryFn: () => api.socialOptions(fixtureId as number, source, lambdas ?? undefined),
  });
}

export function usePools(params?: {
  fixtureId?: number;
  wallet?: string;
  status?: PoolStatus;
}) {
  return useQuery({
    queryKey: ["pools", params ?? {}],
    queryFn: () => api.pools(params),
    refetchInterval: 30_000,
  });
}

export function usePool(poolId: string | null) {
  return useQuery({
    queryKey: ["pool", poolId],
    enabled: Boolean(poolId),
    queryFn: () => api.pool(poolId as string),
    refetchInterval: 20_000,
  });
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 300_000 });
}
