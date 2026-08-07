import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentDefinition, AgentSpec } from "@/domain/agent/index.js";
import { buildPrompt, type PromptVars } from "./prompts.js";
import { resolveMcpServers } from "./mcp.js";

// Load all agent definitions from a directory of <id>/agent.(json|yaml) files.
export async function loadCatalog(dir: string): Promise<Map<string, AgentDefinition>> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return new Map();
  }

  const defs = await Promise.all(
    entries.map(async (entry) => {
      const jsonPath = join(dir, entry, "agent.json");
      const yamlPath = join(dir, entry, "agent.yaml");
          let text: string;
      let isYaml = false;

      try {
        text = await readFile(jsonPath, "utf8");
      } catch {
        try {
          text = await readFile(yamlPath, "utf8");
          isYaml = true;
        } catch {
          return null;
        }
      }

      // ponytail: cast needed because YAML/JSON parse returns unknown; structure validated by catalog.set guard
      const parsed = (isYaml ? parseYaml(text) : JSON.parse(text)) as AgentDefinition;
      return parsed;
    }),
  );

  const catalog = new Map<string, AgentDefinition>();
  for (const def of defs) {
    if (def && typeof def === "object" && "id" in def) {
      catalog.set(def.id, def);
    }
  }
  return catalog;
}

// Resolve an AgentDefinition into a ready-to-use AgentSpec.
// Assembles the prompt from skills and resolves MCP servers from available env vars.
export async function resolveAgent(
  def: AgentDefinition,
  vars: PromptVars,
  env: Partial<Record<string, string>>,
): Promise<AgentSpec> {
  const [prompt, mcpServers] = await Promise.all([
    buildPrompt(def.skills, vars),
    Promise.resolve(resolveMcpServers(def.mcp, env)),
  ]);

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    prompt,
    allowedTools: def.allowedTools,
    mcpServers,
    model: def.model ?? null,
    maxTurns: def.maxTurns,
  };
}
