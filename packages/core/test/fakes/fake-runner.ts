import type { Runner, AgentInvocation, AgentRunResult } from "@/ports/runner.js";

export class FakeRunner implements Runner {
  readonly id = "fake-runner";

  private result: AgentRunResult = {
    sessionId: "session-fake-1",
    exitCode: 0,
    success: true,
    outputPath: "/tmp/fake-runner.ndjson",
    costUsd: 0.01,
    durationMs: 500,
  };
  invocations: AgentInvocation[] = [];

  // --- test helpers ---
  setResult(result: Partial<AgentRunResult>): void {
    this.result = { ...this.result, ...result };
  }
  setFailure(): void {
    this.result = { ...this.result, exitCode: 1, success: false };
  }

  // --- port impl ---
  async invoke(input: AgentInvocation, signal?: AbortSignal): Promise<AgentRunResult> {
    this.invocations.push(input);
    if (signal?.aborted) {
      throw new Error("AbortError");
    }
    return Promise.resolve(this.result);
  }
}
