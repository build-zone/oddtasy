import type { Response } from "express";
import { writeSseEvent } from "../stream/sse.js";
import type { ChatMessage } from "./store.js";

/**
 * Per-pool chat fan-out. Unlike the TxLINE stream hub there is no upstream:
 * messages originate from our own POST handler and broadcast to every open
 * browser stream for that pool.
 */
const clients = new Map<string, Set<Response>>();

const HEARTBEAT_MS = 25_000;

export function attachChatStream(res: Response, poolId: string): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let set = clients.get(poolId);
  if (!set) {
    set = new Set();
    clients.set(poolId, set);
  }
  set.add(res);

  const heartbeat = setInterval(() => {
    writeSseEvent(res, { event: "heartbeat", data: JSON.stringify({ ts: Date.now() }) });
  }, HEARTBEAT_MS);

  res.on("close", () => {
    clearInterval(heartbeat);
    set?.delete(res);
    if (set && set.size === 0) clients.delete(poolId);
  });
}

export function broadcastChat(message: ChatMessage): void {
  const set = clients.get(message.poolId);
  if (!set) return;
  for (const res of set) {
    writeSseEvent(res, { event: "chat", data: JSON.stringify(message) });
  }
}

/** Nudges every open page for this pool to refetch (entries, payments, status). */
export function broadcastPoolUpdate(
  poolId: string,
  change: "entry" | "payment" | "status",
): void {
  const set = clients.get(poolId);
  if (!set) return;
  for (const res of set) {
    writeSseEvent(res, { event: "pool", data: JSON.stringify({ poolId, change }) });
  }
}
