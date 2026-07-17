# Oddtasy — Demo Video Storyboard & Script

**Hackathon:** TxODDS World Cup Hackathon (Superteam Earn)
**Track:** Consumer & Fan Experiences
**Target length:** 3:45 (hard ceiling 5:00 — judged heavily; keep it tight)
**Format:** Landscape **16:9 (1920×1080)** delivery, assembled in CapCut. The mobile app screen-recordings (390×844, 9:16) sit on the **right** of frame; a **text panel** sits on the left; atmosphere clips and cards fill the full frame. See **Video build spec (locked)** at the bottom for the exact composite, colors, fonts, and asset prompts.
**Rubric we are aiming at:** mainstream-fan UX polish · real-time responsiveness · originality · monetization path · completeness.

---

## The spine (memorize this — every scene serves it)

- **Problem.** Every match, your group chat argues who wins — loudly, and for nothing. It never settles, nobody keeps score. The only way to make it real today is a bookmaker: custodial, geo-locked, and the opposite of social.
- **Solution.** Oddtasy turns any match into a pool your friends jump into — same buy-in, everyone picks, winners split the prize. On Solana, non-custodial, no bookmaker in the middle.
- **Proof (what we built).** Real TxLINE fixtures + live scores over SSE · five market types · per-pool live chat · a live pitch stage · non-custodial on-chain pools with pull-based claims · **automatic settlement from the TxLINE final score** · honest Dixon–Coles pricing.

---

## What we actually built (the full inventory the video is proving)

This is the checklist behind every claim in the script. Nothing in the VO is aspirational — it all maps to something on screen.

**Frontend — mobile-first Next.js web app (390×844)**
- Matches board rendering the real World Cup schedule from TxLINE.
- Fixture page with a full **market picker**: 1X2 result cards, Total Goals (2.5 line + disclosure), correct-score **heat matrix**, BTTS, Odd/Even.
- **Host-a-pool** sheet: choose outcome, set the buy-in, confirm.
- **Privy embedded Solana wallet** — the user signs `create_pool` / `enter_pool` / `claim_winnings` themselves.
- **Join** flow for a second player picking the opposite side.
- **Live group chat per pool**, with emoji reactions.
- **Live pitch stage**: SVG pitch, moving ball, leader chip, phase label, **goal popups** off real score deltas.
- **Win takeover**: full-viewport bloom, payout count-up, Claim CTA, real devnet tx hash on the paid state.

**Backend — Node/Express API (`:4100`), proxy + adapter**
- **TxLINE proxy** keeps `TXLINE_API_TOKEN` + guest JWT server-side; the client never touches TxLINE directly.
- Guest-auth flow with `401 → re-auth → retry`.
- Normalizes TxLINE StablePrice rows into **program-ready social markets** (`match_result`, `over/under`, `correct_score`, …).
- Re-broadcasts TxLINE **SSE streams** (scores + odds) to browsers.
- **Social-pool metadata** store; create/enter return the Solana PDAs + instruction args for the user to sign.
- **Settlement worker** subscribes to the scores stream and drives `lock` / `resolve` / `cancel` on-chain.

**On-chain — Solana devnet, Anchor program (`club_pool`)**
- Program `42YpRKawvR2NtiTs4YDhurmsecmPC6hmGDx5KX25hqxn`; devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- PDAs: `config`, `pool`, `vault`, `entry`.
- **Non-custodial**: user signs `create_pool` / `enter_pool` / `claim_winnings` / `claim_refund`; only `lock` / `resolve` / `cancel` are the backend resolver.
- **Pull-based payout**; abandoned matches `cancel` → refund.
- **Market-agnostic** `resolve_pool` pays one `winning_outcome < outcome_count`, so all five market types settle with no program change. Settlement uses the **90-minute regulation score**.

**TxLINE endpoints used (six)**
`POST /auth/guest/start` · `GET /api/fixtures/snapshot` · `GET /api/scores/snapshot/{id}` · `GET /api/odds/snapshot/{id}` · `GET /api/scores/stream` (SSE) · `GET /api/odds/stream` (SSE).

**Pricing — stated honestly**
The free WC tier ships fixtures + scores but **no odds books**, so prices come from our own **Dixon–Coles** goals model (opponent-adjusted Poisson, recency-weighted) fitted on **5,300+ real international matches**. When a real book appears on the odds stream it **overrides** the model — and the app surfaces the provenance in-product.

---

## Guiding principles for this cut

1. **Show, don't tell.** Every claim is on screen within 2 seconds of saying it. No slides of bullet points.
2. **Real data, on screen, early.** Judges must see TxLINE is the live source — fixtures + live scores — not a mock. Put a real match on screen in the first 45 seconds.
3. **One emotional peak.** The win takeover is the money shot. Everything builds to it; nothing competes with it.
4. **Honesty is a feature.** We say out loud that prices are our model (free tier ships no books) and that funds are real devnet USDC, non-custodial. Judges reward this; fabrication is an auto-DQ.
5. **Mobile-first is the pitch.** Record on a phone-sized viewport. This is a product a fan uses on the couch during a match.
6. **House copy voice.** Fan-facing lines say **bet / prize / players** and show money as **$** — never *stake / pot / rake*. The precise terms (`rake`, `vault`, `devnet USDC`) live only in the technical/honesty card, where accuracy beats voice.

---

## Pre-record checklist (do this before you hit record)

- [ ] **Both servers up:** API on `:4100`, web on `:3000`. (Already running.)
- [ ] **Pre-warm the fixtures fetch** — load `/` once and leave it; cold TxLINE fetch is ~12s to first paint and looks broken on camera. Record on the second load.
- [ ] **Two wallets staged** with opposite picks on the demo pool (needed to show a real *win* — a solo pool voids/refunds instead of paying). Pool `5bb38f3f` (France vs Spain) already has a second wallet on Away.
- [ ] **User wallet funded** (~devnet USDC + SOL for fees) and logged in via Privy on `localhost:3000` (the allowlisted origin).
- [ ] **Dev resolve enabled** (`ODDTASY_DEV_TOOLS=1`) so the settlement beat can fire on demand — this drives the *real* on-chain lock+resolve path; only the winning outcome is chosen. All devnet fixtures are `NS`, so this is the only way to show a payout on camera.
- [ ] **Reduced-motion off** in the OS so the pitch-stage ball and the takeover count-up animate.
- [ ] **Screen recorder** at 60fps if possible (the takeover count-up and goal popups benefit).
- [ ] **Notifications silenced**, status bar clean, time set to something neutral.
- [ ] **Deployed URL verified live + on the Privy allowlist** — it appears on the Scene 7 and Scene 8 cards and in the submission fields. (Still a placeholder in the repo docs — fill it in.)

---

## Scene-by-scene

### SCENE 0 — Cold open (0:00–0:12)

| | |
|---|---|
| **Visual** | Straight into the app on a phone. A real, recognizable World Cup fixture is on the matches board (e.g. **Spain vs Argentina**), a live-looking match ticking at the top. Thumb scrolls once. |
| **On-screen text** | *(none yet — let the product speak)* |
| **Narration (VO)** | "It's the World Cup. Your group chat is arguing about who wins — loudly, endlessly, and for nothing. What if it actually meant something?" |
| **Production note** | No logo card first. Open *in* the product — judges have watched 30 intros today. Lead with the **pain**, not the setting: the argument never settles, nobody keeps score. The logo card comes at 0:12 once we've earned 3 seconds of attention. |

### SCENE 1 — What it is (0:12–0:35)

| | |
|---|---|
| **Visual** | Quick logo card (1.5s): **Oddtasy** wordmark + one line. Cut back to the matches board scrolling. |
| **On-screen text** | Card: **Oddtasy — social betting pools for football, on Solana.** Lower-third when back in app: *Live fixtures from TxODDS' TxLINE feed.* |
| **Narration (VO)** | "Oddtasy turns any match into a pool your friends jump into. Everyone puts in the same — say ten dollars — everyone picks an outcome, and the winners split the prize. Real money, on-chain, non-custodial. No bookmaker in the middle — just you and your friends." |
| **Production note** | "Same amount / everyone picks / winners split" = the whole mechanic in one breath. Say it once, clearly; don't re-explain later. This scene also answers the problem's other half: *no bookmaker*. |

### SCENE 2 — Real TxLINE data (0:35–1:00)

| | |
|---|---|
| **Visual** | Tap into a fixture. Show the matches board pulling the real WC schedule; open one match. Briefly show a live match's score updating (or the live-stage ticker) so the *liveness* is visible. |
| **On-screen text** | Lower-third: *Fixtures + live scores stream over Server-Sent Events, straight from TxLINE.* |
| **Narration (VO)** | "And every match here is real. Fixtures and live scores stream straight from TxODDS' TxLINE feed over SSE — the actual World Cup schedule, real goals landing in real time. That feed is the heartbeat of the whole app." |
| **Production note** | This is the "primary live data source" proof judges look for. If a real match is live during your recording window, record *this scene* against it — nothing beats a genuine score tick. |

### SCENE 3 — Pick a market & host a pool (1:00–1:40)

| | |
|---|---|
| **Visual** | On the fixture page, show the market picker: the **1X2 result cards**, then flick to **Total Goals** (main 2.5 line + disclosure), then the **correct-score heat matrix** (amber ramp). Pick an outcome → the host-pool sheet slides up → set the buy-in → confirm → Privy signs. |
| **On-screen text** | Lower-third on the picker: *Match result · Total goals · Correct score · BTTS · Odd/Even.* On the sign step: *You sign. We never hold your funds.* |
| **Narration (VO)** | "Pick your market — match result, total goals, exact score, both teams to score, odd or even. Set the buy-in, and host the pool. You sign it yourself, and the money goes into an on-chain vault — never to us." |
| **Production note** | Move fast through the market types (≈2s each) — breadth signals completeness, but don't linger. The signing moment is the credibility beat: let the Privy sheet be visible for a full second. |

### SCENE 4 — Friends join + group chat (1:40–2:10)

| | |
|---|---|
| **Visual** | Second wallet's view (or a cut to a second device/frame): join the pool, pick the *opposite* outcome. Cut to the pool page's group chat — a couple of live messages and a floating emoji reaction. |
| **On-screen text** | Lower-third: *Live group chat per pool — trash talk included.* |
| **Narration (VO)** | "Drop it in the group. Friends join, take the other side, and every pool gets its own live chat — because half the fun is the trash talk while the match plays out." |
| **Production note** | The opposite pick here is what makes a real winner/loser possible at settlement — don't skip staging it. Keep chat messages short and human ("Spain all day 🇪🇸"). |

### SCENE 5 — The live pitch stage (2:10–2:55)

| | |
|---|---|
| **Visual** | The pool's **live pitch stage**: the SVG pitch, the moving ball, the leader chip, the phase label. Trigger/show a **goal popup** firing off a real score delta. Chat riding alongside as the overlay. |
| **On-screen text** | Lower-third: *Score updates render in real time — goal moments pop as they happen.* |
| **Narration (VO)** | "When kickoff hits, the pool comes alive. The pitch tracks the game off the live feed, goals pop the second they land, and everyone's watching the same moment together." |
| **Production note** | This is the "real-time responsiveness" rubric line. If you can time recording to a live goal, do it. Otherwise show the live-state stage with the ticker moving; the goal popup can be shown from a genuine prior score delta. Do **not** fake a scoreline as a real-world result on camera. |

### SCENE 6 — Settlement & the win takeover (2:55–3:35) ★ PEAK

| | |
|---|---|
| **Visual** | Match hits full time → pool status flips to **resolved** → the **win takeover** takes the full viewport: dark hold → light bloom → the payout counts up → CTA rises → tap **Claim** → Privy signs → paid state with the tx hash demoted to a whisper. |
| **On-screen text** | During count-up: *(let the number carry it — no text over the peak)*. After claim: *Settled on-chain from the TxLINE final score. Paid out, non-custodial.* |
| **Narration (VO)** | "Full time. The pool settles itself — automatically, from the final score on the feed. Nobody has to do a thing. …You won. Tap claim, sign once, and it's yours — straight to your wallet." |
| **Production note** | This is the emotional peak — **let the count-up breathe** (~2s of near-silence, just the animation). Trigger settlement via the dev resolve; it runs the genuine on-chain lock+resolve+claim path, so the tx hash on screen is a real devnet transaction. That's the honesty: the *payout is real*, only the chosen outcome is staged because no devnet match is live to settle against. |

### SCENE 7 — Under the hood, honestly (3:35–3:55)

| | |
|---|---|
| **Visual** | A clean architecture card (single diagram): `Frontend → Oddtasy API (:4100) → TxLINE (fixtures · scores SSE)` and `→ Solana betting program (PDAs, resolver)`. One line about pricing. |
| **On-screen text** | Card bullets: *• Live data: TxLINE fixtures + scores (SSE)  • On-chain: non-custodial pools, pull-based claims  • Pricing: our own Dixon–Coles model, fitted on 5,300+ real internationals — the free tier ships no odds, and we're honest about that.* |
| **Narration (VO)** | "Under the hood: TxLINE drives the fixtures and live scores, a Solana program holds every pool and pays the winners, and because the free feed doesn't carry odds yet, our prices come from our own model — Dixon–Coles, fit on more than five thousand real international matches. And we tell you that, right in the app. No fake books." |
| **Production note** | Naming the honesty out loud is a *plus* with these judges. This card doubles as your technical-doc talking point. Keep it 15–18s; it's the one "tell" scene — earn it by keeping it short. |

### SCENE 8 — Close (3:55–4:10)

| | |
|---|---|
| **Visual** | Back to the app on the win/paid state or the matches board. Outro card with links. |
| **On-screen text** | Card: **Oddtasy** · *Try it: [deployed URL]* · *Code: github.com/build-zone/oddtasy* · *Built on TxODDS TxLINE + Solana.* |
| **Narration (VO)** | "That's Oddtasy — the World Cup, with your friends, for real. Link's below. Thanks for watching." |
| **Production note** | Put the **live deployed URL** and repo on screen *and* in the submission fields. Verify the URL + Privy allowlist right before recording. |

---

## Timing summary

| Scene | Beat | In | Out | Len |
|---|---|---|---|---|
| 0 | Cold open | 0:00 | 0:12 | 0:12 |
| 1 | What it is | 0:12 | 0:35 | 0:23 |
| 2 | Real TxLINE data | 0:35 | 1:00 | 0:25 |
| 3 | Pick market / host | 1:00 | 1:40 | 0:40 |
| 4 | Join + chat | 1:40 | 2:10 | 0:30 |
| 5 | Live pitch stage | 2:10 | 2:55 | 0:45 |
| 6 | Settle + win ★ | 2:55 | 3:35 | 0:40 |
| 7 | Under the hood | 3:35 | 3:55 | 0:20 |
| 8 | Close | 3:55 | 4:10 | 0:15 |
| | **Total** | | | **4:10** |

Comfortably under 5:00 with room to breathe on the peak. If you need to trim toward 3:30, cut Scene 4 to 15s (chat only, skip the second-device join) and tighten Scene 3's market flick.

---

## Full VO script (read-through, ~320 words ≈ 3:15 spoken at a relaxed pace)

> It's the World Cup. Your group chat is arguing about who wins — loudly, endlessly, and for nothing. What if it actually meant something?
>
> Oddtasy turns any match into a pool your friends jump into. Everyone puts in the same — say ten dollars — everyone picks an outcome, and the winners split the prize. Real money, on-chain, non-custodial. No bookmaker in the middle — just you and your friends.
>
> And every match here is real. Fixtures and live scores stream straight from TxODDS' TxLINE feed over SSE — the actual World Cup schedule, real goals landing in real time. That feed is the heartbeat of the whole app.
>
> Pick your market — match result, total goals, exact score, both teams to score, odd or even. Set the buy-in, and host the pool. You sign it yourself, and the money goes into an on-chain vault — never to us.
>
> Drop it in the group. Friends join, take the other side, and every pool gets its own live chat — because half the fun is the trash talk while the match plays out.
>
> When kickoff hits, the pool comes alive. The pitch tracks the game off the live feed, goals pop the second they land, and everyone's watching the same moment together.
>
> Full time. The pool settles itself — automatically, from the final score on the feed. Nobody has to do a thing. …You won. Tap claim, sign once, and it's yours — straight to your wallet.
>
> Under the hood: TxLINE drives the fixtures and live scores, a Solana program holds every pool and pays the winners, and because the free feed doesn't carry odds yet, our prices come from our own model — Dixon–Coles, fit on more than five thousand real international matches. And we tell you that, right in the app. No fake books.
>
> That's Oddtasy — the World Cup, with your friends, for real. Link's below. Thanks for watching.

---

## Video build spec (locked)

Everything needed to assemble the video in CapCut. This is the source of truth for format, assets, colors, and fonts.

### Canvas & composite

- **Delivery:** 16:9 landscape, **1920×1080**, built in CapCut.
- **Scenes 1–7 (app scenes):** left **text panel** (~55% width) + **phone video** on the right, over a background plate. Phone video keeps its native 9:16 shape, scaled to near-full height with a soft drop shadow. **Lock its size and position — identical in every app scene.**
- **Scenes 0 & 8 (atmosphere):** full-frame Kling video clips (no panel).
- **Cards** (logo card at the open of Scene 1, architecture card in Scene 7, outro card in Scene 8): full-frame designed cards.

### Backgrounds (locked)

Generated in CapCut → Seedream 4.3, **16:9, 2k**. Two plates, used by role:

- **Behind scenes 1–7 (the panel layout) → Variant 3 (minimal).** Chosen for text readability — no hot spot to fight the headline.
  > A minimal dark background: deep near-black green gradient, a single soft warm amber glow bleeding in from the top center, smooth and clean with gentle film grain, mostly empty negative space, no detail, no people, no text, no logos. Cinematic and moody. 16:9.
- **Logo card (open of Scene 1) + outro card (Scene 8) → Variant 1 (floodlit pitch).** The dramatic plate already generated (amber floodlight down a dark green pitch). Keep headline/links on the darker left; don't center text over the hot spot.
  > A dark, moody, minimalist background inspired by a floodlit football pitch at night. Deep near-black green tones fading to a slightly lighter green, with a soft warm amber glow spilling down from the top center like a distant stadium floodlight. Abstract and atmospheric, heavily blurred with soft bokeh, lots of empty negative space, cinematic, subtle film grain. No people, no text, no logos, no scoreboard. 16:9.
- **Safe fallback (if AI plates fight the text):** flat `#0a1410` fill + a soft `#102019` glow at top-center (the app's own radial gradient).

### Atmosphere clips (Kling — video, **16:9**, 2 only)

Match the landscape delivery — generate these **16:9**, not vertical. Keep each **2–4s** in the edit.

- **Cold open (Scene 0):**
  > Three African friends on a couch in a dim living room lit by the flicker of a TV off-screen, watching football intensely — one throws his hands up in disbelief, another leans in shouting at the screen, animated argument, warm lamp light and cool TV glow, shallow depth of field, handheld cinematic, 16:9 landscape, photorealistic. No text, no logos, no screens visible.
- **Outro (Scene 8):**
  > A group of African friends erupting in celebration in a living room, jumping up, high-fives and laughter, pure joy, confetti-like warm bokeh lights, slow-motion, golden warm lighting, handheld cinematic, 16:9 landscape, photorealistic. No text, no logos, no screens.

Generate 2–3 takes of each; pick the cleanest; reroll anything with morphing faces or accidental text.

### Voice-over

- **One voice** across all scenes (ElevenLabs recommended for a submission; CapCut TTS is the free fallback). Keep the same voice/settings for every clip.
- **9 audio files** — one per scene, **except Scene 6 which splits into two** (before and after the ~2s silent count-up pause). Use the per-scene VO chunks (the "Full VO script" above, cut at the scene boundaries).

### Type & wordmark

- **Space Grotesk** — headlines + the wordmark (app display font).
- **IBM Plex Mono** — small kicker/sub-labels, UPPERCASE, letter-spacing ~0.12em (matches the app's `.k` kicker).
- **Wordmark** (rebuild as a text layer — there is no logo image file): **Odd** in `#e9f1ec` + **tasy** in `#f5b942`, Space Grotesk Bold (700), tracking ~ −2%, one word.

### Color palette (from `web/src/app/globals.css`)

| Token | Hex | Use in the video |
|---|---|---|
| bg (base) | `#0a1410` | main background fill |
| bg2 | `#0e1a14` | lifted panels/cards |
| surface | `#13241d` | any card/box behind text |
| line2 | `#274236` | thin borders / dividers |
| ink | `#e9f1ec` | headlines, primary text |
| muted | `#9fb3a8` | sub-lines |
| faint | `#6f857a` | tiny mono kickers |
| **home (amber)** | `#f5b942` | accent — "tasy", key words, highlights |
| away (cyan) | `#56c7e0` | secondary accent (sparingly) |
| good (green) | `#5fd08a` | the win / "You won" (Scene 6) |
| live (red) | `#ff5a5a` | "LIVE" labels |

**Accent rule:** make the **one key word per headline amber `#f5b942`** (and the win moment green `#5fd08a`). That single touch makes the panel feel designed by the same hand as the app.

### Left-panel text (scenes 1–7)

Wordmark top-left every scene · big headline (Space Grotesk, `#e9f1ec`, key word accented) · thin sub-line (IBM Plex Mono, `#9fb3a8`, uppercase).

| Scene | Headline (big) | Sub-line (small, mono) |
|---|---|---|
| 1 | Make the match **mean something** | Social betting pools for football, on Solana |
| 2 | **Real** matches. **Live** scores. | Fixtures + scores stream from TxLINE over SSE |
| 3 | Pick your market. **Host the pool.** | You sign — we never hold your funds |
| 4 | Bring **the group** | Live chat in every pool |
| 5 | The pool **comes alive** | Goals pop in real time, off the live feed |
| 6 | Full time. **You won.** *(green)* | Settled on-chain from the final score |
| 7 | **Under the hood** | TxLINE + Solana · honest Dixon–Coles pricing |

### Build order (CapCut)

1. Set project to 1920×1080.
2. Drop the background plate (Variant 3) on the base track, full length.
3. Add each phone screen-recording on the right, locked to the same size/position.
4. Build the left panel: wordmark + per-scene headline/sub-line text layers.
5. Cut in the two Kling clips (Scene 0 open, Scene 8 close) full-frame, and the logo/architecture/outro cards.
6. Lay the VO audio (9 files) under the matching scenes; leave the Scene 6 gap silent.
7. Colour-match the warm Kling clips to the app footage so it reads as one film.

---

## Notes for the submission text (not the video, but pairs with it)

- **Deployed link:** [fill in — verify live + Privy allowlist before submitting]
- **Repo:** github.com/build-zone/oddtasy (public)
- **TxLINE endpoints used (technical doc):** guest auth → fixtures snapshot → scores snapshot → scores SSE stream (`/api/scores/stream`) → odds snapshot/stream (queried; free tier returns empty, hence model pricing). Exact paths are in `TECHNICAL-DOC.md` §3.
- **On-chain (devnet):** program `42YpRKawvR2NtiTs4YDhurmsecmPC6hmGDx5KX25hqxn`, USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, PDAs `config` / `pool` / `vault` / `entry`, pull-based claims.
- **One-line honesty statement:** "Prices are model-generated (Dixon–Coles fitted on 5,300+ real internationals) because the free World Cup tier ships fixtures and scores but no odds books; funds are real devnet USDC and settlement is on-chain and non-custodial."
