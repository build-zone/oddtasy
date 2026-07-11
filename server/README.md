# Oddtasy API

Express backend for Oddtasy. Full project docs live in the [root README](../README.md).

## Run

```bash
cp .env.example .env
npm install
npm run dev
```

Listens on **http://localhost:4100**.

## Scripts

```bash
npm run dev        # watch mode
npm run start      # single process
npm run test:e2e   # live TxLINE integration e2e (API must be up)
npm run test       # typecheck + settlement unit tests
```

## Endpoints (summary)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | TxLINE + resolver status |
| `GET` | `/fixtures` | Fixture snapshot |
| `GET` | `/fixtures/:id/odds` | Raw TxLINE odds |
| `GET` | `/fixtures/:id/markets` | Normalized markets |
| `GET` | `/fixtures/:id/normalized-markets` | Alias of `/markets` |
| `GET` | `/fixtures/:id/social-options` | Program-ready social markets |
| `GET` | `/stream/odds` | Odds SSE |
| `GET` | `/stream/scores` | Scores SSE |
| `GET` | `/pools` | List pools |
| `POST` | `/pools` | Create pool + chain args |
| `GET` | `/pools/:id` | Pool + entries |
| `GET` | `/pools/:id/chain` | PDAs |
| `POST` | `/pools/:id/entries` | Record entry + chain args |
