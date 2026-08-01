import { describe, it, expect, vi } from "vitest";
import type { JobQueue } from "@/ports/job-queue.js";

export function jobQueueContract(name: string, factory: () => JobQueue): void {
  describe(`JobQueue contract: ${name}`, () => {
    it("enqueues jobs and process handler is called", async () => {
      const queue = factory();
      const handler = vi.fn().mockResolvedValue(undefined);
      queue.process(handler);

      await queue.enqueue({ id: "job-1", type: "test", payload: { x: 1 } });
      await queue.shutdown();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id: "job-1", type: "test" }),
      );
    });

    it("shutdown resolves cleanly", async () => {
      const queue = factory();
      await expect(queue.shutdown()).resolves.toBeUndefined();
    });
  });
}
