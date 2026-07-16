"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/hooks/use-chat";
import { useLiveScore } from "@/hooks/use-live-score";
import { useWallet } from "@/hooks/use-wallet";
import { shortWallet } from "@/lib/format";
import { awayTeam, homeTeam, type OddtasyFixture } from "@/lib/types";

/**
 * The live pitch stage — an immersive 2D view, grounded in real data:
 * scores and match phase stream from TxLINE, goal popups fire off actual score
 * changes, and the chat overlay is the pool's real group chat. The ball motion
 * is ambience; the footer says so. Nothing on this surface is invented.
 */

const PHASE_LABEL: Record<string, string> = {
  NS: "Kickoff soon",
  H1: "1st half",
  HT: "Half-time",
  H2: "2nd half",
  WET: "Waiting for extra time",
  ET1: "ET · 1st half",
  HTET: "ET · half-time",
  ET2: "ET · 2nd half",
  WPE: "Penalties soon",
  PE: "Penalty shootout",
  F: "FT",
  FET: "AET",
  FPE: "FT · pens",
  I: "Interrupted",
  A: "Abandoned",
  C: "Cancelled",
  TXCC: "Coverage cancelled",
  TXCS: "Coverage suspended",
  P: "Postponed",
};
const FINAL_PHASES = new Set(["F", "FET", "FPE"]);
const STALE_MS = 120_000;
const POP_SPOTS: [string, string][] = [
  ["16%", "24%"],
  ["54%", "30%"],
  ["36%", "58%"],
  ["62%", "52%"],
];

type GoalPop = { id: number; side: "home" | "away"; text: string };

function code(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "—";
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  if (d >= 1) return `${d}d ${Math.floor((s % 86400) / 3600)}h`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function Pitch({ live, leader }: { live: boolean; leader: string | null }) {
  return (
    <svg
      className="pitch"
      viewBox="0 0 1000 560"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="2D match representation"
    >
      <defs>
        <radialGradient id="grass" cx="50%" cy="42%" r="80%">
          <stop offset="0%" stopColor="#194026" />
          <stop offset="100%" stopColor="#0c1f13" />
        </radialGradient>
      </defs>
      <rect width="1000" height="560" fill="url(#grass)" />
      <g opacity="0.10" fill="#ffffff">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={i * 125} width="62" height="560" />
        ))}
      </g>
      <g stroke="#3a6b49" strokeWidth="2.4" fill="none" opacity="0.85">
        <rect x="34" y="30" width="932" height="500" />
        <line x1="500" y1="30" x2="500" y2="530" />
        <circle cx="500" cy="280" r="74" />
        <rect x="34" y="170" width="120" height="220" />
        <rect x="846" y="170" width="120" height="220" />
        <rect x="34" y="232" width="44" height="96" />
        <rect x="922" y="232" width="44" height="96" />
      </g>
      <circle cx="500" cy="280" r="4" fill="#3a6b49" />
      {live ? (
        <>
          <path
            id="ballpath"
            d="M500,280 L720,165 L850,300 L660,415 L360,370 L150,225 L330,150 Z"
            fill="none"
            stroke="none"
          />
          <g>
            <animateMotion dur="15s" repeatCount="indefinite" rotate="auto">
              <mpath href="#ballpath" />
            </animateMotion>
            <g transform="translate(15,-30)">
              {leader && (
                <>
                  <rect
                    rx="13"
                    height="30"
                    width={leader.length * 9.2 + 34}
                    fill="rgba(9,16,12,.82)"
                    stroke="rgba(245,185,66,.5)"
                  />
                  <text x="16" y="20" fontFamily="var(--font-plex)" fontSize="14" fill="#fff">
                    {leader}
                  </text>
                </>
              )}
              <circle cx="-6" cy="15" r="8.5" fill="#fff" stroke="#0a1410" strokeWidth="1.6" />
            </g>
          </g>
        </>
      ) : (
        <circle cx="500" cy="280" r="9" fill="#ffffff" opacity="0.4" />
      )}
    </svg>
  );
}

export function LiveStage({
  poolId,
  fixture,
}: {
  poolId: string;
  fixture: OddtasyFixture | null;
}) {
  const wallet = useWallet();
  const [now, setNow] = useState(() => Date.now());

  const kickoffMs = fixture?.StartTime ?? 0;
  const home = fixture ? homeTeam(fixture) : "Home";
  const away = fixture ? awayTeam(fixture) : "Away";

  // stream while the match could be in play
  const streamActive =
    fixture != null && fixture.status !== "finished" && kickoffMs - now < 30 * 60_000;
  const { score, connected } = useLiveScore(fixture?.fixtureId ?? null, streamActive);

  const chat = useChat(poolId, wallet.address);
  const [draft, setDraft] = useState("");

  // clock: 1s during countdown, 15s otherwise (staleness re-checks)
  useEffect(() => {
    const preMatch = fixture != null && kickoffMs > Date.now();
    const t = setInterval(() => setNow(Date.now()), preMatch ? 1000 : 15_000);
    return () => clearInterval(t);
  }, [fixture, kickoffMs]);

  // resolve display state from stream phase first, fixture snapshot second
  const phase = score?.gameState || fixture?.gameState || "";
  const fin =
    (phase && FINAL_PHASES.has(phase)) || fixture?.status === "finished";
  const live = !fin && (Boolean(score) || fixture?.status === "live");
  const pre = !fin && !live;

  const homeScore =
    (fixture?.Participant1IsHome ? score?.p1Goals : score?.p2Goals) ??
    fixture?.homeScore ??
    null;
  const awayScore =
    (fixture?.Participant1IsHome ? score?.p2Goals : score?.p1Goals) ??
    fixture?.awayScore ??
    null;

  // goal popups from real score changes
  const [pops, setPops] = useState<GoalPop[]>([]);
  const prevScore = useRef<[number, number] | null>(null);
  const popSeq = useRef(0);
  useEffect(() => {
    if (homeScore == null || awayScore == null) return;
    const prev = prevScore.current;
    prevScore.current = [homeScore, awayScore];
    if (!prev) return;
    const [ph, pa] = prev;
    if (homeScore === ph && awayScore === pa) return;
    const side: "home" | "away" = homeScore > ph ? "home" : "away";
    const id = popSeq.current++;
    setPops((p) => [
      ...p.slice(-3),
      { id, side, text: `⚽ ${side === "home" ? home : away} ${homeScore}–${awayScore}` },
    ]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 8200);
  }, [homeScore, awayScore, home, away]);

  // floating emoji for incoming reactions
  const [floats, setFloats] = useState<{ id: string; emoji: string }[]>([]);
  const seenReactions = useRef(new Set<string>());
  useEffect(() => {
    const fresh = chat.messages.filter(
      (m) => m.kind === "reaction" && !seenReactions.current.has(m.id),
    );
    if (fresh.length === 0) return;
    for (const m of fresh) seenReactions.current.add(m.id);
    setFloats((prev) => [...prev, ...fresh.map((m) => ({ id: m.id, emoji: m.text }))]);
    const ids = new Set(fresh.map((m) => m.id));
    setTimeout(() => setFloats((prev) => prev.filter((f) => !ids.has(f.id))), 3200);
  }, [chat.messages]);

  const stale = live && score != null && now - score.at > STALE_MS;
  const leader =
    live && homeScore != null && awayScore != null && homeScore !== awayScore
      ? `${code(homeScore > awayScore ? home : away)} ▸`
      : null;

  const phaseLabel = PHASE_LABEL[phase] ?? (live ? "In play" : "");
  const textMessages = useMemo(
    () => chat.messages.filter((m) => m.kind === "text").slice(-5),
    [chat.messages],
  );

  const submit = () => {
    if (!draft.trim() || chat.sending) return;
    void chat.send(draft);
    setDraft("");
  };

  const composer = (compact: boolean) => (
    <div className="sc-input">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={wallet.authenticated ? "Add a comment…" : "Log in to chat"}
        disabled={!wallet.authenticated}
        maxLength={280}
        aria-label="Group chat message"
      />
      {(compact ? ["🔥"] : ["⚽", "🔥"]).map((emoji) => (
        <button
          key={emoji}
          className="sc-react"
          onClick={() => void chat.send(emoji)}
          disabled={!wallet.authenticated}
          aria-label={`React ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );

  return (
    <div>
      <div className="lstage">
        <Pitch live={live} leader={leader} />

        {/* HUD */}
        <div className="stage-hud">
          {live && homeScore != null ? (
            <div className="hud-score">
              <span className="nm-home">{code(home)}</span> <b>{homeScore}</b>
              <span className="hud-sep">–</span>
              <b>{awayScore}</b> <span className="nm-away">{code(away)}</span>
            </div>
          ) : (
            <div className="hud-score">
              <span className="nm-home">{code(home)}</span>
              <span className="hud-vs">v</span>
              <span className="nm-away">{code(away)}</span>
            </div>
          )}
          {live && (
            <div className={`hud-min ${stale ? "stale" : ""}`}>
              <span className="livedot" aria-hidden />
              {stale
                ? `stale · last update ${Math.round((now - (score?.at ?? now)) / 1000)}s ago`
                : phaseLabel}
            </div>
          )}
          {fin && <div className="hud-min ft">✓ {phaseLabel || "FT"}</div>}
          {pre && (
            <div className="hud-min pre">
              ◷ KO{" "}
              {fixture
                ? new Date(fixture.StartTime).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </div>
          )}
        </div>

        {/* centre overlay: countdown (pre) or final score (finished) */}
        {pre && fixture && (
          <div className="stage-pre">
            <div className="cd-lbl">Match starting soon</div>
            <div className="cd">{fmtCountdown(kickoffMs - now)}</div>
            <div className="cd-ko">
              kicks off{" "}
              {new Date(fixture.StartTime).toLocaleString(undefined, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        )}
        {fin && homeScore != null && (
          <div className="stage-pre">
            <div className="cd-lbl">Full time</div>
            <div className="cd ft-score">
              {homeScore}–{awayScore}
            </div>
            <div className="cd-ko">
              {home} v {away}
            </div>
          </div>
        )}

        {/* goal popups — real score changes; positions decorative */}
        {pops.map((p, i) => {
          const [left, top] = POP_SPOTS[i % POP_SPOTS.length];
          return (
            <div key={p.id} className={`stage-pop ${p.side}`} style={{ left, top }}>
              <b>{p.text}</b>
            </div>
          );
        })}

        {/* group chat overlay (real) — desktop/tablet */}
        <div className="stage-chat">
          <div className="sc-head">
            <span className="livedot" aria-hidden />
            group chat {chat.connected ? "· live" : "· connecting…"}
          </div>
          <div className="sc-stream">
            {textMessages.length === 0 && (
              <div className="sc-msg other" style={{ opacity: 0.7 }}>
                <b>oddtasy</b> say something before kickoff…
              </div>
            )}
            {textMessages.map((m) => {
              const mine = wallet.address === m.wallet;
              return (
                <div key={m.id} className={`sc-msg ${mine ? "" : "other"}`}>
                  <b>{mine ? "you" : (m.displayName ?? shortWallet(m.wallet))}</b> {m.text}
                </div>
              );
            })}
          </div>
          <div className="sc-floats">
            {floats.map((f, i) => (
              <span
                key={f.id}
                className="chat-float"
                style={{ animationDelay: `${(i % 3) * 0.25}s` }}
              >
                {f.emoji}
              </span>
            ))}
          </div>
          {composer(true)}
        </div>

        <div className="stage-foot">
          2D data view · scores &amp; phases live from TxLINE · ball motion is
          ambience — the feed has no event coordinates
        </div>
      </div>

      {/* phone: chat as a strip below the pitch */}
      <div className="stage-strip mt-2.5 bg-surface border border-line2 rounded-[14px] px-3.5 py-3">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="k">group chat</span>
          <span className="font-mono text-[10px] text-faint">
            {chat.connected ? "live" : "connecting…"}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto mb-2.5">
          {textMessages.length === 0 && (
            <p className="font-mono text-[11px] text-faint m-0">
              No messages yet — talk your talk.
            </p>
          )}
          {textMessages.map((m) => {
            const mine = wallet.address === m.wallet;
            return (
              <div key={m.id} className="fade-in text-[12.5px] leading-snug">
                <span
                  className={`font-mono text-[10px] font-semibold mr-1.5 ${
                    mine ? "text-home" : "text-away"
                  }`}
                >
                  {mine ? "you" : (m.displayName ?? shortWallet(m.wallet))}
                </span>
                <span className="text-ink break-words">{m.text}</span>
              </div>
            );
          })}
        </div>
        {composer(false)}
      </div>
    </div>
  );
}
