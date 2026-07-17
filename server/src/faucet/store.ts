import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Records which wallets have already been funded by the demo faucet, so a
 * repeated login (or a double-fired client) doesn't drain the faucet. Kept in
 * its own JSON file next to the pool/user stores rather than on the profile,
 * so faucet bookkeeping stays separate from account data.
 */

export type FaucetClaim = {
  wallet: string;
  signature: string;
  usdc: number;
  sol: number;
  at: string;
};

type FaucetData = { claims: FaucetClaim[] };

let cache: FaucetData | null = null;

function dataPath(): string {
  const dir = path.dirname(path.resolve(process.cwd(), config.dataFile));
  return path.join(dir, "faucet.json");
}

function readStore(): FaucetData {
  if (cache) return cache;
  const file = dataPath();
  if (!fs.existsSync(file)) {
    cache = { claims: [] };
    return cache;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as FaucetData;
  cache = { claims: Array.isArray(parsed.claims) ? parsed.claims : [] };
  return cache;
}

function writeStore(data: FaucetData): void {
  cache = data;
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function getClaim(wallet: string): FaucetClaim | null {
  return readStore().claims.find((c) => c.wallet === wallet) ?? null;
}

export function recordClaim(claim: FaucetClaim): void {
  const data = readStore();
  if (data.claims.some((c) => c.wallet === claim.wallet)) return;
  data.claims.push(claim);
  writeStore(data);
}
