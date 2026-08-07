import { writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpServerRef } from "@/domain/agent/index.js";

export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServer>;
}

// Materializes an MCP config file to a temp path with 0600 permissions.
// Caller must delete the file when done (call dispose()).
export async function materializeMcpConfig(
  config: McpConfig,
): Promise<{ path: string; dispose: () => Promise<void> }> {
  const path = join(tmpdir(), `raccoon-mcp-${String(Date.now())}.json`);
  await writeFile(path, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return {
    path,
    dispose: () => rm(path, { force: true }),
  };
}

// All known MCP server builders, keyed by catalog id.
// Each entry returns null when required env vars are absent.
const MCP_BUILDERS: Readonly<
  Record<string, (env: Partial<Record<string, string>>) => McpServerRef | null>
> = {
  github: (env) => {
    const token = env["MCP_GITHUB_TOKEN"];
    if (!token) return null;
    return {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: token },
    };
  },
};

// Resolve a list of MCP catalog ids to McpServerRef[], omitting any that
// lack required env vars. Safe to call with an empty list.
export function resolveMcpServers(
  ids: readonly string[],
  env: Partial<Record<string, string>>,
): McpServerRef[] {
  const result: McpServerRef[] = [];
  for (const id of ids) {
    const builder = MCP_BUILDERS[id];
    if (!builder) continue;
    const ref = builder(env);
    if (ref) result.push(ref);
  }
  return result;
}

// Convert resolved McpServerRef[] to the McpConfig format expected by claude --mcp-config.
export function mcpRefsToConfig(refs: readonly McpServerRef[]): McpConfig | null {
  if (refs.length === 0) return null;
  const mcpServers: Record<string, McpServer> = {};
  refs.forEach((ref, i) => {
    mcpServers[`server-${String(i)}`] = { command: ref.command, args: [...ref.args], env: { ...ref.env } };
  });
  return { mcpServers };
}
