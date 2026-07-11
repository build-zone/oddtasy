export const WC_COMPETITION_ID = 72;
export const WC_TOURNAMENT_START_MS = Date.UTC(2026, 5, 14);

const GROUP_STAGE_END_MS = Date.UTC(2026, 5, 28);
const R16_END_MS = Date.UTC(2026, 6, 9);
const QF_END_MS = Date.UTC(2026, 6, 13);

export function inferWorldCupStage(_fixtureId: number, startTime: number): string {
  if (startTime < GROUP_STAGE_END_MS) return "Group Stage";
  if (startTime < R16_END_MS) return "Round of 16";
  if (startTime < QF_END_MS) return "Quarter-Finals";
  return "Knockout Stage";
}

export function inferFriendlyStage(): string {
  return "International Friendlies";
}

export function wcTournamentStartEpochDay(): number {
  return Math.floor(WC_TOURNAMENT_START_MS / 86_400_000);
}
