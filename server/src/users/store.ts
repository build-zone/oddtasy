import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export type UserProfile = {
  wallet: string;
  displayName: string;
  email?: string | undefined;
  avatarUrl?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

type UsersData = { users: UserProfile[] };

let cache: UsersData | null = null;

function dataPath(): string {
  const dir = path.dirname(path.resolve(process.cwd(), config.dataFile));
  return path.join(dir, "users.json");
}

function readStore(): UsersData {
  if (cache) return cache;
  const file = dataPath();
  if (!fs.existsSync(file)) {
    cache = { users: [] };
    return cache;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as UsersData;
  cache = { users: Array.isArray(parsed.users) ? parsed.users : [] };
  return cache;
}

function writeStore(data: UsersData): void {
  cache = data;
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function getUser(wallet: string): UserProfile | null {
  return readStore().users.find((u) => u.wallet === wallet) ?? null;
}

export function upsertUser(
  wallet: string,
  patch: { displayName?: string; email?: string; avatarUrl?: string },
): UserProfile {
  const data = readStore();
  const now = new Date().toISOString();
  const existing = data.users.find((u) => u.wallet === wallet);
  if (existing) {
    if (patch.displayName !== undefined) existing.displayName = patch.displayName;
    if (patch.email !== undefined) existing.email = patch.email;
    if (patch.avatarUrl !== undefined) existing.avatarUrl = patch.avatarUrl;
    existing.updatedAt = now;
    writeStore(data);
    return existing;
  }
  const user: UserProfile = {
    wallet,
    displayName: patch.displayName ?? `fan-${wallet.slice(0, 4)}`,
    email: patch.email,
    avatarUrl: patch.avatarUrl,
    createdAt: now,
    updatedAt: now,
  };
  data.users.push(user);
  writeStore(data);
  return user;
}

/** wallet → displayName for decorating public surfaces (never leaks email). */
export function displayNames(wallets: Iterable<string>): Record<string, string> {
  const set = new Set(wallets);
  const out: Record<string, string> = {};
  for (const u of readStore().users) {
    if (set.has(u.wallet)) out[u.wallet] = u.displayName;
  }
  return out;
}
