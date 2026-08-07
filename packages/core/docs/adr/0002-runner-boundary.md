# ADR 0002 — Serializable Runner Boundary

**Date:** 2026-08-07
**Status:** Accepted

## Context

raccoon-core today is a monolith: webhook ingestion, orchestration, and Claude Code execution all
run in the same process. The long-term target is to extract the execution step into isolated pods
(Kubernetes), leaving the orchestrator as a lightweight dispatcher.

## Decision

Define the runner as a **self-contained unit that receives a fully serializable envelope**:

```
AgentInvocation {
  runId, agent: AgentSpec, task, workspace, sessionId, limits
}
```

`AgentSpec` carries the already-resolved prompt (skills concatenated and interpolated), MCP
server references (command/args/env), allowed tools, model, and maxTurns — everything the runner
needs without calling back to the orchestrator. `AbortSignal` is passed as a separate argument to
`invoke(invocation, signal?)`, outside the envelope, because signals are not serializable.

The `Runner` port:
```ts
interface Runner {
  invoke(input: AgentInvocation, signal?: AbortSignal): Promise<AgentRunResult>;
}
```

Today the `ClaudeCodeRunner` adapter implements `Runner` in-process. Tomorrow a `RemoteRunner`
adapter (HTTP to pod) can implement the same port without touching the orchestration pipeline.

Prompt building and MCP materialization move **into** the runner (or its resolution step),
so the runner is self-sufficient and does not need to call back into the service layer.

## Consequences

- Orchestrator resolves `AgentSpec` before calling `invoke`; runner receives ready-to-use values.
- `AgentInvocation` must remain JSON-serializable (no function references, no file handles).
- Extracting to a pod in the future = implement `RemoteRunner` + serialize `AgentInvocation` over HTTP. No pipeline changes required.
- MCP config materialization (temp file) happens inside the runner adapter's `invoke`, not in the pipeline.
