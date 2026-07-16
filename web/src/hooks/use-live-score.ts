"use client";

import { useEffect, useRef, useState } from "react";
import { scoresStreamUrl } from "@/lib/api";
import { extractLiveScore, type LiveScore, type ScoreStreamRow } from "@/lib/types";

/**
 * Subscribes to the server's /stream/scores SSE proxy for one fixture.
 * Reconnects with backoff; exposes the latest score plus a staleness stamp
 * so the UI can label a stalled stream instead of silently freezing
 * (the "never invent data" rule).
 */
export function useLiveScore(fixtureId: number | null, active = true) {
  const [score, setScore] = useState<LiveScore | null>(null);
  const [connected, setConnected] = useState(false);
  const retry = useRef(0);

  useEffect(() => {
    if (fixtureId == null || !active) return;
    let source: EventSource | null = null;
    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      source = new EventSource(scoresStreamUrl(fixtureId));
      source.onopen = () => {
        retry.current = 0;
        setConnected(true);
      };
      source.onmessage = (e) => {
        try {
          const row = JSON.parse(e.data) as ScoreStreamRow;
          const next = extractLiveScore(row);
          if (next && next.fixtureId === fixtureId) setScore(next);
        } catch {
          /* heartbeats / non-JSON frames */
        }
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
    };
  }, [fixtureId, active]);

  return { score, connected };
}
