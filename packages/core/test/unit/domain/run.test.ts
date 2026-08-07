import { describe, expect, it } from "vitest";
import { transitionRun, type Run, type RunId } from "@/domain/run/index.js";
import { InvalidTransitionError } from "@/domain/errors/index.js";

const makeRun = (overrides: Partial<Run> = {}): Run => ({
  id: "run-1" as RunId,
  taskRef: { provider: "github-projects", projectId: "proj-1", itemId: "item-1" },
  repoRef: { owner: "acme", repo: "api" },
  branch: "raccoon/task-1-add-feature" as Run["branch"],
  worktreePath: "/tmp/runs/run-1",
  state: "QUEUED",
  attempts: 0,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-01T00:00:00Z"),
  startedAt: null,
  completedAt: null,
  prUrl: null,
  sessionId: null,
  errorMessage: null,
  currentAgent: null,
  ...overrides,
});

describe("transitionRun", () => {
  it("QUEUED → PREPARING sets startedAt", () => {
    const run = makeRun();
    const now = new Date("2024-01-01T01:00:00Z");
    const next = transitionRun(run, "PREPARING", now);
    expect(next.state).toBe("PREPARING");
    expect(next.startedAt).toEqual(now);
    expect(next.updatedAt).toEqual(now);
    expect(next.completedAt).toBeNull();
    expect(next.attempts).toBe(0);
  });

  it("does not mutate original run", () => {
    const run = makeRun();
    transitionRun(run, "PREPARING");
    expect(run.state).toBe("QUEUED");
  });

  it("throws on invalid transition", () => {
    const run = makeRun({ state: "DONE" });
    expect(() => transitionRun(run, "QUEUED")).toThrow(InvalidTransitionError);
  });

  it("DONE transition sets completedAt", () => {
    const run = makeRun({ state: "REVIEWING" });
    const now = new Date();
    const next = transitionRun(run, "DONE", now);
    expect(next.completedAt).toEqual(now);
    expect(next.state).toBe("DONE");
  });

  it("FAILED transition sets completedAt", () => {
    const run = makeRun({ state: "PREPARING" });
    const next = transitionRun(run, "FAILED");
    expect(next.completedAt).not.toBeNull();
    expect(next.state).toBe("FAILED");
  });

  it("CANCELLED transition sets completedAt", () => {
    const run = makeRun({ state: "QUEUED" });
    const next = transitionRun(run, "CANCELLED");
    expect(next.completedAt).not.toBeNull();
  });

  it("RETRYING → PREPARING increments attempts", () => {
    const run = makeRun({ state: "RETRYING", attempts: 1 });
    const next = transitionRun(run, "PREPARING");
    expect(next.attempts).toBe(2);
    expect(next.state).toBe("PREPARING");
  });

  it("preserves startedAt once set", () => {
    const startedAt = new Date("2024-01-01T01:00:00Z");
    const run = makeRun({ state: "IMPLEMENTING", startedAt });
    const next = transitionRun(run, "VERIFYING");
    expect(next.startedAt).toEqual(startedAt);
  });

  it("uses current time as default for now", () => {
    const before = Date.now();
    const run = makeRun();
    const next = transitionRun(run, "PREPARING");
    const after = Date.now();
    expect(next.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(next.updatedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
