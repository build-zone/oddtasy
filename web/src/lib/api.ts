import type {
  ChatMessage,
  ClaimTxResponse,
  CreatePoolResponse,
  EnterPoolResponse,
  HealthResponse,
  OddtasyFixture,
  PoolDetailResponse,
  PoolStatus,
  PoolWithChain,
  SocialOptionsResponse,
  UserProfile,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_ODDTASY_API ?? "http://localhost:4100";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>("/health"),

  fixtures: () => request<OddtasyFixture[]>("/fixtures"),

  socialOptions: (
    fixtureId: number,
    source: "txline" | "model" | "hybrid" = "hybrid",
    lambdas?: { homeLambda: number; awayLambda: number; rho: number },
  ) => {
    const q = new URLSearchParams({ source });
    if (lambdas) {
      q.set("homeLambda", String(lambdas.homeLambda));
      q.set("awayLambda", String(lambdas.awayLambda));
      q.set("rho", String(lambdas.rho));
    }
    return request<SocialOptionsResponse>(
      `/fixtures/${fixtureId}/social-options?${q.toString()}`,
    );
  },

  pools: (params?: { fixtureId?: number; wallet?: string; status?: PoolStatus }) => {
    const q = new URLSearchParams();
    if (params?.fixtureId != null) q.set("fixtureId", String(params.fixtureId));
    if (params?.wallet) q.set("wallet", params.wallet);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return request<PoolWithChain[]>(`/pools${qs ? `?${qs}` : ""}`);
  },

  pool: (poolId: string) => request<PoolDetailResponse>(`/pools/${poolId}`),

  createPool: (body: {
    hostWallet: string;
    fixtureId: number;
    fixtureLabel: string;
    marketType: number;
    marketKey: string;
    marketParam: number;
    outcomeCount: number;
    optionLabel?: string;
    stakeUsdc?: number;
    rakeBps?: number;
    maxEntries?: number;
    deadline: number;
    createTxSignature?: string;
    /** the host's own pick — hosting stakes the first bet in the same tx */
    hostPrediction?: number;
  }) =>
    request<CreatePoolResponse>("/pools", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  enterPool: (
    poolId: string,
    body: {
      wallet: string;
      prediction: number;
      optionLabel?: string;
      enterTxSignature?: string;
    },
  ) =>
    request<EnterPoolResponse>(`/pools/${poolId}/entries`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  messages: (poolId: string, limit = 50) =>
    request<ChatMessage[]>(`/pools/${poolId}/messages?limit=${limit}`),

  sendMessage: (poolId: string, body: { wallet: string; text: string }) =>
    request<ChatMessage>(`/pools/${poolId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  createPoolTx: (poolId: string, wallet: string) =>
    request<ClaimTxResponse>(`/pools/${poolId}/create-tx`, {
      method: "POST",
      body: JSON.stringify({ wallet }),
    }),

  entryPaymentTx: (poolId: string, wallet: string) =>
    request<ClaimTxResponse>(`/pools/${poolId}/entries/tx`, {
      method: "POST",
      body: JSON.stringify({ wallet }),
    }),

  claimPool: (poolId: string, wallet: string, kind: "claim" | "refund") =>
    request<ClaimTxResponse>(`/pools/${poolId}/${kind}`, {
      method: "POST",
      body: JSON.stringify({ wallet }),
    }),

  reportTx: (
    poolId: string,
    body: {
      kind: "create" | "enter" | "claim" | "refund";
      signature: string;
      wallet?: string;
    },
  ) =>
    request<{ ok: boolean }>(`/pools/${poolId}/tx`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getUser: (wallet: string) => request<UserProfile>(`/users/${wallet}`),

  upsertUser: (
    wallet: string,
    body: { displayName?: string; email?: string; avatarUrl?: string },
  ) =>
    request<UserProfile>(`/users/${wallet}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export function chatStreamUrl(poolId: string): string {
  return `${API_BASE}/stream/chat?poolId=${encodeURIComponent(poolId)}`;
}

export function scoresStreamUrl(fixtureId?: number): string {
  return `${API_BASE}/stream/scores${fixtureId != null ? `?fixtureId=${fixtureId}` : ""}`;
}

export function oddsStreamUrl(fixtureId?: number): string {
  return `${API_BASE}/stream/odds${fixtureId != null ? `?fixtureId=${fixtureId}` : ""}`;
}
