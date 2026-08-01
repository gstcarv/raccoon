import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { rateLimit } from "express-rate-limit";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { createErrorHandler } from "./middleware/error-handler.js";
import { healthRouter, readyRouter } from "./routes/health.js";
import { webhooksRouter, manualTriggerRouter } from "./routes/webhooks.js";
import { runsRouter } from "./routes/runs.js";
import type { Container } from "@/composition/container.js";

// Ensure Express type augmentations are loaded
import "./types.js";

export function createApp(container: Container): express.Express {
  const app = express();

  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(pinoHttp({ logger: container.logger, autoLogging: false }));

  // Global JSON body parsing with raw body preservation for HMAC
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  const webhookLimiter = rateLimit({
    windowMs: 60_000,
    limit: 200,
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use("/healthz", healthRouter());
  app.use("/readyz", readyRouter(container));
  app.use("/webhooks", webhookLimiter, webhooksRouter(container));
  app.use("/api/runs", runsRouter(container));
  app.use("/api/tasks", manualTriggerRouter(container));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });

  app.use(createErrorHandler(container.logger));

  return app;
}
