import { Router } from "express";
import { register } from "prom-client";

export function metricsRouter(): Router {
  const router = Router();

  router.get("/", async (_req, res, next) => {
    try {
      const metrics = await register.metrics();
      res.set("Content-Type", register.contentType).send(metrics);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
