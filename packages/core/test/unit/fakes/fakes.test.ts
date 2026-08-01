import { describe, it, expect } from "vitest";
import { FakeBoardProvider } from "../../fakes/fake-board-provider.js";
import { FakeVcsProvider } from "../../fakes/fake-vcs-provider.js";
import { FakeAgentRunner } from "../../fakes/fake-agent-runner.js";
import { FakeWorkspaceManager } from "../../fakes/fake-workspace-manager.js";
import { FakeRunStore } from "../../fakes/fake-run-store.js";
import { FakeJobQueue } from "../../fakes/fake-job-queue.js";
import { boardProviderContract } from "../../contracts/board-provider.contract.js";
import { runStoreContract } from "../../contracts/run-store.contract.js";
import { jobQueueContract } from "../../contracts/job-queue.contract.js";
import type { Task } from "@/domain/task/index.js";
import type { BranchName } from "@/domain/run/index.js";

// --- Run contracts against fakes ---

boardProviderContract("FakeBoardProvider", () => {
  const provider = new FakeBoardProvider();
  return {
    provider,
    seedTask: (task: Task) => provider.setTask(task),
  };
});

runStoreContract("FakeRunStore", () => new FakeRunStore());

jobQueueContract("FakeJobQueue", () => new FakeJobQueue());

// --- Fake-specific behaviour tests ---

describe("FakeBoardProvider", () => {
  it("tracks moveTask calls and comments", async () => {
    const p = new FakeBoardProvider();
    const ref = { provider: "fake-board", projectId: "proj-1", itemId: "item-1" };
    await p.moveTask(ref, "IN_PROGRESS");
    await p.comment(ref, "started");
    expect(p.getStatus("item-1")).toBe("IN_PROGRESS");
    expect(p.getComments()).toHaveLength(1);
  });

  it("returns false when webhookValid is false", async () => {
    const p = new FakeBoardProvider();
    p.setWebhookValid(false);
    expect(
      await p.verifyWebhook({ headers: {}, rawBody: Buffer.from("{}") }),
    ).toBe(false);
  });
});

describe("FakeVcsProvider", () => {
  it("opens a PR and records it", async () => {
    const p = new FakeVcsProvider();
    const pr = await p.openPullRequest({
      repoRef: { owner: "acme", repo: "api" },
      branch: "raccoon/task-1" as BranchName,
      baseBranch: "main",
      title: "feat: add X",
      body: "body",
      draft: false,
    });
    expect(pr.url).toContain("acme/api");
    expect(p.getPullRequests()).toHaveLength(1);
  });

  it("getCloneUrl returns a https URL", async () => {
    const p = new FakeVcsProvider();
    const url = await p.getCloneUrl({ owner: "acme", repo: "api" });
    expect(url).toMatch(/^https:\/\//);
  });
});

describe("FakeAgentRunner", () => {
  it("records calls and returns success by default", async () => {
    const runner = new FakeAgentRunner();
    const result = await runner.run({
      runId: "run-1",
      prompt: "do the thing",
      workingDir: "/tmp/ws",
      allowedTools: ["Read", "Edit"],
      maxTurns: 10,
      mcpConfigPath: null,
      sessionId: null,
    });
    expect(result.success).toBe(true);
    expect(runner.calls).toHaveLength(1);
  });

  it("can be set to fail", async () => {
    const runner = new FakeAgentRunner();
    runner.setFailure();
    const result = await runner.run({
      runId: "run-1",
      prompt: "do the thing",
      workingDir: "/tmp/ws",
      allowedTools: [],
      maxTurns: 10,
      mcpConfigPath: null,
      sessionId: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("FakeWorkspaceManager", () => {
  it("prepare creates a workspace with correct path", async () => {
    const wm = new FakeWorkspaceManager();
    const ws = await wm.prepare(
      { owner: "acme", repo: "api" },
      "run-1",
      "raccoon/task-1" as BranchName,
    );
    expect(ws.path).toContain("run-1");
    expect(wm.prepared).toHaveLength(1);
  });

  it("commitAll returns sha, dispose records disposal", async () => {
    const wm = new FakeWorkspaceManager();
    const ws = await wm.prepare(
      { owner: "acme", repo: "api" },
      "run-2",
      "raccoon/task-2" as BranchName,
    );
    const sha = await wm.commitAll(ws, "feat: x", {
      name: "Raccoon Builder",
      email: "builder@raccoon.dev",
    });
    expect(sha).not.toBeNull();
    await wm.dispose(ws);
    expect(wm.disposed).toHaveLength(1);
  });
});
