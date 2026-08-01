import { readFileSync, existsSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { envSchema, redactEnv, type Env } from "./schema.js";

export interface RaccoonConfig {
  readonly env: Env;
  readonly redacted: Record<string, unknown>;
}

function loadYamlFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = parseYaml(content) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadConfig(
  envOverrides: Record<string, string | undefined> = process.env,
  configFilePath = "raccoon.config.yaml",
): RaccoonConfig {
  const fileVars = loadYamlFile(configFilePath);

  // env vars win over file, file wins over schema defaults
  const merged: Record<string, unknown> = { ...fileVars, ...envOverrides };

  const result = envSchema.safeParse(merged);

  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration errors:\n${messages}`);
  }

  return {
    env: result.data,
    redacted: redactEnv(result.data),
  };
}
