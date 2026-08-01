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

export async function loadSkill(name: SkillName): Promise<string> {
  const path = join(PROMPTS_DIR, `${name}.md`);
  return readFile(path, "utf8");
}

export function interpolate(template: string, vars: PromptVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return (vars as Record<string, string | undefined>)[key] ?? "";
  });
}

export async function buildPrompt(vars: PromptVars): Promise<string> {
  const [workflow, commitStyle, prStyle, testDiscipline] = await Promise.all([
    loadSkill("raccoon-workflow"),
    loadSkill("commit-style"),
    loadSkill("pull-request"),
    loadSkill("test-discipline"),
  ]);

  const sections = [
    interpolate(workflow, vars),
    "---",
    commitStyle,
    "---",
    prStyle,
    "---",
    testDiscipline,
  ];

  return sections.join("\n\n");
}
