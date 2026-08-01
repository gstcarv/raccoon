import type { Request, Response, NextFunction } from "express";
import { DomainError, InvalidTransitionError } from "@/domain/errors/index.js";
import type { Logger } from "@/shared/logger.js";

function toStatus(err: DomainError): number {
  if (err instanceof InvalidTransitionError) return 409;
  switch (err.code) {
    case "CONFIGURATION_ERROR":
      return 500;
    case "PROVIDER_ERROR":
      return 502;
    case "AGENT_EXECUTION_ERROR":
      return 500;
    default:
      return 500;
  }
}

export function createErrorHandler(log: Logger) {
  return function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    if (res.headersSent) return;

    if (err instanceof DomainError) {
      log.warn({ err, reqId: req.id }, "domain error");
      res.status(toStatus(err)).json({
        error: { code: err.code, message: err.message, retryable: err.isRetryable },
      });
      return;
    }

    log.error({ err, reqId: req.id }, "unhandled error");
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  };
}
