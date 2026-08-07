// Resolved MCP server reference — serializable, no env lookup at runtime.
export interface McpServerRef {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

// Static catalog entry loaded from assets/agents/<id>/agent.json.
// Not resolved — no I/O, no env reads, no prompt text.
export interface AgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly skills: readonly string[];
  readonly mcp: readonly string[];
  readonly allowedTools: readonly string[];
  readonly model: string | null;
  readonly maxTurns: number;
}

// Fully resolved agent — ready to send to the runner (serializable).
export interface AgentSpec {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly allowedTools: readonly string[];
  readonly mcpServers: readonly McpServerRef[];
  readonly model: string | null;
  readonly maxTurns: number;
}
