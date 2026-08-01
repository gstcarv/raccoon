import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Container } from "@/composition/container.js";
import type { BoardProvider, RawWebhookRequest } from "@/ports/board-provider.js";

async function processAsync(
  container: Container,
  provider: BoardProvider,
  rawReq: RawWebhookRequest,
  deliveryId: string,
): Promise<void> {
  const claimed = await container.runStore.claim(`delivery:${deliveryId}`);
  if (!claimed) return;

  const event = await provider.parseEvent(rawReq);
  if (!event) return;

  await container.jobQueue.enqueue({
    id: deliveryId,
    type: "BOARD_EVENT",
    payload: { event, providerId: provider.id },
  });
}

export function webhooksRouter(container: Container): Router {
  const router = Router();

  router.post("/:provider", async (req, res, next) => {
    try {
      const providerId = req.params.provider;
      const provider = container.boardProviders.get(providerId);
      if (!provider) {
        res
          .status(404)
          .json({ error: { code: "UNKNOWN_PROVIDER", message: `Unknown provider: ${providerId}` } });
        return;
      }

      const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
      const rawReq: RawWebhookRequest = {
        headers: req.headers,
        rawBody,
      };

      const isValid = await provider.verifyWebhook(rawReq);
      if (!isValid) {
        res
          .status(401)
          .json({ error: { code: "INVALID_SIGNATURE", message: "Invalid webhook signature" } });
        return;
      }

      const deliveryId =
        (req.headers["x-github-delivery"] as string | undefined) ?? randomUUID();

      res.status(202).json({ message: "Accepted", deliveryId });

      processAsync(container, provider, rawReq, deliveryId).catch((err: unknown) => {
        container.logger.error({ err, deliveryId }, "webhook async processing failed");
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function manualTriggerRouter(container: Container): Router {
  const router = Router();

  router.post("/:provider/:item", async (req, res, next) => {
    try {
      const providerId = req.params.provider;
      const itemId = req.params.item;
      const provider = container.boardProviders.get(providerId);
      if (!provider) {
        res
          .status(404)
          .json({ error: { code: "UNKNOWN_PROVIDER", message: `Unknown provider: ${providerId}` } });
        return;
      }

      const projectId =
        (req.query["projectId"] as string | undefined) ??
        container.config.env.GITHUB_PROJECT_ID ??
        "";
      const task = await provider.fetchTask({ provider: providerId, projectId, itemId });
      const deliveryId = randomUUID();

      await container.jobQueue.enqueue({
        id: deliveryId,
        type: "MANUAL_TRIGGER",
        payload: { task, providerId },
      });

      res.status(202).json({ message: "Accepted", deliveryId });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
