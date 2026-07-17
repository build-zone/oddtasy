"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWallet } from "@/hooks/use-wallet";
import type { FaucetResponse } from "@/lib/types";

/** localStorage marker so a wallet is only auto-funded once per browser. */
function fauceted(address: string): string {
  return `oddtasy:fauceted:${address}`;
}

/**
 * Calls the server faucet and refreshes on-chain balances on success. The
 * server enforces once-per-wallet, so a repeated call just returns
 * `alreadyFunded` — safe to retry.
 */
export function useFaucet() {
  const queryClient = useQueryClient();
  return useMutation<FaucetResponse, Error, string>({
    mutationFn: (wallet: string) => api.faucet(wallet),
    onSuccess: (_res, wallet) => {
      try {
        localStorage.setItem(fauceted(wallet), "1");
      } catch {
        /* private mode / storage disabled — server still dedupes */
      }
      // balances are read straight from chain; the transfer already confirmed
      void queryClient.invalidateQueries({ queryKey: ["balances", wallet] });
    },
  });
}

/**
 * Fire-and-forget auto-funding: the first time a wallet appears logged in on
 * this browser, drip test USDC + SOL so the user can bet immediately. Mounted
 * once, high in the tree. Silent by design — the /me "Fund wallet" card is the
 * visible, user-driven path.
 */
export function AutoFaucet() {
  const wallet = useWallet();
  const faucet = useFaucet();
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    const address = wallet.address;
    if (!wallet.authenticated || !address) return;
    if (attempted.current === address) return;
    try {
      if (localStorage.getItem(fauceted(address))) {
        attempted.current = address;
        return;
      }
    } catch {
      /* ignore storage errors and let the server dedupe */
    }
    attempted.current = address;
    faucet.mutate(address);
    // faucet identity is stable; re-run only when the wallet changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.authenticated, wallet.address]);

  return null;
}
