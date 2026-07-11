import { fetchFixturesSnapshot, fetchScoresSnapshot, mapPool } from "./client.js";
import {
  inferFriendlyStage,
  inferWorldCupStage,
  WC_COMPETITION_ID,
  wcTournamentStartEpochDay,
} from "./stages.js";
import type { FixtureStatus, OddtasyFixture, TxLineRawFixture, TxLineScoreRow } from "./types.js";

const FINISHED_STATES = new Set(["F", "FET", "FPE", "A", "C"]);
const LIVE_STATES = new Set(["H1", "HT", "H2", "ET1", "HTET", "ET2", "WET", "WPE", "PE", "I"]);

function normalizeGameState(raw?: string): string {
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (upper === "SCHEDULED") return "NS";
  return upper;
}

function rowTimestamp(row: TxLineScoreRow): number {
  return row.ts ?? row.Ts ?? 0;
}

function extractParticipantGoals(score?: TxLineScoreRow["Score"]): {
  p1: number | undefined;
  p2: number | undefined;
} {
  if (!score) return { p1: undefined, p2: undefined };
  const p1 =
    score.Participant1?.Total?.Goals ??
    score.Participant1?.H2?.Goals ??
    score.Participant1?.H1?.Goals;
  const p2 =
    score.Participant2?.Total?.Goals ??
    score.Participant2?.H2?.Goals ??
    score.Participant2?.H1?.Goals;
  return { p1, p2 };
}

function deriveStatus(startTime: number, gameState?: string, hasScore = false): FixtureStatus {
  const state = normalizeGameState(gameState);
  if (state) {
    if (FINISHED_STATES.has(state)) return "finished";
    if (LIVE_STATES.has(state)) return "live";
    if (state === "NS" || state === "P") {
      const now = Date.now();
      if (startTime > now) return "scheduled";
      if (hasScore && startTime < now - 2 * 60 * 60 * 1000) return "finished";
      if (startTime < now - 2.5 * 60 * 60 * 1000) return "finished";
      return startTime < now ? "live" : "scheduled";
    }
  }

  const now = Date.now();
  if (startTime > now) return "scheduled";
  if (startTime < now - 2.5 * 60 * 60 * 1000) return "finished";
  return "live";
}

function isWorldCup(raw: TxLineRawFixture): boolean {
  const name = raw.Competition?.toLowerCase() ?? "";
  return name.includes("world cup");
}

function isFriendly(raw: TxLineRawFixture): boolean {
  const name = raw.Competition?.toLowerCase() ?? "";
  return name.includes("friendly") || name.includes("friendlies");
}

function competitionSlug(raw: TxLineRawFixture): string {
  if (isWorldCup(raw)) return "world-cup";
  if (isFriendly(raw)) return "int-friendlies";
  return "other";
}

function inferStage(raw: TxLineRawFixture): string | undefined {
  if (isFriendly(raw)) return inferFriendlyStage();
  if (isWorldCup(raw)) return inferWorldCupStage(raw.FixtureId, raw.StartTime);
  return raw.Competition;
}

type ScoreInfo = Partial<
  Pick<OddtasyFixture, "gameState" | "status" | "homeScore" | "awayScore">
>;

function scoresFromSnapshot(
  rows: TxLineScoreRow[],
  participant1IsHome: boolean,
  startTime: number,
): ScoreInfo {
  if (rows.length === 0) return {};

  const parsed = rows.map((row) => {
    const scoreBlock = row.Score ?? row.scoreSoccer;
    const { p1, p2 } = extractParticipantGoals(scoreBlock);
    return {
      ts: rowTimestamp(row),
      gameState: normalizeGameState(row.gameState ?? row.GameState),
      p1,
      p2,
    };
  });

  const withGoals = parsed.filter((r) => r.p1 != null || r.p2 != null);
  const latest = [...(withGoals.length > 0 ? withGoals : parsed)].sort((a, b) => b.ts - a.ts)[0]!;
  const p1Goals = latest.p1 ?? 0;
  const p2Goals = latest.p2 ?? 0;
  const hasScore = latest.p1 != null || latest.p2 != null;

  return {
    gameState: latest.gameState || undefined,
    status: deriveStatus(startTime, latest.gameState, hasScore),
    homeScore: participant1IsHome ? p1Goals : p2Goals,
    awayScore: participant1IsHome ? p2Goals : p1Goals,
  };
}

function toOddtasyFixture(raw: TxLineRawFixture, scoreInfo: ScoreInfo = {}): OddtasyFixture {
  const status = scoreInfo.status ?? deriveStatus(raw.StartTime, scoreInfo.gameState);

  return {
    FixtureId: raw.FixtureId,
    fixtureId: raw.FixtureId,
    Participant1: raw.Participant1,
    Participant2: raw.Participant2,
    Participant1IsHome: raw.Participant1IsHome,
    StartTime: raw.StartTime,
    kickoffIso: new Date(raw.StartTime).toISOString(),
    CompetitionName: raw.Competition,
    CompetitionId: raw.CompetitionId,
    competitionId: competitionSlug(raw),
    stage: inferStage(raw),
    status,
    homeScore: scoreInfo.homeScore,
    awayScore: scoreInfo.awayScore,
    gameState: scoreInfo.gameState,
  };
}

function dedupeFixtures(fixtures: TxLineRawFixture[]): TxLineRawFixture[] {
  const byId = new Map<number, TxLineRawFixture>();
  for (const fixture of fixtures) {
    const existing = byId.get(fixture.FixtureId);
    if (!existing || (fixture.Ts ?? 0) >= (existing.Ts ?? 0)) {
      byId.set(fixture.FixtureId, fixture);
    }
  }
  return [...byId.values()];
}

export async function loadOddtasyFixtures(): Promise<OddtasyFixture[]> {
  const [worldCupRaw, recentRaw] = await Promise.all([
    fetchFixturesSnapshot({
      startEpochDay: wcTournamentStartEpochDay(),
      competitionId: WC_COMPETITION_ID,
    }),
    fetchFixturesSnapshot(),
  ]);

  const friendlies = recentRaw.filter((f) => isFriendly(f));
  const relevant = dedupeFixtures([...worldCupRaw, ...friendlies]);
  const now = Date.now();
  const needsScores = relevant.filter((f) => f.StartTime <= now);
  const scoreMap = new Map<number, TxLineScoreRow[]>();

  await mapPool(
    needsScores,
    async (raw) => {
      try {
        const rows = await fetchScoresSnapshot(raw.FixtureId);
        scoreMap.set(raw.FixtureId, rows);
      } catch {
        scoreMap.set(raw.FixtureId, []);
      }
    },
    12,
  );

  return dedupeOddtasyFixtures(
    relevant.map((raw) => {
      const rows = scoreMap.get(raw.FixtureId) ?? [];
      const scoreInfo =
        rows.length > 0 ? scoresFromSnapshot(rows, raw.Participant1IsHome, raw.StartTime) : {};
      return toOddtasyFixture(raw, scoreInfo);
    }),
  );
}

function dedupeOddtasyFixtures(fixtures: OddtasyFixture[]): OddtasyFixture[] {
  const byId = new Map<number, OddtasyFixture>();
  for (const fixture of fixtures) {
    byId.set(fixture.FixtureId, fixture);
  }
  return [...byId.values()];
}
