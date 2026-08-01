import { describe, it, expect } from "vitest";
import type { BoardProvider } from "@/ports/board-provider.js";
import type { Task } from "@/domain/task/index.js";

const SAMPLE_TASK: Task = {
  id: "task-1",
  boardRef: { provider: "fake-board", projectId: "proj-1", itemId: "item-1" },
  repoRef: { owner: "acme", repo: "api" },
  title: "Add feature X",
  description: "Implement X",
  labels: ["backend"],
  priority: "medium",
  metadata: {},
};

export function boardProviderContract(
  name: string,
  factory: () => { provider: BoardProvider; seedTask?: (task: Task) => void },
): void {
  describe(`BoardProvider contract: ${name}`, () => {
    it("has a stable string id", () => {
      const { provider } = factory();
      expect(typeof provider.id).toBe("string");
      expect(provider.id.length).toBeGreaterThan(0);
    });

    it("verifyWebhook returns a boolean", async () => {
      const { provider } = factory();
      const result = await provider.verifyWebhook({
        headers: {},
        rawBody: Buffer.from("{}"),
      });
      expect(typeof result).toBe("boolean");
    });

    it("parseEvent returns BoardEvent or null", async () => {
      const { provider } = factory();
      const result = await provider.parseEvent({
        headers: {},
        rawBody: Buffer.from("{}"),
      });
      expect(result === null || typeof result === "object").toBe(true);
    });

    it("moveTask and comment resolve without error", async () => {
      const { provider, seedTask } = factory();
      seedTask?.(SAMPLE_TASK);
      await expect(
        provider.moveTask(SAMPLE_TASK.boardRef, "IN_PROGRESS"),
      ).resolves.toBeUndefined();
      await expect(
        provider.comment(SAMPLE_TASK.boardRef, "hello"),
      ).resolves.toBeUndefined();
    });

    it("fetchTask returns a task when seeded", async () => {
      const { provider, seedTask } = factory();
      if (!seedTask) return; // real adapters skip this
      seedTask(SAMPLE_TASK);
      const task = await provider.fetchTask(SAMPLE_TASK.boardRef);
      expect(task.title).toBe(SAMPLE_TASK.title);
    });
  });
}
