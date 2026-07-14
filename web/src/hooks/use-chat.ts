"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, chatStreamUrl } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

/**
 * Pool group chat: history via GET, live messages via SSE, sends via POST.
 * The SSE echo is the source of truth — sends are NOT applied optimistically,
 * so what you see is always what everyone else sees.
 */
export function useChat(poolId: string | null, wallet: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const retry = useRef(0);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!poolId) return;
    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    void api.messages(poolId).then((history) => {
      if (!closed) setMessages(history);
    }).catch(() => {});

    const connect = () => {
      if (closed) return;
      source = new EventSource(chatStreamUrl(poolId));
      source.addEventListener("chat", (e) => {
        try {
          const msg = JSON.parse((e as MessageEvent).data) as ChatMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-200),
          );
        } catch {
          /* malformed frame */
        }
      });
      // the same stream carries pool updates (new bets, payments, settlement)
      // so every open page refetches instantly instead of waiting for a poll
      source.addEventListener("pool", () => {
        void queryClient.invalidateQueries({ queryKey: ["pool", poolId] });
        void queryClient.invalidateQueries({ queryKey: ["pools"] });
      });
      source.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        if (closed) return;
        retry.current = Math.min(retry.current + 1, 5);
        retryTimer = setTimeout(connect, 1000 * 2 ** retry.current);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      setConnected(false);
      setMessages([]);
    };
  }, [poolId]);

  const send = useCallback(
    async (text: string) => {
      if (!poolId || !wallet || !text.trim()) return;
      setSending(true);
      try {
        await api.sendMessage(poolId, { wallet, text: text.trim() });
      } finally {
        setSending(false);
      }
    },
    [poolId, wallet],
  );

  return { messages, connected, send, sending };
}
