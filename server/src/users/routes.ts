import type { Router } from "express";
import { Router as createRouter } from "express";
import { getUser, upsertUser } from "./store.js";

function isWallet(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 64;
}

export function createUserRoutes(): Router {
  const router = createRouter();

  router.get("/:wallet", (req, res) => {
    if (!isWallet(req.params.wallet)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    const user = getUser(req.params.wallet);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  });

  router.put("/:wallet", (req, res) => {
    if (!isWallet(req.params.wallet)) {
      res.status(400).json({ error: "Invalid wallet" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: { displayName?: string; email?: string; avatarUrl?: string } = {};
    if (body.displayName !== undefined) {
      const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
      if (name.length < 2 || name.length > 32) {
        res.status(400).json({ error: "displayName must be 2–32 characters" });
        return;
      }
      patch.displayName = name;
    }
    if (body.email !== undefined) {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: "Invalid email" });
        return;
      }
      patch.email = email;
    }
    if (body.avatarUrl !== undefined && typeof body.avatarUrl === "string") {
      patch.avatarUrl = body.avatarUrl.trim();
    }

    res.json(upsertUser(req.params.wallet, patch));
  });

  return router;
}
