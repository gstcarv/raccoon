import type { AgentRunner, AgentRunInput, AgentRunResult } from "@/ports/agent-runner.js";

export class FakeAgentRunner implements AgentRunner {
  readonly id = "fake-agent";

  private result: AgentRunResult = {
    sessionId: "session-fake-1",
    exitCode: 0,
    success: true,
    outputPath: "/tmp/fake-agent.ndjson",
    costUsd: 0.01,
    durationMs: 500,
  };
  calls: AgentRunInput[] = [];

  // --- test helpers ---
  setResult(result: Partial<AgentRunResult>): void {
    this.result = { ...this.result, ...result };
  }
  setFailure(): void {
    this.result = { ...this.result, exitCode: 1, success: false };
  }

  // --- port impl ---
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    this.calls.push(input);
    if (input.signal?.aborted) {
      throw new Error("AbortError");
    }
    return Promise.resolve(this.result);
  }
}
