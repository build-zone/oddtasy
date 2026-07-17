"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "./toast";
import { PrivyWalletBridge, StubWalletProvider } from "./wallet-context";
import { AutoFaucet } from "@/hooks/use-faucet";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";
const RPC_WS_URL = RPC_URL.replace(/^http/, "ws");

// module-level: kit RPC handles are stateless and safe to share
const solanaRpcs = {
  "solana:devnet": {
    rpc: createSolanaRpc(RPC_URL),
    rpcSubscriptions: createSolanaRpcSubscriptions(RPC_WS_URL),
    blockExplorerUrl: "https://explorer.solana.com?cluster=devnet",
  },
} as const;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );

  const inner = (
    <ToastProvider>
      <AutoFaucet />
      {children}
    </ToastProvider>
  );

  return (
    <QueryClientProvider client={queryClient}>
      {PRIVY_APP_ID ? (
        <PrivyProvider
          appId={PRIVY_APP_ID}
          config={{
            loginMethods: ["email", "google"],
            appearance: { theme: "dark", accentColor: "#f5b942" },
            embeddedWallets: {
              solana: { createOnLogin: "users-without-wallets" },
            },
            solana: { rpcs: solanaRpcs },
          }}
        >
          <PrivyWalletBridge>{inner}</PrivyWalletBridge>
        </PrivyProvider>
      ) : (
        <StubWalletProvider>{inner}</StubWalletProvider>
      )}
    </QueryClientProvider>
  );
}
