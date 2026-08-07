import { describe, it, expect } from "vitest";
import { redactEnv } from "@/config/schema.js";
import type { Env } from "@/config/schema.js";

const fullEnv: Env = {
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
  CLAUDE_CODE_OAUTH_TOKEN: "super-secret-token",
  CLAUDE_CODE_PATH: "claude",
  CLAUDE_MODEL: undefined,
  GITHUB_TOKEN: "ghp_supersecret",
  GITHUB_APP_ID: undefined,
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nfoo",
  GITHUB_APP_INSTALLATION_ID: undefined,
  GITHUB_WEBHOOK_SECRET: "webhook-secret-value",
  GITHUB_PROJECT_ID: "PVT_test",
  GITHUB_STATUS_FIELD_NAME: "Status",
  DATABASE_URL: "file:./raccoon.db",
  REDIS_URL: undefined,
  MCP_GITHUB_TOKEN: "mcp-token",
  RACCOON_AGENTS_DIR: "./assets/agents",
  RACCOON_DEFAULT_AGENTS: "engineer",
};

describe("redactEnv", () => {
  it("redacts all secret fields", () => {
    const redacted = redactEnv(fullEnv);
    expect(redacted["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("[REDACTED]");
    expect(redacted["GITHUB_TOKEN"]).toBe("[REDACTED]");
    expect(redacted["GITHUB_APP_PRIVATE_KEY"]).toBe("[REDACTED]");
    expect(redacted["GITHUB_WEBHOOK_SECRET"]).toBe("[REDACTED]");
    expect(redacted["MCP_GITHUB_TOKEN"]).toBe("[REDACTED]");
  });

  it("does not redact non-secret fields", () => {
    const redacted = redactEnv(fullEnv);
    expect(redacted["NODE_ENV"]).toBe("test");
    expect(redacted["PORT"]).toBe(3000);
    expect(redacted["RACCOON_COAUTHOR_NAME"]).toBe("Raccoon Builder");
    expect(redacted["GITHUB_STATUS_FIELD_NAME"]).toBe("Status");
  });

  it("does not redact undefined secret fields", () => {
    const env: Env = { ...fullEnv, CLAUDE_CODE_OAUTH_TOKEN: undefined };
    const redacted = redactEnv(env);
    expect(redacted["CLAUDE_CODE_OAUTH_TOKEN"]).toBeUndefined();
  });
});
