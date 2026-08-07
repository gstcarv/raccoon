import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = join(fileURLToPath(import.meta.url), "../../..", "assets/prompts");

export type SkillName =
  | "raccoon-workflow"
  | "commit-style"
  | "pull-request"
  | "test-discipline"
  | "code-review";

export interface PromptVars {
  TASK_TITLE?: string;
  TASK_DESCRIPTION?: string;
  REPO_OWNER?: string;
  REPO_NAME?: string;
  BASE_BRANCH?: string;
}

export async function loadSkill(name: string): Promise<string> {
  const path = join(PROMPTS_DIR, `${name}.md`);
  return readFile(path, "utf8");
}

export function interpolate(template: string, vars: PromptVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return (vars as Record<string, string | undefined>)[key] ?? "";
  });
}

// Build a prompt from an ordered list of skill names, interpolating vars into each section.
export async function buildPrompt(skills: readonly string[], vars: PromptVars): Promise<string> {
  const loaded = await Promise.all(skills.map((s) => loadSkill(s)));
  return loaded.map((text) => interpolate(text, vars)).join("\n\n---\n\n");
}
