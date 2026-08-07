# ADR 0003 — Dynamic Multi-Agent Catalog

**Date:** 2026-08-07
**Status:** Accepted

## Context

The current pipeline hardcodes a single Claude Code invocation with a fixed prompt and MCP config.
We need to support multiple agent roles (engineer, code-reviewer, qa, designer, …), each with its
own prompt skills, MCP servers, allowed tools, model, and maxTurns, selectable per task.

## Decision

Define agents via a **file-based catalog** at `assets/agents/<id>/agent.json`. Each file is an
`AgentDefinition` (static description: skill names, MCP ids, tool list, model, maxTurns).

An `AgentRegistry` resolves definitions into `AgentSpec` objects (runtime: prompt text assembled
from skills, MCP server references resolved and filtered by available env vars).

The pipeline runs agents in a **linear sequence** configured per repo (`agents: ["engineer",
"code-reviewer"]`) with a global default of `["engineer"]`. This preserves the current
single-agent behaviour with zero config change.

Adding a new agent role = add `assets/agents/<role>/agent.json` + skill files. No code changes.

## Consequences

- `AgentDefinition` lives in the domain (`src/domain/agent/`) and is pure (zero I/O).
- `AgentSpec` (resolved) is what travels to the runner — fully serializable (see ADR 0002).
- MCP servers missing required env vars are silently omitted from the resolved spec.
- Pipeline loop: one runner invocation per agent, `sessionId` propagated between agents.
- State machine reuse: `engineer` maps to `IMPLEMENTING`, `code-reviewer` to `REVIEWING`,
  other roles log `currentAgent` but stay in `IMPLEMENTING`.
- DAG/parallel agents: not needed now; linear loop is the upgrade path.
