import { describe, it, expect } from "vitest";
import { resolveAgent } from "@/skills/agent-registry.js";
import type { AgentDefinition } from "@/domain/agent/index.js";

const engineerDef: AgentDefinition = {
  id: "engineer",
  name: "Engineer",
  description: "Implements tasks.",
  skills: ["raccoon-workflow", "commit-style"],
  mcp: ["github"],
  allowedTools: ["Bash", "Read", "Write", "Edit"],
  model: null,
  maxTurns: 50,
};

const vars = {
  TASK_TITLE: "Add login",
  TASK_DESCRIPTION: "Add OAuth login",
  REPO_OWNER: "acme",
  REPO_NAME: "api",
};

describe("resolveAgent", () => {
  it("builds a prompt from the declared skills", async () => {
    const spec = await resolveAgent(engineerDef, vars, {});
    expect(spec.id).toBe("engineer");
    expect(spec.prompt.length).toBeGreaterThan(0);
    expect(spec.allowedTools).toContain("Bash");
    expect(spec.maxTurns).toBe(50);
    expect(spec.model).toBeNull();
  });

  it("omits github MCP when MCP_GITHUB_TOKEN is absent", async () => {
    const spec = await resolveAgent(engineerDef, vars, {});
    expect(spec.mcpServers).toHaveLength(0);
  });

  it("includes github MCP when MCP_GITHUB_TOKEN is present", async () => {
    const spec = await resolveAgent(engineerDef, vars, { MCP_GITHUB_TOKEN: "tok-123" });
    expect(spec.mcpServers).toHaveLength(1);
    expect(spec.mcpServers[0]?.command).toBe("npx");
    expect(spec.mcpServers[0]?.env["GITHUB_PERSONAL_ACCESS_TOKEN"]).toBe("tok-123");
  });

  it("AgentSpec is JSON-serializable (no non-serializable handles)", async () => {
    const spec = await resolveAgent(engineerDef, vars, {});
    expect(() => JSON.stringify(spec)).not.toThrow();
  });
});
