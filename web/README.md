# Oddtasy Web

Mobile-first frontend for Oddtasy — social betting pools on Solana, live off
TxLINE World Cup data. Next.js App Router + Tailwind v4 + Privy embedded
wallets + React Query.

The visual language ("floodlit pitch at night": Space Grotesk + IBM Plex Mono,
gold/cyan home–away semantics, heat-matrix market tiles, bottom-sheet flows)
is a shared design language so the product family reads as one.

## Run

```bash
cp .env.example .env.local   # add NEXT_PUBLIC_PRIVY_APP_ID for login
npm install
npm run dev                  # expects the API on http://localhost:4100
```

Start the API first (`../server`, `npm run dev`) with a valid
`TXLINE_API_TOKEN`, and set its `CORS_ORIGIN=http://localhost:3000`.

## Screens

| Route | Purpose |
| --- | --- |
| `/` | Matches board — day pager, live scores, entry point to host a pool |
| `/fixtures/[id]` | Market picker (1X2 bar · O/U lines · correct-score heat matrix) → host-a-pool sheet |
| `/pools` | All pools with status filters |
| `/pools/[id]` | The core screen: live TxLINE score, pot/entries, state-dependent action panel (join → watch → claim/refund), sealed entries until kickoff, invite link |
| `/me` | Profile: embedded wallet, devnet USDC/SOL balances, my pools |

## Architecture notes

- **Wallet seam** — screens use `useWallet()` (`components/wallet-context.tsx`),
  never the Privy SDK directly. Without `NEXT_PUBLIC_PRIVY_APP_ID` the app
  boots wallet-less and write CTAs disable with an explanation.
- **Pattern A ready** — `createPool`/`enterPool` responses are typed with an
  optional `transaction` (base64 unsigned tx). The moment the server
  tx-builder ships, the existing flows sign via Privy and report the base58
  signature; today they fall back to record-only with an honest toast.
- **DTOs** — `lib/types.ts` mirrors `server/src` shapes exactly. Server wins.
- **Live data honesty** — SSE scores carry an `asOf`/connected state; the UI
  labels reconnects instead of freezing a stale score. Prices show their
  provenance (`txline` / `model_fair` / `unpriced`).
- Correct-score prediction index is `home * (cap+1) + away`; over/under is
  **under = 0, over = 1** (server encoding — don't "fix" it).
