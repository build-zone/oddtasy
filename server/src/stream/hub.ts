import type { Response } from "express";
import { config } from "../config.js";
import { getGuestJwt, refreshGuestJwt } from "../txline/client.js";
import { consumeSseResponse, writeSseEvent, type ParsedSseEvent } from "./sse.js";

type StreamClient = {
  res: Response;
  fixtureId?: number | undefined;
};

type StreamKind = "odds" | "scores";
type StreamListener = (event: ParsedSseEvent) => void;

const UPSTREAM_PATHS: Record<StreamKind, string> = {
  odds: "/api/odds/stream",
  scores: "/api/scores/stream",
};

class StreamHub {
  private clients: Record<StreamKind, Set<StreamClient>> = {
    odds: new Set(),
    scores: new Set(),
  };

  private listeners: Record<StreamKind, Set<StreamListener>> = {
    odds: new Set(),
    scores: new Set(),
  };

  private alwaysOn = new Set<StreamKind>();
  private upstreamTasks: Partial<Record<StreamKind, Promise<void>>> = {};

  addClient(kind: StreamKind, res: Response, fixtureId?: number): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const client: StreamClient = { res, fixtureId };
    this.clients[kind].add(client);

    res.on("close", () => {
      this.clients[kind].delete(client);
    });

    this.ensureUpstream(kind);
  }

  ensureUpstream(kind: StreamKind, permanent = false): void {
    if (permanent) this.alwaysOn.add(kind);
    if (!this.upstreamTasks[kind]) {
      this.upstreamTasks[kind] = this.runUpstream(kind).finally(() => {
        delete this.upstreamTasks[kind];
      });
    }
  }

  subscribe(kind: StreamKind, listener: StreamListener): () => void {
    this.listeners[kind].add(listener);
    return () => {
      this.listeners[kind].delete(listener);
    };
  }

  private shouldRun(kind: StreamKind): boolean {
    return this.clients[kind].size > 0 || this.alwaysOn.has(kind);
  }

  private emit(kind: StreamKind, event: ParsedSseEvent): void {
    for (const listener of this.listeners[kind]) {
      listener(event);
    }
  }

  private broadcast(kind: StreamKind, event: ParsedSseEvent): void {
    this.emit(kind, event);

    if (event.event === "heartbeat") {
      for (const client of this.clients[kind]) {
        writeSseEvent(client.res, event);
      }
      return;
    }

    let fixtureId: number | undefined;
    try {
      const payload = JSON.parse(event.data) as { FixtureId?: number; fixtureId?: number };
      fixtureId = payload.FixtureId ?? payload.fixtureId;
    } catch {
      // Non-JSON payloads are forwarded as-is.
    }

    for (const client of this.clients[kind]) {
      if (client.fixtureId != null && fixtureId != null && client.fixtureId !== fixtureId) {
        continue;
      }
      writeSseEvent(client.res, event);
    }
  }

  private async runUpstream(kind: StreamKind): Promise<void> {
    let attempt = 0;

    while (this.shouldRun(kind)) {
      try {
        await this.connectUpstream(kind);
        attempt = 0;
      } catch (err) {
        if (!this.shouldRun(kind)) break;

        attempt += 1;
        const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
        console.warn(
          `[stream:${kind}] upstream disconnected; retry in ${delayMs}ms`,
          err instanceof Error ? err.message : err,
        );
        await sleep(delayMs);
      }
    }
  }

  private async connectUpstream(kind: StreamKind): Promise<void> {
    const jwt = await getGuestJwt();
    const path = UPSTREAM_PATHS[kind];
    const res = await fetch(`${config.txlineApiOrigin}${path}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "X-Api-Token": config.txlineApiToken,
        Accept: "text/event-stream",
      },
    });

    if (res.status === 401) {
      await refreshGuestJwt();
      throw new Error("TxLINE JWT expired");
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `TxLINE ${path} failed (${res.status})${body ? `: ${body.slice(0, 120)}` : ""}`,
      );
    }

    console.log(`[stream:${kind}] connected to TxLINE`);
    await consumeSseResponse(res, (event) => this.broadcast(kind, event));
    throw new Error("upstream stream ended");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const streamHub = new StreamHub();

export function attachOddsStream(res: Response, fixtureId?: number): void {
  streamHub.addClient("odds", res, fixtureId);
}

export function attachScoresStream(res: Response, fixtureId?: number): void {
  streamHub.addClient("scores", res, fixtureId);
}
