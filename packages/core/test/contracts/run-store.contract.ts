import { describe, it, expect } from "vitest";
import type { RunStore } from "@/ports/run-store.js";
import type { Run, RunId } from "@/domain/run/index.js";

const makeRun = (id: string, state: Run["state"] = "QUEUED"): Run => ({
  id: id as RunId,
  taskRef: { provider: "fake-board", projectId: "proj-1", itemId: "item-1" },
  repoRef: { owner: "acme", repo: "api" },
  branch: "raccoon/task-1" as Run["branch"],
  worktreePath: "/tmp/runs/" + id,
  state,
  attempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: null,
  completedAt: null,
  prUrl: null,
  sessionId: null,
  errorMessage: null,
});

export function runStoreContract(name: string, factory: () => RunStore): void {
  describe(`RunStore contract: ${name}`, () => {
    it("save and get round-trips a run", async () => {
      const store = factory();
      const run = makeRun("run-1");
      await store.save(run);
      const found = await store.get("run-1" as RunId);
      expect(found?.id).toBe("run-1");
      expect(found?.state).toBe("QUEUED");
    });

    it("get returns null for missing run", async () => {
      const store = factory();
      const found = await store.get("missing" as RunId);
      expect(found).toBeNull();
    });

    it("listActive excludes terminal states", async () => {
      const store = factory();
      await store.save(makeRun("active-1", "IMPLEMENTING"));
      await store.save(makeRun("done-1", "DONE"));
      await store.save(makeRun("failed-1", "FAILED"));
      await store.save(makeRun("cancelled-1", "CANCELLED"));
      const active = await store.listActive();
      expect(active.map((r) => r.id)).toContain("active-1");
      expect(active.map((r) => r.id)).not.toContain("done-1");
      expect(active.map((r) => r.id)).not.toContain("failed-1");
      expect(active.map((r) => r.id)).not.toContain("cancelled-1");
    });

    it("appendEvent stores events", async () => {
      const store = factory();
      const run = makeRun("run-events");
      await store.save(run);
      await store.appendEvent({
        id: "evt-1",
        runId: "run-events" as RunId,
        kind: "STATE_CHANGED",
        payload: { from: "QUEUED", to: "PREPARING" },
        createdAt: new Date(),
      });
    });

    it("claim returns true first time, false on duplicate", async () => {
      const store = factory();
      const first = await store.claim("delivery-abc");
      const second = await store.claim("delivery-abc");
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it("different claim keys are independent", async () => {
      const store = factory();
      expect(await store.claim("key-1")).toBe(true);
      expect(await store.claim("key-2")).toBe(true);
    });
  });
}
