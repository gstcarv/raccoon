/**
 * Integration tests for ClaudeCodeRunner.
 *
 * Uses a fake `claude` shell script that emits valid NDJSON, so no real
 * Claude account is needed. Covers: NDJSON parsing, token accumulation,
 * costUsd calculation, session_id extraction, exit-code propagation,
 * and AbortSignal cancellation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFile, chmod, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClaudeCodeRunner } from "@/adapters/agent/claude-code/index.js";
import type { AgentInvocation } from "@/ports/runner.js";
import type { Env } from "@/config/schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TMP = join(tmpdir(), "raccoon-runner-test");
const FAKE_CLAUDE = join(TMP, "fake-claude.sh");
const WORKSPACE = join(TMP, "workspace");

async function writeFakeClaude(script: string): Promise<void> {
  await writeFile(FAKE_CLAUDE, `#!/bin/sh\n${script}`, { encoding: "utf8" });
  await chmod(FAKE_CLAUDE, 0o755);
}

const baseEnv: Env = {
  NODE_ENV: "test",
  PORT: 3000,
  LOG_LEVEL: "silent",
  RACCOON_BASE_URL: "http://localhost:3000",
  RACCOON_COAUTHOR_NAME: "Raccoon Builder",
  RACCOON_COAUTHOR_EMAIL: "raccoon-builder@noreply",
  RACCOON_WORKSPACE_DIR: TMP,
  RACCOON_MAX_CONCURRENT_RUNS: 1,
  RACCOON_RUN_TIMEOUT_MS: 5_000,
  RACCOON_ALLOW_DANGEROUS_PERMISSIONS: false,
  RACCOON_KEEP_FAILED_WORKSPACES: false,
  CLAUDE_CODE_OAUTH_TOKEN: undefined,
  CLAUDE_CODE_PATH: FAKE_CLAUDE,
  CLAUDE_MODEL: undefined,
  GITHUB_TOKEN: undefined,
  GITHUB_APP_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: undefined,
  GITHUB_APP_INSTALLATION_ID: undefined,
  GITHUB_WEBHOOK_SECRET: "secret",
  GITHUB_PROJECT_ID: undefined,
  GITHUB_STATUS_FIELD_NAME: "Status",
  DATABASE_URL: "file::memory:",
  REDIS_URL: undefined,
  MCP_GITHUB_TOKEN: undefined,
  RACCOON_AGENTS_DIR: "./assets/agents",
  RACCOON_DEFAULT_AGENTS: "engineer",
};

const makeInvocation = (overrides: Partial<AgentInvocation> = {}): AgentInvocation => ({
  runId: "run-test-1",
  agent: {
    id: "engineer",
    name: "Engineer",
    description: "test",
    prompt: "do the thing",
    allowedTools: ["Read"],
    mcpServers: [],
    model: null,
    maxTurns: 5,
  },
  task: { title: "T", description: "D", owner: "acme", repo: "api" },
  workspace: { path: WORKSPACE, branch: "raccoon/t-1" },
  sessionId: null,
  limits: { timeoutMs: 5_000 },
  ...overrides,
});

beforeAll(async () => {
  await mkdir(TMP, { recursive: true });
  await mkdir(WORKSPACE, { recursive: true });
});

afterAll(async () => {
  await rm(TMP, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ClaudeCodeRunner", () => {
  it("returns success when fake claude exits 0", async () => {
    await writeFakeClaude(`echo '{"type":"result","subtype":"success"}'; exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation());
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("returns failure when fake claude exits non-zero", async () => {
    await writeFakeClaude(`echo '{"type":"result","subtype":"error_max_turns"}'; exit 1`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-2" }));
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("extracts session_id from NDJSON stream", async () => {
    await writeFakeClaude(`echo '{"type":"system","session_id":"ses-abc123"}'; exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-3" }));
    expect(result.sessionId).toBe("ses-abc123");
  });

  it("falls back to runId when no session_id in stream", async () => {
    await writeFakeClaude(`echo '{"type":"result"}'; exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-fallback" }));
    expect(result.sessionId).toBe("run-fallback");
  });

  it("accumulates token usage and computes costUsd", async () => {
    await writeFakeClaude(`
echo '{"type":"usage","usage":{"input_tokens":1000,"output_tokens":500}}'
exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-4" }));
    // 1000 * 3e-6 + 500 * 15e-6 = 0.003 + 0.0075 = 0.0105
    expect(result.costUsd).toBeCloseTo(0.0105, 6);
  });

  it("returns null costUsd when no usage events emitted", async () => {
    await writeFakeClaude(`echo '{}'; exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-5" }));
    expect(result.costUsd).toBeNull();
  });

  it("writes NDJSON output file named <agentId>-output.ndjson", async () => {
    await writeFakeClaude(`echo '{"type":"result"}'; exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-6" }));
    expect(result.outputPath).toContain("engineer-output.ndjson");
  });

  it("reports durationMs > 0", async () => {
    await writeFakeClaude(`echo '{}'; exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-7" }));
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("tolerates non-JSON lines in stream without throwing", async () => {
    await writeFakeClaude(`
echo 'not json at all'
echo '{"type":"result","session_id":"ses-ok"}'
exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const result = await runner.invoke(makeInvocation({ runId: "run-test-8" }));
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("ses-ok");
  });

  it("propagates sessionId resume flag in args when sessionId provided", async () => {
    // The fake claude echoes its own args so we can assert --resume was passed
    await writeFakeClaude(`
for arg in "$@"; do echo "ARG:$arg"; done
exit 0`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const inv = makeInvocation({ sessionId: "ses-resume-me", runId: "run-test-9" });
    await runner.invoke(inv);
    // output goes to the ndjson file — read it
    const { readFile } = await import("node:fs/promises");
    const out = await readFile(join(TMP, "run-test-9", ".raccoon", "engineer-output.ndjson"), "utf8");
    expect(out).toContain("--resume");
    expect(out).toContain("ses-resume-me");
  });

  it("aborts via AbortSignal and returns non-success", async () => {
    // Use a tight loop instead of sleep so SIGTERM reaches the script itself
    await writeFakeClaude(`trap 'exit 130' TERM; while true; do :; done`);
    const runner = new ClaudeCodeRunner(baseEnv);
    const controller = new AbortController();
    const promise = runner.invoke(makeInvocation({ runId: "run-abort" }), controller.signal);
    setTimeout(() => controller.abort(), 50);
    const result = await promise;
    expect(result.success).toBe(false);
  }, 5_000);
});
