# Oddtasy

Social betting on Solana. Users create and join fixed-stake pools around football markets; this repo’s API sits between the frontend, the TxLINE odds/scores feed, and the on-chain betting program.

## Architecture

```
Frontend  →  Oddtasy API (:4100)  →  TxLINE (fixtures, odds, scores SSE)
                      │
                      ├→ local pool store (data/oddtasy.json)
                      └→ Solana betting program (PDAs + optional resolver)
```

**What the server does**

1. **TxLINE proxy** — Keeps `TXLINE_API_TOKEN` / guest JWT server-side. Serves fixtures, raw odds, normalized markets, and SSE streams so the client never talks to TxLINE directly.
2. **Social markets** — Maps TxLINE books (and optionally an exact-score model) into program-ready options: match result, over/under, correct score.
3. **Pool metadata** — Local JSON mirror of social pools and entries. Create/enter return Solana PDA + instruction args; the **user wallet** still signs on-chain.
4. **Settlement worker** — When TxLINE is configured, listens to the scores stream. With a resolver key + IDL it can lock/resolve/cancel pools; without that it runs in local mirror mode only.

**Non-custodial**

| Action | Who signs |
| --- | --- |
| `create_pool`, `enter_pool`, `claim_winnings`, `claim_refund` | User wallet |
| `lock` / `resolve` / `cancel` | Backend resolver (optional) |

## Quick start

```bash
cd server
cp .env.example .env
# set TXLINE_API_TOKEN (and optionally TXLINE_GUEST_JWT)
npm install
npm run dev
```

API listens on **http://localhost:4100** by default (`PORT` in `.env`).

| Script | Purpose |
| --- | --- |
| `npm run dev` | API with file watch |
| `npm run start` | API once |
| `npm run test:e2e` | Live TxLINE integration e2e (API must be running) |
| `npm run test` | Typecheck + settlement unit tests |

## Environment

| Variable | Role |
| --- | --- |
| `PORT` | HTTP port (default `4100`) |
| `CORS_ORIGIN` | Allowed frontend origin |
| `TXLINE_API_ORIGIN` | TxLINE host (default `https://txline.txodds.com`) |
| `TXLINE_API_TOKEN` | Required for fixtures/odds/streams |
| `TXLINE_GUEST_JWT` | Optional; refreshed by the API when needed |
| `FIXTURES_CACHE_MS` | Fixture list cache TTL |
| `SOLANA_RPC` | RPC endpoint |
| `ODDTASY_BETTING_PROGRAM_ID` | On-chain program id |
| `ODDTASY_USDC_MINT` | Stake mint |
| `ODDTASY_PROGRAM_IDL` | Path to Anchor IDL (resolver mode) |
| `ODDTASY_RESOLVER_KEY` / `ODDTASY_RESOLVER_KEYPAIR` | Resolver signer |
| `ODDTASY_DATA_FILE` | Local pool store path |
| `ODDTASY_DEFAULT_STAKE_USDC` / `RAKE_BPS` / `MAX_ENTRIES` | Pool defaults |
| `ODDTASY_CORRECT_SCORE_CAP` | Exact-score grid size (`0…cap`, last bucket is `cap+`) |

## API reference

Base URL: `http://localhost:4100`

### Health

#### `GET /health`

Liveness + config flags (no secrets).

```json
{
  "ok": true,
  "txlineConfigured": true,
  "txlineApiOrigin": "https://txline.txodds.com",
  "bettingProgramId": "...",
  "usdcMint": "...",
  "resolverConfigured": false,
  "resolverModeReady": false
}
```

### Fixtures & odds

#### `GET /fixtures`

Cached World Cup + international friendlies snapshot from TxLINE, with status/scores derived from the scores feed.

Each item includes `FixtureId` / `fixtureId`, teams, `StartTime`, `kickoffIso`, `status` (`scheduled` \| `live` \| `finished`), scores when known, competition/stage fields.

#### `GET /fixtures/:fixtureId/odds`

Raw TxLINE StablePrice rows for that fixture (`Prices` are decimal odds × 1000). Empty `[]` means no book for that id (still HTTP 200).

#### `GET /fixtures/:fixtureId/markets`  
#### `GET /fixtures/:fixtureId/normalized-markets`

Same payload: odds deduped into markets with outcomes.

- `decimalOdds` = `rawPrice / 1000`
- `multiplier` applies a small house edge from implied probability
- `txLineMessageId` is the odds proof / stream message id

#### `GET /fixtures/:fixtureId/social-options`

Program-ready social markets for the betting program.

| Query | Default | Meaning |
| --- | --- | --- |
| `source` | `hybrid` | `txline` \| `model` \| `hybrid` |
| `homeLambda` / `awayLambda` / `rho` | — | Dixon–Coles inputs (needed for model prices) |
| `correctScoreCap` | env default (`4`) | Exact-score grid size |

Response shape:

```json
{
  "fixtureId": 18213979,
  "source": "txline",
  "correctScoreCap": 4,
  "socialMarkets": [
    {
      "marketType": 0,
      "marketKey": "match_result",
      "marketParam": 0,
      "outcomeCount": 3,
      "options": [
        {
          "prediction": 0,
          "label": "Home",
          "decimalOdds": 4.33,
          "priceSource": "txline",
          "txLineMessageId": "..."
        }
      ],
      "dataNote": "..."
    }
  ]
}
```

- `marketType`: `0` match result, `1` over/under, `2` correct score  
- `prediction`: index the on-chain program expects  
- `priceSource`: `txline` \| `model_fair` \| `unpriced`

### Live streams (SSE)

#### `GET /stream/odds?fixtureId=`  
#### `GET /stream/scores?fixtureId=`

Server-Sent Events proxy of TxLINE streams. Optional `fixtureId` filters non-heartbeat events. Heartbeats look like:

```
event: heartbeat
data: {"Ts":1783802981}
```

### Social pools

Local metadata only — users still sign chain txs. Records live in `ODDTASY_DATA_FILE` (default `data/oddtasy.json`).

#### `GET /pools`

List pools. Query filters: `fixtureId`, `wallet`, `status` (`open` \| `locked` \| `resolved` \| `voided` \| `cancelled`).

Each pool includes derived `chain` PDAs (`config`, `pool`, `vault`, …).

#### `POST /pools`

Create a pool record and return chain instruction args.

Body (required): `hostWallet`, `fixtureId`, `fixtureLabel`, `marketType`, `marketKey`, `marketParam`, `outcomeCount` (≥ 2), `deadline` (unix seconds, must be in the future).

Optional: `id` (UUID), `optionLabel`, `stakeUsdc`, `rakeBps` (0–1000), `maxEntries`, `createTxSignature`.

Returns `201` with `{ pool, chain, instruction }`.

#### `GET /pools/:poolId`

Pool + entries + chain PDAs.

#### `GET /pools/:poolId/chain?member=`

Chain PDAs only; pass `member` wallet to include the entry PDA.

#### `POST /pools/:poolId/entries`

Record an entry after (or before mirroring) `enter_pool` on-chain.

Body: `wallet`, `prediction` (in range for the pool), optional `optionLabel`, `enterTxSignature`.

Returns `201` with `{ entry, pool, chain, instruction }` (`enterPool` args). Rejects duplicates, closed/full pools, and out-of-range predictions.

## Typical client flow

1. `GET /fixtures` → pick a scheduled/live match  
2. `GET /fixtures/:id/social-options?source=txline` → choose a market + prediction  
3. `POST /pools` → show user the `instruction` / PDAs → wallet signs `create_pool`  
4. Others `POST /pools/:id/entries` → wallet signs `enter_pool`  
5. Subscribe to `/stream/scores` (and odds if needed) for live updates  
6. After the match, resolver (if configured) settles; winners claim on-chain  

## Testing

Live integration e2e (requires the API running with a valid `TXLINE_API_TOKEN`):

```bash
cd server
npm run test:e2e
```

Optional override:

```bash
BASE_URL=http://localhost:4100 npm run test:e2e
```

The suite probes real TxLINE books (fails if none are priced), checks StablePrice → market math, requires txline-priced social options, exercises pool create/enter, and asserts SSE payloads.
