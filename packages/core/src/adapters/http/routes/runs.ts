import { Router } from "express";
import { transitionRun } from "@/domain/run/index.js";
import type { RunId } from "@/domain/run/index.js";
import type { Container } from "@/composition/container.js";

export function runsRouter(container: Container): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const runs = await container.runStore.listActive();
      res.json({ runs });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const run = await container.runStore.get(req.params.id as RunId);
      if (!run) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
        return;
      }
      res.json({ run });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/logs", async (req, res, next) => {
    try {
      const run = await container.runStore.get(req.params.id as RunId);
      if (!run) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
        return;
      }
      res.json({ runId: run.id, logs: [] });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/cancel", async (req, res, next) => {
    try {
      const run = await container.runStore.get(req.params.id as RunId);
      if (!run) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
        return;
      }
      const cancelled = transitionRun(run, "CANCELLED", container.clock.now());
      await container.runStore.save(cancelled);
      res.json({ run: cancelled });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/retry", async (req, res, next) => {
    try {
      const run = await container.runStore.get(req.params.id as RunId);
      if (!run) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Run not found" } });
        return;
      }
      const retrying = transitionRun(run, "RETRYING", container.clock.now());
      await container.runStore.save(retrying);
      await container.jobQueue.enqueue({
        id: run.id,
        type: "RETRY_RUN",
        payload: { runId: run.id },
      });
      res.json({ run: retrying });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
