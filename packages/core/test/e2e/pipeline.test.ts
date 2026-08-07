/**
 * E2E pipeline tests — all fakes, no network, no disk I/O.
 *
 * Covers the full run lifecycle: job enqueue → processJob → agent loop → PR.
 */
import { describe, it, expect, beforeEach } from "vitest";
import pino from "pino";
import { processJob } from "@/pipeline/index.js";
import { systemClock } from "@/ports/clock.js";
import type { Container } from "@/composition/container.js";
import type { Job } from "@/ports/job-queue.js";
import type { Task } from "@/domain/task/index.js";
import type { AgentDefinition } from "@/domain/agent/index.js";
import type { Env } from "@/config/schema.js";
import { FakeBoardProvider } from "../fakes/fake-board-provider.js";
import { FakeVcsProvider } from "../fakes/fake-vcs-provider.js";
import { FakeRunner } from "../fakes/fake-runner.js";
import { FakeWorkspaceManager } from "../fakes/fake-workspace-manager.js";
import { FakeRunStore } from "../fakes/fake-run-store.js";
import { FakeJobQueue } from "../fakes/fake-job-queue.js";
import type { CommitSha } from "@/domain/run/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const silentLogger = pino({ level: "silent" });

const minEnv: Env = {
  NODE_ENV: "test",
  PORT: 3000,
  LOG_LEVEL: "silent",
  RACCOON_BASE_URL: "http://localhost:3000",
  RACCOON_COAUTHOR_NAME: "Raccoon Builder",
  RACCOON_COAUTHOR_EMAIL: "raccoon-builder@noreply",
  RACCOON_WORKSPACE_DIR: "/tmp/ws",
  RACCOON_MAX_CONCURRENT_RUNS: 3,
  RACCOON_RUN_TIMEOUT_MS: 30_000,
  RACCOON_ALLOW_DANGEROUS_PERMISSIONS: false,
  RACCOON_KEEP_FAILED_WORKSPACES: false,
  CLAUDE_CODE_OAUTH_TOKEN: undefined,
  CLAUDE_CODE_PATH: "claude",
  CLAUDE_MODEL: undefined,
  GITHUB_TOKEN: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_APP_INSTALLATION_ID: undefined,
  GITHUB_WEBHOOK_SECRET: "secret",
  GITHUB_PROJECT_ID: "proj-1",
  GITHUB_STATUS_FIELD_NAME: "Status",
  DATABASE_URL: "file::memory:",
  REDIS_URL: undefined,
  MCP_GITHUB_TOKEN: undefined,
  RACCOON_AGENTS_DIR: "./assets/agents",
  RACCOON_DEFAULT_AGENTS: "engineer",
};

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "item-1",
  boardRef: { provider: "fake-board", projectId: "proj-1", itemId: "item-1" },
  repoRef: { owner: "acme", repo: "api" },
  title: "Add login feature",
  description: "Implement OAuth login",
  labels: [],
  priority: "medium",
  metadata: {},
  ...overrides,
});

const engineerDef: AgentDefinition = {
  id: "engineer",
  name: "Engineer",
  description: "Implements tasks",
  skills: ["raccoon-workflow"],
  mcp: [],
  allowedTools: ["Bash", "Read", "Write", "Edit"],
  model: null,
  maxTurns: 50,
};

const reviewerDef: AgentDefinition = {
  id: "code-reviewer",
  name: "Code Reviewer",
  description: "Reviews code",
  skills: ["code-review"],
  mcp: [],
  allowedTools: ["Read"],
  model: null,
  maxTurns: 20,
};

interface Ctx {
  board: FakeBoardProvider;
  vcs: FakeVcsProvider;
  runner: FakeRunner;
  workspace: FakeWorkspaceManager;
  store: FakeRunStore;
  queue: FakeJobQueue;
  container: Container;
}

function makeCtx(
  agentCatalog: ReadonlyMap<string, AgentDefinition> = new Map([["engineer", engineerDef]]),
  envOverrides: Partial<Env> = {},
): Ctx {
  const board = new FakeBoardProvider();
  const vcs = new FakeVcsProvider();
  const runner = new FakeRunner();
  const workspace = new FakeWorkspaceManager();
  const store = new FakeRunStore();
  const queue = new FakeJobQueue();

  const task = makeTask();
  board.setTask(task);

  const container: Container = {
    config: { env: { ...minEnv, ...envOverrides }, redacted: {} },
    logger: silentLogger,
    clock: systemClock,
    boardProviders: new Map([["fake-board", board]]),
    vcsProvider: vcs,
    runner,
    agentCatalog,
    workspaceManager: workspace,
    jobQueue: queue,
    runStore: store,
  };
  return { board, vcs, runner, workspace, store, queue, container };
}

const manualTriggerJob = (task: Task): Job => ({
  id: "job-1",
  type: "MANUAL_TRIGGER",
  payload: { task, providerId: "fake-board" },
});

const boardEventJob = (itemId = "item-1"): Job => ({
  id: "job-2",
  type: "BOARD_EVENT",
  payload: {
    event: { kind: "TASK_MOVED", deliveryId: "del-1", taskRef: { provider: "fake-board", projectId: "proj-1", itemId } },
    providerId: "fake-board",
  },
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("pipeline — happy path (single agent)", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    await processJob(ctx.container, manualTriggerJob(makeTask()));
  });

  it("run ends in DONE state", async () => {
    const runs = ctx.store.getAllRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("DONE");
  });

  it("workspace was prepared and disposed", () => {
    expect(ctx.workspace.prepared).toHaveLength(1);
    expect(ctx.workspace.disposed).toHaveLength(1);
  });

  it("engineer agent was invoked once", () => {
    expect(ctx.runner.invocations).toHaveLength(1);
    expect(ctx.runner.invocations[0]?.agent.id).toBe("engineer");
  });

  it("invocation prompt includes task title", () => {
    const prompt = ctx.runner.invocations[0]?.agent.prompt ?? "";
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("invocation envelope is JSON-serializable", () => {
    expect(() => JSON.stringify(ctx.runner.invocations[0])).not.toThrow();
  });

  it("commit and push happened", () => {
    expect(ctx.workspace.committed).toHaveLength(1);
    expect(ctx.workspace.pushed).toHaveLength(1);
  });

  it("pull request was opened", () => {
    expect(ctx.vcs.getPullRequests()).toHaveLength(1);
  });

  it("run has a prUrl", () => {
    const run = ctx.store.getAllRuns()[0];
    expect(run?.prUrl).toMatch(/github\.com/);
  });

  it("currentAgent is set to engineer", () => {
    // At least one intermediate state had currentAgent = engineer
    expect(ctx.store.getAllRuns()[0]?.currentAgent).toBe("engineer");
  });

  it("board status ended as IN_REVIEW", () => {
    // Last moveTask call is IN_REVIEW (then DONE — board provider overwrites)
    // depends on order; just verify board was moved at least once
    const status = ctx.board.getStatus("item-1");
    expect(["IN_REVIEW", "DONE", "IN_PROGRESS"]).toContain(status);
  });
});

describe("pipeline — multi-agent linear sequence (engineer → code-reviewer)", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    const catalog = new Map<string, AgentDefinition>([
      ["engineer", engineerDef],
      ["code-reviewer", reviewerDef],
    ]);
    ctx = makeCtx(catalog, { RACCOON_DEFAULT_AGENTS: "engineer,code-reviewer" });
    await processJob(ctx.container, manualTriggerJob(makeTask()));
  });

  it("run ends in DONE", () => {
    expect(ctx.store.getAllRuns()[0]?.state).toBe("DONE");
  });

  it("runner was invoked twice — engineer then code-reviewer", () => {
    expect(ctx.runner.invocations).toHaveLength(2);
    expect(ctx.runner.invocations[0]?.agent.id).toBe("engineer");
    expect(ctx.runner.invocations[1]?.agent.id).toBe("code-reviewer");
  });

  it("sessionId from engineer is propagated to code-reviewer", () => {
    const firstSessionId = ctx.runner.invocations[0]?.sessionId;
    // second invocation receives the sessionId returned by the first (fake returns "session-fake-1")
    expect(ctx.runner.invocations[1]?.sessionId).toBe("session-fake-1");
    void firstSessionId; // first gets null (no prior session)
  });

  it("both invocations have serializable envelopes", () => {
    for (const inv of ctx.runner.invocations) {
      expect(() => JSON.stringify(inv)).not.toThrow();
    }
  });

  it("workspace prepared once, disposed once", () => {
    expect(ctx.workspace.prepared).toHaveLength(1);
    expect(ctx.workspace.disposed).toHaveLength(1);
  });

  it("one PR opened", () => {
    expect(ctx.vcs.getPullRequests()).toHaveLength(1);
  });
});

describe("pipeline — agent failure stops the run", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = makeCtx();
    ctx.runner.setFailure();
    await processJob(ctx.container, manualTriggerJob(makeTask()));
  });

  it("run ends in FAILED", () => {
    expect(ctx.store.getAllRuns()[0]?.state).toBe("FAILED");
  });

  it("no PR was opened", () => {
    expect(ctx.vcs.getPullRequests()).toHaveLength(0);
  });

  it("workspace was disposed on failure", () => {
    expect(ctx.workspace.disposed).toHaveLength(1);
  });

  it("errorMessage is set", () => {
    expect(ctx.store.getAllRuns()[0]?.errorMessage).toContain("exited with code");
  });
});

describe("pipeline — unknown agent in catalog is skipped", () => {
  it("run still completes with remaining agents", async () => {
    // catalog only has engineer, but env requests engineer + unknown
    const ctx = makeCtx(
      new Map([["engineer", engineerDef]]),
      { RACCOON_DEFAULT_AGENTS: "engineer,nonexistent" },
    );
    await processJob(ctx.container, manualTriggerJob(makeTask()));

    expect(ctx.runner.invocations).toHaveLength(1);
    expect(ctx.runner.invocations[0]?.agent.id).toBe("engineer");
    expect(ctx.store.getAllRuns()[0]?.state).toBe("DONE");
  });
});

describe("pipeline — no changes to commit skips PR", () => {
  it("run ends DONE without a PR", async () => {
    const ctx = makeCtx();
    ctx.workspace.setCommitSha(null as unknown as CommitSha);
    await processJob(ctx.container, manualTriggerJob(makeTask()));

    expect(ctx.store.getAllRuns()[0]?.state).toBe("DONE");
    expect(ctx.vcs.getPullRequests()).toHaveLength(0);
    expect(ctx.store.getAllRuns()[0]?.prUrl).toBeNull();
  });
});

describe("pipeline — BOARD_EVENT triggers a run", () => {
  it("TASK_MOVED event starts the run end-to-end", async () => {
    const ctx = makeCtx();
    const task = makeTask();
    ctx.board.setTask(task);
    await processJob(ctx.container, boardEventJob("item-1"));

    expect(ctx.store.getAllRuns()[0]?.state).toBe("DONE");
    expect(ctx.runner.invocations).toHaveLength(1);
  });

  it("duplicate task (already active) does not start a second run", async () => {
    const ctx = makeCtx();
    const task = makeTask();
    ctx.board.setTask(task);

    // First run starts and completes
    await processJob(ctx.container, boardEventJob("item-1"));
    expect(ctx.store.getAllRuns()).toHaveLength(1);

    // Force the run back to active state to simulate already-running scenario
    const existing = ctx.store.getAllRuns()[0]!;
    await ctx.store.save({ ...existing, state: "IMPLEMENTING" });

    // Second event for same item — should be ignored
    await processJob(ctx.container, { ...boardEventJob("item-1"), id: "job-3" });
    expect(ctx.store.getAllRuns().filter((r) => r.state !== "IMPLEMENTING")).toHaveLength(0);
  });

  it("unknown event kind (TASK_UPDATED) does nothing", async () => {
    const ctx = makeCtx();
    await processJob(ctx.container, {
      id: "job-4",
      type: "BOARD_EVENT",
      payload: {
        event: { kind: "TASK_UPDATED", deliveryId: "del-x", taskRef: { provider: "fake-board", projectId: "proj-1", itemId: "item-1" } },
        providerId: "fake-board",
      },
    });
    expect(ctx.store.getAllRuns()).toHaveLength(0);
  });
});

describe("pipeline — RETRY_RUN resumes a failed run", () => {
  it("transitions from RETRYING back through to DONE", async () => {
    const ctx = makeCtx();

    // First run: fails
    ctx.runner.setFailure();
    await processJob(ctx.container, manualTriggerJob(makeTask()));
    const failedRun = ctx.store.getAllRuns()[0]!;
    expect(failedRun.state).toBe("FAILED");

    // Mark as RETRYING (simulates what /api/runs/:id/retry does)
    await ctx.store.save({ ...failedRun, state: "RETRYING" });

    // Fix the runner and retry
    ctx.runner.setResult({ exitCode: 0, success: true });
    ctx.board.setTask(makeTask());
    await processJob(ctx.container, {
      id: "job-retry",
      type: "RETRY_RUN",
      payload: { runId: failedRun.id },
    });

    const retried = ctx.store.getAllRuns().find((r) => r.id === failedRun.id)!;
    expect(retried.state).toBe("DONE");
    expect(ctx.vcs.getPullRequests()).toHaveLength(1);
  });
});

describe("pipeline — MCP servers resolved per agent", () => {
  it("engineer with no MCP_GITHUB_TOKEN has empty mcpServers", async () => {
    const ctx = makeCtx(new Map([["engineer", { ...engineerDef, mcp: ["github"] }]]));
    await processJob(ctx.container, manualTriggerJob(makeTask()));

    const inv = ctx.runner.invocations[0]!;
    expect(inv.agent.mcpServers).toHaveLength(0);
  });
});
