import { Router } from "express";
import { existsSync } from "node:fs";
import type { Container } from "@/composition/container.js";

export function healthRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  return router;
}

export function readyRouter(container: Container): Router {
  const router = Router();
  router.get("/", async (_req, res) => {
    const checks: Record<string, boolean> = {};

    try {
      await container.runStore.listActive();
      checks["store"] = true;
    } catch {
      checks["store"] = false;
    }

    const claudePath = container.config.env.CLAUDE_CODE_PATH;
    checks["claude"] = claudePath === "claude" || existsSync(claudePath);

    const allOk = Object.values(checks).every(Boolean);
    res.status(allOk ? 200 : 503).json({ status: allOk ? "ready" : "not ready", checks });
  });
  return router;
}
