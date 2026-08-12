import { execa } from "execa";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { Runner, AgentInvocation, AgentRunResult } from "@/ports/runner.js";
import type { Env } from "@/config/schema.js";
import { mcpRefsToConfig, materializeMcpConfig } from "@/skills/mcp.js";
import { logger } from "@/shared/logger.js";

// NDJSON message types emitted by claude -p --output-format stream-json
interface ClaudeMessage {
  type: string;
  usage?: { input_tokens: number; output_tokens: number };
  session_id?: string;
}

const COST_PER_INPUT_TOKEN = 3e-6;
const COST_PER_OUTPUT_TOKEN = 15e-6;

export class ClaudeCodeRunner implements Runner {
  readonly id = "claude-code";

  constructor(private readonly env: Env) {}

  async invoke(input: AgentInvocation, signal?: AbortSignal): Promise<AgentRunResult> {
    const start = Date.now();
    const logsDir = join(this.env.RACCOON_WORKSPACE_DIR, input.runId, ".raccoon");
    await mkdir(logsDir, { recursive: true });

    const outputPath = join(logsDir, `${input.agent.id}-output.ndjson`);
    const logStream = createWriteStream(outputPath, { flags: "a" });

    // Materialize MCP config from resolved refs — runner is self-contained.
    const mcpConfig = mcpRefsToConfig(input.agent.mcpServers);
    let mcpConfigPath: string | null = null;
    let mcpDispose: (() => Promise<void>) | null = null;

    if (mcpConfig) {
      const materialized = await materializeMcpConfig(mcpConfig);
      mcpConfigPath = materialized.path;
      mcpDispose = materialized.dispose;
    }

    let sessionId = input.sessionId ?? "";
    let inputTokens = 0;
    let outputTokens = 0;
    let exitCode = 0;

    const log = logger.child({ runId: input.runId, agentId: input.agent.id });
    log.info({ model: input.agent.model ?? this.env.CLAUDE_MODEL, maxTurns: input.agent.maxTurns, outputPath }, "starting claude-code process");

    try {
      const args = this.buildArgs(input, mcpConfigPath);
      const procEnv = this.buildEnv(input, mcpConfigPath);

      const proc = execa(this.env.CLAUDE_CODE_PATH, args, {
        cwd: input.workspace.path,
        env: procEnv,
        ...(signal ? { cancelSignal: signal } : {}),
        all: true,
        reject: false,
      });

      for await (const line of iterLines(proc.all)) {
        logStream.write(line + "\n");
        try {
          const msg = JSON.parse(line) as ClaudeMessage;
          if (msg.session_id) {
            if (!sessionId) log.debug({ sessionId: msg.session_id }, "session started");
            sessionId = msg.session_id;
          }
          if (msg.usage) {
            inputTokens += msg.usage.input_tokens;
            outputTokens += msg.usage.output_tokens;
          }
        } catch {
          // non-JSON line (e.g., stderr passthrough) — ignore
        }
      }

      const result = await proc;
      exitCode = result.exitCode ?? 1;
      log.info({ exitCode, inputTokens, outputTokens }, "claude-code process exited");
    } finally {
      logStream.end();
      if (mcpDispose) await mcpDispose();
    }

    const costUsd =
      inputTokens > 0 || outputTokens > 0
        ? inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN
        : null;

    const durationMs = Date.now() - start;
    log.info({ exitCode, costUsd, durationMs, outputPath }, "agent run complete");
    return {
      sessionId: sessionId || input.runId,
      exitCode,
      success: exitCode === 0,
      outputPath,
      costUsd,
      durationMs,
    };
  }

  private buildArgs(input: AgentInvocation, mcpConfigPath: string | null): string[] {
    const agent = input.agent;
    const args = [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--max-turns",
      String(agent.maxTurns),
    ];

    if (input.sessionId) {
      args.push("--resume", input.sessionId);
    }

    if (agent.allowedTools.length > 0) {
      args.push("--allowedTools", agent.allowedTools.join(","));
    }

    if (mcpConfigPath) {
      args.push("--mcp-config", mcpConfigPath);
    }

    const model = agent.model ?? this.env.CLAUDE_MODEL;
    if (model) {
      args.push("--model", model);
    }

    if (this.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS) {
      // ponytail: only enabled when RACCOON_ALLOW_DANGEROUS_PERMISSIONS is set and logged at boot
      args.push("--dangerously-skip-permissions");
    }

    args.push("--", agent.prompt);
    return args;
  }

  private buildEnv(
    input: AgentInvocation,
    mcpConfigPath: string | null,
  ): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };

    if (this.env.CLAUDE_CODE_OAUTH_TOKEN) {
      env["CLAUDE_CODE_OAUTH_TOKEN"] = this.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    if (mcpConfigPath) {
      env["CLAUDE_MCP_CONFIG_PATH"] = mcpConfigPath;
    }

    // Redact secrets from child process env to avoid leakage
    delete env["GITHUB_TOKEN"];
    delete env["GITHUB_APP_PRIVATE_KEY"];
    delete env["GITHUB_WEBHOOK_SECRET"];

    void input; // input used for mcpConfigPath and sessionId — workspace.path set as cwd
    return env;
  }
}

async function* iterLines(
  stream: Readable | null | undefined,
): AsyncGenerator<string> {
  if (!stream) return;
  let buf = "";
  for await (const chunk of stream) {
    buf += chunk as string;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) yield buf;
}
