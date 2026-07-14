"use client";

/** Re-export of the wallet seam plus balance queries. */
import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";

export { useWallet } from "@/components/wallet-context";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";
const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function useBalances(address: string | null) {
  return useQuery({
    queryKey: ["balances", address],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: async () => {
      const conn = new Connection(RPC, "confirmed");
      const owner = new PublicKey(address as string);
      const [tokenAccounts, lamports] = await Promise.all([
        conn.getParsedTokenAccountsByOwner(owner, {
          mint: new PublicKey(USDC_MINT),
        }),
        conn.getBalance(owner),
      ]);
      const usdc = tokenAccounts.value.reduce((sum, acc) => {
        const amount = acc.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0;
        return sum + (typeof amount === "number" ? amount : 0);
      }, 0);
      return { usdc, sol: lamports / 1e9 };
    },
  });
}
