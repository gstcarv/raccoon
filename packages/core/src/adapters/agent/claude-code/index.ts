import { execa } from "execa";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { AgentRunner, AgentRunInput, AgentRunResult } from "@/ports/agent-runner.js";
import type { Env } from "@/config/schema.js";

// NDJSON message types emitted by claude -p --output-format stream-json
interface ClaudeMessage {
  type: string;
  usage?: { input_tokens: number; output_tokens: number };
  session_id?: string;
}

const COST_PER_INPUT_TOKEN = 3e-6;
const COST_PER_OUTPUT_TOKEN = 15e-6;

export class ClaudeCodeRunner implements AgentRunner {
  readonly id = "claude-code";

  constructor(private readonly env: Env) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const start = Date.now();
    const logsDir = join(this.env.RACCOON_WORKSPACE_DIR, input.runId, ".raccoon");
    await mkdir(logsDir, { recursive: true });

    const outputPath = join(logsDir, "claude-output.ndjson");
    const logStream = createWriteStream(outputPath, { flags: "a" });

    const args = this.buildArgs(input);
    const env = this.buildEnv(input);

    let sessionId = input.sessionId ?? "";
    let inputTokens = 0;
    let outputTokens = 0;
    let exitCode = 0;

    try {
      const proc = execa(this.env.CLAUDE_CODE_PATH, args, {
        cwd: input.workingDir,
        env,
        signal: input.signal,
        all: true,
        reject: false,
      });

      for await (const line of iterLines(proc.all)) {
        logStream.write(line + "\n");
        try {
          const msg = JSON.parse(line) as ClaudeMessage;
          if (msg.session_id) sessionId = msg.session_id;
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
    } finally {
      logStream.end();
    }

    const costUsd = inputTokens > 0 || outputTokens > 0
      ? inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN
      : null;

    return {
      sessionId: sessionId || input.runId,
      exitCode,
      success: exitCode === 0,
      outputPath,
      costUsd,
      durationMs: Date.now() - start,
    };
  }

  private buildArgs(input: AgentRunInput): string[] {
    const args = [
      "--print",
      "--output-format", "stream-json",
      "--max-turns", String(input.maxTurns),
    ];

    if (input.sessionId) {
      args.push("--resume", input.sessionId);
    }

    if (input.allowedTools.length > 0) {
      args.push("--allowedTools", input.allowedTools.join(","));
    }

    if (input.mcpConfigPath) {
      args.push("--mcp-config", input.mcpConfigPath);
    }

    if (this.env.CLAUDE_MODEL) {
      args.push("--model", this.env.CLAUDE_MODEL);
    }

    if (this.env.RACCOON_ALLOW_DANGEROUS_PERMISSIONS) {
      // ponytail: only enabled when RACCOON_ALLOW_DANGEROUS_PERMISSIONS is set and logged at boot
      args.push("--dangerously-skip-permissions");
    }

    args.push(input.prompt);
    return args;
  }

  private buildEnv(input: AgentRunInput): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };

    if (this.env.CLAUDE_CODE_OAUTH_TOKEN) {
      env["CLAUDE_CODE_OAUTH_TOKEN"] = this.env.CLAUDE_CODE_OAUTH_TOKEN;
    }

    if (input.mcpConfigPath) {
      env["CLAUDE_MCP_CONFIG_PATH"] = input.mcpConfigPath;
    }

    // Redact secrets from child process env to avoid leakage
    delete env["GITHUB_TOKEN"];
    delete env["GITHUB_APP_PRIVATE_KEY"];
    delete env["GITHUB_WEBHOOK_SECRET"];

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
