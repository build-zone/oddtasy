"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useWallet } from "@/hooks/use-wallet";

/**
 * The account layer. On first login a profile is auto-created from the Privy
 * email (local part becomes the display name); after that the user owns the
 * name via /me. Server decorates chat + entries with it, so everyone sees
 * names instead of wallet snippets.
 */
export function useProfile() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const provisioning = useRef(false);

  const query = useQuery({
    queryKey: ["profile", wallet.address],
    enabled: Boolean(wallet.address),
    queryFn: async () => {
      try {
        return await api.getUser(wallet.address as string);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });

  // auto-provision on first login; heal profiles created before the email
  // arrived (fan-XXXX fallback name, missing email)
  useEffect(() => {
    if (query.data === undefined || !wallet.address || provisioning.current) return;

    const fromEmail = wallet.email?.split("@")[0]?.replace(/[^\w.-]/g, "").slice(0, 32);
    const emailName = fromEmail && fromEmail.length >= 2 ? fromEmail : null;

    let patch: { displayName?: string; email?: string } | null = null;
    if (query.data === null) {
      patch = {
        displayName: emailName ?? `fan-${wallet.address.slice(0, 4)}`,
        email: wallet.email ?? undefined,
      };
    } else if (wallet.email) {
      const heal: { displayName?: string; email?: string } = {};
      if (!query.data.email) heal.email = wallet.email;
      if (query.data.displayName.startsWith("fan-") && emailName) heal.displayName = emailName;
      if (Object.keys(heal).length > 0) patch = heal;
    }
    if (!patch) return;

    provisioning.current = true;
    void api
      .upsertUser(wallet.address, patch)
      .then(() => queryClient.invalidateQueries({ queryKey: ["profile"] }))
      .finally(() => {
        provisioning.current = false;
      });
  }, [query.data, wallet.address, wallet.email, queryClient]);

  const update = useMutation({
    mutationFn: (patch: { displayName?: string; email?: string; avatarUrl?: string }) => {
      if (!wallet.address) throw new Error("Log in first");
      return api.upsertUser(wallet.address, patch);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
      // names are baked into pool/chat responses — refresh those too
      void queryClient.invalidateQueries({ queryKey: ["pool"] });
      void queryClient.invalidateQueries({ queryKey: ["pools"] });
    },
  });

  return { profile: query.data ?? null, isLoading: query.isLoading, update };
}
