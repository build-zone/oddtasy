import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

export type ChatMessage = {
  id: string;
  poolId: string;
  wallet: string;
  text: string;
  kind: "text" | "reaction";
  at: string;
};

type ChatData = { messages: ChatMessage[] };

const MAX_PER_POOL = 500;
let cache: ChatData | null = null;

function dataPath(): string {
  const dir = path.dirname(path.resolve(process.cwd(), config.dataFile));
  return path.join(dir, "chat.json");
}

function readStore(): ChatData {
  if (cache) return cache;
  const file = dataPath();
  if (!fs.existsSync(file)) {
    cache = { messages: [] };
    return cache;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ChatData;
  cache = { messages: Array.isArray(parsed.messages) ? parsed.messages : [] };
  return cache;
}

function writeStore(data: ChatData): void {
  cache = data;
  const file = dataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function listMessages(poolId: string, limit = 50): ChatMessage[] {
  const { messages } = readStore();
  return messages.filter((m) => m.poolId === poolId).slice(-limit);
}

export function addMessage(
  poolId: string,
  input: { wallet: string; text: string; kind: "text" | "reaction" },
): ChatMessage {
  const data = readStore();
  const message: ChatMessage = {
    id: randomUUID(),
    poolId,
    wallet: input.wallet,
    text: input.text,
    kind: input.kind,
    at: new Date().toISOString(),
  };
  data.messages.push(message);

  // cap history per pool so the JSON store never grows unbounded
  const forPool = data.messages.filter((m) => m.poolId === poolId);
  if (forPool.length > MAX_PER_POOL) {
    const cutoff = forPool.length - MAX_PER_POOL;
    let dropped = 0;
    data.messages = data.messages.filter((m) => {
      if (m.poolId !== poolId) return true;
      if (dropped < cutoff) {
        dropped += 1;
        return false;
      }
      return true;
    });
  }

  writeStore(data);
  return message;
}
