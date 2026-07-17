# Oddtasy — Technical Submission Doc

**Hackathon:** TxODDS World Cup Hackathon (Superteam Earn)
**Track:** Consumer & Fan Experiences
**Repo:** github.com/build-zone/oddtasy (public)
**Deployed:** [fill in live URL — verify Privy allowlist before submitting]
**Chain:** Solana devnet

---

## 1. What it is

Oddtasy is a mobile-first social betting app for the World Cup. Fans create a **pool** around a real match, everyone stakes the **same** amount of USDC, each picks an outcome, and after full time the **winners split the pot** (minus a small rake). Stakes sit in an on-chain vault — **non-custodial**; the app never holds funds. Every fixture and every live score comes from **TxODDS' TxLINE feed**; settlement is driven by the TxLINE final score.

---

## 2. Architecture

```
  Mobile web (Next.js)
        │   REST + SSE
        ▼
  Oddtasy API  (Node/Express, :4100)
        │
        ├──►  TxLINE  (fixtures snapshot · scores SSE · odds snapshot/stream)
        │
        └──►  Solana devnet betting program  (config/pool/vault/entry PDAs)
                 ▲
                 └── resolver worker settles from the TxLINE scores stream
```

- **API as a proxy + adapter.** The TxLINE API token and guest JWT stay server-side; the client never talks to TxLINE directly. The API normalizes TxLINE rows into program-ready markets and re-broadcasts the TxLINE SSE streams to browsers.
- **Non-custodial on-chain.** `create_pool` / `enter_pool` / `claim_winnings` / `claim_refund` are signed by the **user's** wallet (Privy embedded Solana wallet). Only `lock` / `resolve` / `cancel` are signed by a backend **resolver** key.

---

## 3. TxLINE integration — exact endpoints used

**Host (devnet):** `https://txline-dev.txodds.com` (config `TXLINE_API_ORIGIN`; mainnet default `https://txline.txodds.com`)
**Auth headers on every data call:** `Authorization: Bearer <guestJwt>` + `X-Api-Token: <apiToken>`
**Auth flow:** on `401`, the API calls the guest-auth endpoint once to refresh the JWT and retries the request.

| # | Method & path | Purpose in Oddtasy | Source |
|---|---|---|---|
| 1 | `POST /auth/guest/start` | Obtain / refresh the guest JWT used to authorize all data calls | `src/txline/client.ts` |
| 2 | `GET /api/fixtures/snapshot?startEpochDay={d}&competitionId={id}` | The matches board — real WC schedule. Queried across several `startEpochDay` windows to assemble the full slate (see feedback §7). | `src/txline/client.ts` |
| 3 | `GET /api/scores/snapshot/{fixtureId}` | Per-fixture score + match phase; derives `scheduled` / `live` / `finished` status | `src/txline/client.ts` |
| 4 | `GET /api/odds/snapshot/{fixtureId}` | Book prices for a fixture, when present (free tier returns `[]` — see feedback §7) | `src/txline/client.ts` |
| 5 | `GET /api/scores/stream` (SSE) | **Live score stream** — powers the live pitch stage, goal pops, and the settlement worker | `src/stream/hub.ts` |
| 6 | `GET /api/odds/stream` (SSE) | Live odds stream — subscribed and re-broadcast; overrides model prices when a book appears | `src/stream/hub.ts` |

**How the app re-exposes them (client-facing, all server-side proxied):**

| Oddtasy endpoint | Backed by |
|---|---|
| `GET /fixtures` | (2) + (3) |
| `GET /fixtures/:id/odds`, `/normalized-markets`, `/social-options` | (4) + model |
| `GET /stream/scores?fixtureId=` | (5) |
| `GET /stream/odds?fixtureId=` | (6) |

---

## 4. On-chain settlement

- **Program (devnet):** `42YpRKawvR2NtiTs4YDhurmsecmPC6hmGDx5KX25hqxn` (Anchor module `club_pool`)
- **Stake mint (devnet USDC):** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
- **RPC:** `https://api.devnet.solana.com`
- **PDAs:** `config`, `pool`, `vault`, `entry` (derived per pool/member).

**Settlement logic.** The resolver worker subscribes to the TxLINE scores stream (5). When a fixture reaches a final phase, it `lock`s then `resolve`s the pool to the winning outcome computed from the **90-minute regulation score**; abandoned matches `cancel` → pull-based refund. Payout is pull-based (`claim_winnings`). The program is **market-agnostic** — `resolve_pool` pays one `winning_outcome < outcome_count` — so all market types below settle without a program change.

**Market types** (each a clean partition so exactly one outcome wins):

| marketType | Market | Outcomes |
|---|---|---|
| 0 | Match result (1X2) | Home / Draw / Away |
| 1 | Total goals over/under | Under / Over (line = `marketParam`) |
| 2 | Correct score | grid `0…cap`, last bucket `cap+` |
| 3 | Both teams to score | No / Yes |
| 4 | Total goals odd/even | Even / Odd |

---

## 5. Pricing — stated honestly

The free World Cup tier ships **fixtures and scores but no odds books** (see §7). So Oddtasy's prices are **model-generated**, not market data: a **Dixon–Coles** goals model fitted on **5,300+ real international matches** (opponent-adjusted Poisson, recency-weighted). When a real book *does* appear on the odds stream (6), it **overrides** the model price. The app surfaces this provenance in-product — we don't present model prices as market prices.

---

## 6. Run it

```bash
cd server && cp .env.example .env   # set TXLINE_API_TOKEN
npm install && npm run dev          # API on :4100
cd ../web && npm install && npm run dev   # web on :3000
```

Live TxLINE integration test: `cd server && npm run test:e2e` (probes real fixtures + asserts SSE payloads).

---

## 7. Feedback on the TxLINE API

Honest notes from building against it — offered as product feedback, not complaints.

1. **Fixtures + scores worked well.** The snapshot + SSE model is clean; the scores stream is reliable enough to drive both a live UI and automated settlement off the same feed. Guest-JWT-then-`X-Api-Token` auth was straightforward once we handled the `401 → re-auth → retry` path.

2. **The free World Cup tier carries no odds books.** `GET /api/odds/snapshot/{id}` returns HTTP 200 `[]` for **every** WC fixture we sampled — including imminent marquee matches — and `GET /api/odds/stream` connects but delivers no odds messages in-window. The endpoints are authorized and correct; they're just empty on this tier. This is the single biggest thing that shaped our build: it forced us to price everything with our own model. **Suggestion:** document per-tier which data classes actually carry payloads, so builders know upfront that fixtures/scores ≠ odds on the free bundle.

3. **Fixtures snapshot returns only a near-term window.** A bare `GET /api/fixtures/snapshot` returned only a handful of near-term fixtures; assembling the full 100+ match slate required querying multiple `startEpochDay` windows and merging. **Suggestion:** a documented date-range parameter (or an explicit "return N days" flag) would remove the guesswork.

4. **Club competitions are bundle-gated with a clear 403.** Any `competitionId` outside the WC + Friendlies bundle returns `403 "Competition N is not in your bundle"`. The error is clear and correct — the friction is only that discovering which IDs are in-bundle is trial-and-error. **Suggestion:** an endpoint that lists the caller's entitled competitions.

5. **Devnet vs mainnet separation is right but easy to trip on.** Separate hosts, program IDs, and mints per network is the correct design; a one-page "don't mix these" matrix in the docs would save first-day mistakes.

6. **SSE heartbeats are helpful** for distinguishing "connected but quiet" from "dropped" — we relied on them and re-broadcast connection state to clients.

**Net:** the live-scores path is genuinely production-grade and is the backbone of Oddtasy. The main gap for a betting-shaped product is odds availability on the free tier — clearer per-tier data-coverage docs would have saved us the most time.
