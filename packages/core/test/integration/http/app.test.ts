import { describe, it, expect } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "@/adapters/http/app.js";
import { systemClock } from "@/ports/clock.js";
import { FakeBoardProvider } from "../../fakes/fake-board-provider.js";
import { FakeVcsProvider } from "../../fakes/fake-vcs-provider.js";
import { FakeAgentRunner } from "../../fakes/fake-agent-runner.js";
import { FakeWorkspaceManager } from "../../fakes/fake-workspace-manager.js";
import { FakeJobQueue } from "../../fakes/fake-job-queue.js";
import { FakeRunStore } from "../../fakes/fake-run-store.js";
import type { Container } from "@/composition/container.js";
import type { Env } from "@/config/schema.js";
import type { Run, RunId } from "@/domain/run/index.js";

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
  RACCOON_RUN_TIMEOUT_MS: 30000,
  RACCOON_ALLOW_DANGEROUS_PERMISSIONS: false,
  RACCOON_KEEP_FAILED_WORKSPACES: false,
  CLAUDE_CODE_OAUTH_TOKEN: undefined,
  CLAUDE_CODE_PATH: "claude",
  CLAUDE_MODEL: undefined,
  GITHUB_TOKEN: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_APP_INSTALLATION_ID: undefined,
  GITHUB_WEBHOOK_SECRET: "test-secret",
  GITHUB_PROJECT_ID: "PVT_test",
  GITHUB_STATUS_FIELD_NAME: "Status",
  DATABASE_URL: "file::memory:",
  REDIS_URL: undefined,
  MCP_GITHUB_TOKEN: undefined,
};

function makeContainer(): {
  container: Container;
  board: FakeBoardProvider;
  queue: FakeJobQueue;
  store: FakeRunStore;
} {
  const board = new FakeBoardProvider();
  const queue = new FakeJobQueue();
  const store = new FakeRunStore();
  const container: Container = {
    config: { env: minEnv, redacted: {} },
    logger: silentLogger,
    clock: systemClock,
    boardProviders: new Map([["fake-board", board]]),
    vcsProvider: new FakeVcsProvider(),
    agentRunner: new FakeAgentRunner(),
    workspaceManager: new FakeWorkspaceManager(),
    jobQueue: queue,
    runStore: store,
  };
  return { container, board, queue, store };
}

const flush = () => new Promise<void>((r) => setImmediate(r));

// ── /healthz ────────────────────────────────────────────────────────────────

describe("GET /healthz", () => {
  it("returns 200", async () => {
    const { container } = makeContainer();
    const res = await request(createApp(container)).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
  });
});

// ── /readyz ─────────────────────────────────────────────────────────────────

describe("GET /readyz", () => {
  it("returns 200 when store is healthy", async () => {
    const { container } = makeContainer();
    const res = await request(createApp(container)).get("/readyz");
    expect(res.status).toBe(200);
  });
});

// ── POST /webhooks/:provider ─────────────────────────────────────────────────

describe("POST /webhooks/:provider", () => {
  it("returns 404 for unknown provider", async () => {
    const { container } = makeContainer();
    const res = await request(createApp(container))
      .post("/webhooks/unknown")
      .set("Content-Type", "application/json")
      .send({});
    expect(res.status).toBe(404);
  });

  it("returns 401 for invalid signature", async () => {
    const { container, board } = makeContainer();
    board.setWebhookValid(false);
    const res = await request(createApp(container))
      .post("/webhooks/fake-board")
      .set("Content-Type", "application/json")
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 202 for valid webhook", async () => {
    const { container } = makeContainer();
    const res = await request(createApp(container))
      .post("/webhooks/fake-board")
      .set("Content-Type", "application/json")
      .send({});
    expect(res.status).toBe(202);
  });

  it("enqueues a job when event is parseable", async () => {
    const { container, board, queue } = makeContainer();
    board.setNextEvent({
      kind: "TASK_MOVED",
      deliveryId: "del-1",
      taskRef: { provider: "fake-board", projectId: "proj-1", itemId: "item-1" },
    });
    await request(createApp(container))
      .post("/webhooks/fake-board")
      .set("x-github-delivery", "del-1")
      .set("Content-Type", "application/json")
      .send({});
    await flush();
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.type).toBe("BOARD_EVENT");
  });

  it("deduplicates repeated delivery IDs — no duplicate job", async () => {
    const { container, board, queue } = makeContainer();
    board.setNextEvent({
      kind: "TASK_MOVED",
      deliveryId: "del-dup",
      taskRef: { provider: "fake-board", projectId: "proj-1", itemId: "item-1" },
    });
    const app = createApp(container);
    await request(app)
      .post("/webhooks/fake-board")
      .set("x-github-delivery", "del-dup")
      .send({});
    await flush();
    await request(app)
      .post("/webhooks/fake-board")
      .set("x-github-delivery", "del-dup")
      .send({});
    await flush();
    expect(queue.jobs).toHaveLength(1);
  });

  it("enqueues nothing when parseEvent returns null", async () => {
    const { container, board, queue } = makeContainer();
    board.setNextEvent(null);
    await request(createApp(container))
      .post("/webhooks/fake-board")
      .set("Content-Type", "application/json")
      .send({});
    await flush();
    expect(queue.jobs).toHaveLength(0);
  });
});

// ── /api/runs ────────────────────────────────────────────────────────────────

const makeRun = (id: string): Run => ({
  id: id as RunId,
  taskRef: { provider: "fake-board", projectId: "p", itemId: "i" },
  repoRef: { owner: "acme", repo: "api" },
  branch: "raccoon/task-1" as Run["branch"],
  worktreePath: "/tmp/runs/" + id,
  state: "FAILED",
  attempts: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: new Date(),
  completedAt: new Date(),
  prUrl: null,
  sessionId: null,
  errorMessage: "oops",
});

describe("GET /api/runs", () => {
  it("returns active runs", async () => {
    const { container, store } = makeContainer();
    await store.save({ ...makeRun("r1"), state: "IMPLEMENTING" });
    const res = await request(createApp(container)).get("/api/runs");
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns 404 for missing run", async () => {
    const { container } = makeContainer();
    const res = await request(createApp(container)).get("/api/runs/missing");
    expect(res.status).toBe(404);
  });

  it("returns the run when found", async () => {
    const { container, store } = makeContainer();
    await store.save(makeRun("r2"));
    const res = await request(createApp(container)).get("/api/runs/r2");
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe("r2");
  });
});

describe("POST /api/runs/:id/cancel", () => {
  it("returns 409 for invalid transition (DONE → CANCELLED)", async () => {
    const { container, store } = makeContainer();
    await store.save({ ...makeRun("r3"), state: "DONE" });
    const res = await request(createApp(container)).post("/api/runs/r3/cancel");
    expect(res.status).toBe(409);
  });

  it("cancels a queued run", async () => {
    const { container, store } = makeContainer();
    await store.save({ ...makeRun("r4"), state: "QUEUED" });
    const res = await request(createApp(container)).post("/api/runs/r4/cancel");
    expect(res.status).toBe(200);
    expect(res.body.run.state).toBe("CANCELLED");
  });
});

describe("POST /api/runs/:id/retry", () => {
  it("retries a failed run", async () => {
    const { container, store, queue } = makeContainer();
    await store.save(makeRun("r5"));
    const res = await request(createApp(container)).post("/api/runs/r5/retry");
    expect(res.status).toBe(200);
    expect(res.body.run.state).toBe("RETRYING");
    expect(queue.jobs).toHaveLength(1);
  });
});

// ── 404 ──────────────────────────────────────────────────────────────────────

describe("unknown route", () => {
  it("returns 404", async () => {
    const { container } = makeContainer();
    const res = await request(createApp(container)).get("/not-a-route");
    expect(res.status).toBe(404);
  });
});
