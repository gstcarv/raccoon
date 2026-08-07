import { z } from "zod";

const positiveInt = (def: number) =>
  z.coerce.number().int().positive().default(def);

export const repoConfigSchema = z.object({
  boardProvider: z.string().default("github-projects"),
  projectId: z.string(),
  statusFieldName: z.string().default("Status"),
  statusFieldMapping: z
    .object({
      BACKLOG: z.string().default("Backlog"),
      IN_PROGRESS: z.string().default("In progress"),
      IN_REVIEW: z.string().default("In review"),
      DONE: z.string().default("Done"),
      BLOCKED: z.string().default("Blocked"),
    })
    .default({}),
  baseBranch: z.string().default("main"),
  testCommand: z.string().optional(),
  allowAutoMerge: z.boolean().default(false),
  // Ordered list of agent ids to run for tasks in this repo. Default: engineer only.
  agents: z.array(z.string()).default(["engineer"]),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: positiveInt(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  RACCOON_BASE_URL: z.string().url().default("http://localhost:3000"),
  RACCOON_COAUTHOR_NAME: z.string().default("Raccoon Builder"),
  RACCOON_COAUTHOR_EMAIL: z.string().default("raccoon-builder@noreply"),
  RACCOON_WORKSPACE_DIR: z.string().default("./data/workspaces"),
  RACCOON_MAX_CONCURRENT_RUNS: positiveInt(3),
  RACCOON_RUN_TIMEOUT_MS: positiveInt(30 * 60 * 1000), // 30 min
  RACCOON_ALLOW_DANGEROUS_PERMISSIONS: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
  RACCOON_KEEP_FAILED_WORKSPACES: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),

  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  CLAUDE_CODE_PATH: z.string().default("claude"),
  CLAUDE_MODEL: z.string().optional(),

  GITHUB_TOKEN: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_PROJECT_ID: z.string().optional(),
  GITHUB_STATUS_FIELD_NAME: z.string().default("Status"),

  DATABASE_URL: z.string().default("file:./data/raccoon.db"),
  REDIS_URL: z.string().optional(),

  MCP_GITHUB_TOKEN: z.string().optional(),

  // Path to the agents catalog directory (contains <id>/agent.json folders).
  RACCOON_AGENTS_DIR: z.string().default("./assets/agents"),
  // CSV of default agent ids when no repo-level config is present.
  RACCOON_DEFAULT_AGENTS: z.string().default("engineer"),
});

export type Env = z.infer<typeof envSchema>;

const SECRET_FIELDS: ReadonlySet<string> = new Set([
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_APP_PRIVATE_KEY",
  "MCP_GITHUB_TOKEN",
  "GITHUB_WEBHOOK_SECRET",
]);

export function redactEnv(env: Env): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    result[key] = SECRET_FIELDS.has(key) && value ? "[REDACTED]" : value;
  }
  return result;
}
