import type { AgentSpec } from "@/domain/agent/index.js";

// Fully serializable envelope sent to the runner.
// AbortSignal is passed separately (not serializable).
export interface AgentInvocation {
  readonly runId: string;
  readonly agent: AgentSpec;
  readonly task: {
    readonly title: string;
    readonly description: string;
    readonly owner: string;
    readonly repo: string;
  };
  readonly workspace: {
    readonly path: string;
    readonly branch: string;
  };
  readonly sessionId: string | null;
  readonly limits: {
    readonly timeoutMs: number;
  };
}

export interface AgentRunResult {
  readonly sessionId: string;
  readonly exitCode: number;
  readonly success: boolean;
  readonly outputPath: string;
  readonly costUsd: number | null;
  readonly durationMs: number;
}

export interface Runner {
  readonly id: string;
  invoke(input: AgentInvocation, signal?: AbortSignal): Promise<AgentRunResult>;
}
