import { config } from "../config.js";
import type { TxLineOddsRow, TxLineRawFixture, TxLineScoreRow } from "./types.js";

let guestJwt = config.txlineGuestJwt;

export async function refreshGuestJwt(): Promise<string> {
  const res = await fetch(`${config.txlineApiOrigin}/auth/guest/start`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`TxLINE guest auth failed (${res.status})`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("TxLINE guest auth returned no token");
  guestJwt = data.token;
  return guestJwt;
}

export async function getGuestJwt(): Promise<string> {
  if (guestJwt) return guestJwt;
  return refreshGuestJwt();
}

async function txlineFetch<T>(path: string, init?: RequestInit, retry = true): Promise<T> {
  const jwt = await getGuestJwt();
  const res = await fetch(`${config.txlineApiOrigin}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "X-Api-Token": config.txlineApiToken,
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401 && retry) {
    await refreshGuestJwt();
    return txlineFetch(path, init, false);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `TxLINE ${path} failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  return res.json() as Promise<T>;
}

export async function fetchFixturesSnapshot(options?: {
  startEpochDay?: number;
  competitionId?: number;
}): Promise<TxLineRawFixture[]> {
  const params = new URLSearchParams();
  if (options?.startEpochDay != null) {
    params.set("startEpochDay", String(options.startEpochDay));
  }
  if (options?.competitionId != null) {
    params.set("competitionId", String(options.competitionId));
  }
  const qs = params.toString();
  return txlineFetch<TxLineRawFixture[]>(`/api/fixtures/snapshot${qs ? `?${qs}` : ""}`);
}

export async function fetchOddsSnapshot(fixtureId: number): Promise<TxLineOddsRow[]> {
  return txlineFetch<TxLineOddsRow[]>(`/api/odds/snapshot/${fixtureId}`);
}

export async function fetchScoresSnapshot(fixtureId: number): Promise<TxLineScoreRow[]> {
  return txlineFetch<TxLineScoreRow[]>(`/api/scores/snapshot/${fixtureId}`);
}

export async function mapPool<T, R>(
  items: T[],
  mapper: (item: T) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await mapper(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
