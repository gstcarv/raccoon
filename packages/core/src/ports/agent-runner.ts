export interface AgentRunInput {
  readonly runId: string;
  readonly prompt: string;
  readonly workingDir: string;
  readonly allowedTools: readonly string[];
  readonly maxTurns: number;
  readonly mcpConfigPath: string | null;
  readonly sessionId: string | null;
  readonly signal?: AbortSignal;
}

export interface AgentRunResult {
  readonly sessionId: string;
  readonly exitCode: number;
  readonly success: boolean;
  readonly outputPath: string;
  readonly costUsd: number | null;
  readonly durationMs: number;
}

export interface AgentRunner {
  readonly id: string;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
