import type { Router } from "express";
import { Router as createRouter } from "express";
import { getPool } from "../pools/store.js";
import { displayNames } from "../users/store.js";
import { broadcastChat } from "./hub.js";
import { addMessage, listMessages, type ChatMessage } from "./store.js";

function decorate(messages: ChatMessage[]): (ChatMessage & { displayName: string | null })[] {
  const names = displayNames(messages.map((m) => m.wallet));
  return messages.map((m) => ({ ...m, displayName: names[m.wallet] ?? null }));
}

const MAX_TEXT = 280;
// single emoji (with optional variation selectors / ZWJ sequences) = reaction
const REACTION_RE = /^\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic})*$/u;

function isWallet(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 64;
}

export function createChatRoutes(): Router {
  const router = createRouter();

  router.get("/:poolId/messages", (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    res.json(decorate(listMessages(pool.id, limit)));
  });

  router.post("/:poolId/messages", (req, res) => {
    const pool = getPool(req.params.poolId);
    if (!pool) {
      res.status(404).json({ error: "Pool not found" });
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (!isWallet(body?.wallet)) {
      res.status(400).json({ error: "wallet is required" });
      return;
    }
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "text is required" });
      return;
    }
    if (text.length > MAX_TEXT) {
      res.status(400).json({ error: `text must be at most ${MAX_TEXT} characters` });
      return;
    }

    const message = addMessage(pool.id, {
      wallet: body.wallet.trim(),
      text,
      kind: REACTION_RE.test(text) ? "reaction" : "text",
    });
    const decorated = decorate([message])[0] ?? { ...message, displayName: null };
    broadcastChat(decorated);
    res.status(201).json(decorated);
  });

  return router;
}
