import "dotenv/config";

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} must be a number`);
  }
  return parsed;
}

export const config = {
  port: numberFromEnv("PORT", 4100),
  // comma-separated list, e.g. "http://localhost:3000,http://localhost:3001"
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  txlineApiOrigin: process.env.TXLINE_API_ORIGIN ?? "https://txline.txodds.com",
  txlineApiToken: process.env.TXLINE_API_TOKEN?.trim() ?? "",
  txlineGuestJwt: process.env.TXLINE_GUEST_JWT?.trim() ?? "",
  fixturesCacheMs: numberFromEnv("FIXTURES_CACHE_MS", 45_000),
  solanaRpc: process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
  bettingProgramId:
    process.env.ODDTASY_BETTING_PROGRAM_ID?.trim() ?? "cisSZzchpfV9kJTuqjSNeT7KZcv8dirUsb2kKcAAsyT",
  usdcMint:
    process.env.ODDTASY_USDC_MINT?.trim() ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  programIdlPath: process.env.ODDTASY_PROGRAM_IDL?.trim() ?? "",
  dataFile: process.env.ODDTASY_DATA_FILE?.trim() ?? "data/oddtasy.json",
  defaultStakeUsdc: numberFromEnv("ODDTASY_DEFAULT_STAKE_USDC", 5),
  defaultRakeBps: numberFromEnv("ODDTASY_DEFAULT_RAKE_BPS", 500),
  defaultMaxEntries: numberFromEnv("ODDTASY_DEFAULT_MAX_ENTRIES", 200),
  correctScoreCap: numberFromEnv("ODDTASY_CORRECT_SCORE_CAP", 4),
} as const;

export function assertTxLineConfigured(): void {
  if (!config.txlineApiToken) {
    throw new Error(
      "TXLINE_API_TOKEN is not set. Reuse the TixOdds TxLINE setup token or run its setup flow, then add the token to oddtasy/server/.env",
    );
  }
}
