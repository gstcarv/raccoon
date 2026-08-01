import { describe, expect, it } from "vitest";
import { loadConfig } from "@/config/loader.js";
import { redactEnv, type Env } from "@/config/schema.js";

const REQUIRED_ENV: Record<string, string> = {
  GITHUB_WEBHOOK_SECRET: "s3cr3t-value",
};

describe("loadConfig", () => {
  it("loads with only required fields", () => {
    const cfg = loadConfig(REQUIRED_ENV);
    expect(cfg.env.PORT).toBe(3000);
    expect(cfg.env.LOG_LEVEL).toBe("info");
    expect(cfg.env.RACCOON_COAUTHOR_NAME).toBe("Raccoon Builder");
    expect(cfg.env.RACCOON_COAUTHOR_EMAIL).toBe("raccoon-builder@noreply");
    expect(cfg.env.CLAUDE_CODE_PATH).toBe("claude");
  });

  it("env vars override defaults", () => {
    const cfg = loadConfig({
      ...REQUIRED_ENV,
      PORT: "4000",
      LOG_LEVEL: "debug",
      RACCOON_MAX_CONCURRENT_RUNS: "5",
    });
    expect(cfg.env.PORT).toBe(4000);
    expect(cfg.env.LOG_LEVEL).toBe("debug");
    expect(cfg.env.RACCOON_MAX_CONCURRENT_RUNS).toBe(5);
  });

  it("throws with all errors when multiple fields are invalid", () => {
    expect(() =>
      loadConfig({
        PORT: "not-a-number",
        LOG_LEVEL: "invalid-level",
        // GITHUB_WEBHOOK_SECRET missing
      }),
    ).toThrow(/Configuration errors:/);
  });

  it("throws on missing required GITHUB_WEBHOOK_SECRET", () => {
    expect(() => loadConfig({})).toThrow(/GITHUB_WEBHOOK_SECRET/);
  });

  it("RACCOON_ALLOW_DANGEROUS_PERMISSIONS parses to boolean", () => {
    const cfg = loadConfig({ ...REQUIRED_ENV, RACCOON_ALLOW_DANGEROUS_PERMISSIONS: "true" });
    expect(cfg.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS).toBe(true);

    const cfg2 = loadConfig({ ...REQUIRED_ENV, RACCOON_ALLOW_DANGEROUS_PERMISSIONS: "false" });
    expect(cfg2.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS).toBe(false);
  });
});

describe("redactEnv", () => {
  const SECRET_VALUES = [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_APP_PRIVATE_KEY",
    "MCP_GITHUB_TOKEN",
    "GITHUB_WEBHOOK_SECRET",
  ] as const;

  it("redacts all secret fields", () => {
    const env: Partial<Env> = {
      CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-real-token",
      GITHUB_TOKEN: "ghp_realtoken",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
      MCP_GITHUB_TOKEN: "ghp_mcp_token",
      GITHUB_WEBHOOK_SECRET: "super-secret",
      PORT: 3000,
      LOG_LEVEL: "info",
    };

    const redacted = redactEnv(env as Env);

    for (const field of SECRET_VALUES) {
      if (env[field]) {
        expect(redacted[field]).toBe("[REDACTED]");
        expect(redacted[field]).not.toBe(env[field]);
      }
    }
  });

  it("does not redact non-secret fields", () => {
    const cfg = loadConfig(REQUIRED_ENV);
    const redacted = cfg.redacted;
    expect(redacted["PORT"]).toBe(3000);
    expect(redacted["LOG_LEVEL"]).toBe("info");
    expect(redacted["RACCOON_COAUTHOR_NAME"]).toBe("Raccoon Builder");
  });

  it("no real token value appears in redacted output", () => {
    const secretValue = "ghp_super_secret_token_that_must_not_leak";
    const env: Partial<Env> = {
      GITHUB_TOKEN: secretValue,
      PORT: 3000,
      GITHUB_WEBHOOK_SECRET: "wh-secret",
      LOG_LEVEL: "info",
    };
    const redacted = redactEnv(env as Env);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(secretValue);
  });
});
