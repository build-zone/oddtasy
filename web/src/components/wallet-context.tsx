"use client";

/**
 * Wallet seam. Screens call useWallet() and never import the Privy SDK
 * directly. With NEXT_PUBLIC_PRIVY_APP_ID set, PrivyWalletBridge feeds real
 * values in; without it the app boots wallet-less and every write CTA
 * disables with an explanation — so a fresh clone runs before any keys exist.
 */
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import { createContext, useContext, type ReactNode } from "react";
import { base64ToBytes, toBase58 } from "@/lib/format";

export type WalletState = {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  address: string | null;
  email: string | null;
  login: () => void;
  logout: () => Promise<void> | void;
  /** Sign + send a base64 unsigned transaction; resolves to a base58 signature. */
  signAndSendBase64: (txBase64: string) => Promise<string>;
};

const disabledState: WalletState = {
  enabled: false,
  ready: true,
  authenticated: false,
  address: null,
  email: null,
  login: () => {},
  logout: () => {},
  signAndSendBase64: async () => {
    throw new Error("Wallet not configured (set NEXT_PUBLIC_PRIVY_APP_ID)");
  },
};

const WalletContext = createContext<WalletState>(disabledState);

export function useWallet(): WalletState {
  return useContext(WalletContext);
}

export function StubWalletProvider({ children }: { children: ReactNode }) {
  return (
    <WalletContext.Provider value={disabledState}>
      {children}
    </WalletContext.Provider>
  );
}

/** Must be rendered inside <PrivyProvider>. */
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const wallet = wallets[0] ?? null;

  const value: WalletState = {
    enabled: true,
    ready: privy.ready && walletsReady,
    authenticated: privy.authenticated,
    address: wallet?.address ?? null,
    // email lives in a different slot per login method (email vs Google vs Apple)
    email:
      privy.user?.email?.address ??
      privy.user?.google?.email ??
      privy.user?.apple?.email ??
      null,
    login: privy.login,
    logout: privy.logout,
    signAndSendBase64: async (txBase64: string) => {
      if (!wallet) throw new Error("Connect a wallet first");
      const { signature } = await signAndSendTransaction({
        transaction: base64ToBytes(txBase64),
        wallet,
        chain: "solana:devnet",
      });
      return toBase58(signature);
    },
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
