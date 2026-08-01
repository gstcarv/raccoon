import { writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

// Builds the default MCP config for raccoon runs using the MCP_GITHUB_TOKEN env var.
export function buildDefaultMcpConfig(mcpGithubToken: string | undefined): McpConfig | null {
  if (!mcpGithubToken) return null;
  return {
    mcpServers: {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: mcpGithubToken },
      },
    },
  };
}
