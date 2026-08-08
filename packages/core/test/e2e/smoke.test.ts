/**
 * Smoke tests — real GitHub, real Claude CLI, real project.
 *
 * Requires env: GITHUB_TOKEN, GITHUB_PROJECT_ID, GITHUB_WEBHOOK_SECRET,
 *               CLAUDE_CODE_OAUTH_TOKEN, RACCOON_WORKSPACE_DIR
 *
 * Run via: docker compose --profile smoke run --rm smoke
 *
 * For each open issue in gstcarv/raccoon labeled "smoke":
 *   1. Run the full pipeline (real Claude, real git, real GitHub)
 *   2. Close the issue and delete the project item
 */
import { describe, it, beforeAll } from "vitest";
import { join } from "node:path";
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { loadConfig } from "@/config/loader.js";
import { buildContainer } from "@/composition/container.js";
import { GitHubProjectsBoardProvider } from "@/adapters/board/github-projects/index.js";
import { GitHubAuth } from "@/adapters/board/github-projects/auth.js";
import { GitHubVcsProvider } from "@/adapters/vcs/github/index.js";
import { ClaudeCodeRunner } from "@/adapters/agent/claude-code/index.js";
import { GitWorkspaceManager } from "@/adapters/workspaces/git-workspace-manager.js";
import { SqliteRunStore } from "@/adapters/store/sqlite-run-store.js";
import { MemoryRunStore } from "@/adapters/store/memory-run-store.js";
import { InMemoryQueue } from "@/adapters/queue/in-memory-queue.js";
import { loadCatalog } from "@/skills/agent-registry.js";
import { processJob } from "@/pipeline/index.js";
import type { Container } from "@/composition/container.js";
import type { Task } from "@/domain/task/index.js";

const OWNER = "gstcarv";
const REPO = "raccoon";
const LABEL = "smoke";

interface SmokeIssue {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  projectItemId: string | null;
}

async function listSmokeIssues(
  octokit: Octokit,
  gql: ReturnType<typeof graphql.defaults>,
  projectId: string,
): Promise<SmokeIssue[]> {
  const { data } = await octokit.issues.listForRepo({
    owner: OWNER,
    repo: REPO,
    labels: LABEL,
    state: "open",
    per_page: 20,
  });
  if (data.length === 0) return [];

  const { node } = await gql<{
    node: { items: { nodes: { id: string; content: { id: string } | null }[] } };
  }>(
    `query($id: ID!) {
      node(id: $id) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes { id content { ... on Issue { id } } }
          }
        }
      }
    }`,
    { id: projectId },
  );

  const itemByContentId = new Map(
    node.items.nodes
      .filter((n) => n.content !== null)
      .map((n) => [n.content!.id, n.id]),
  );

  return data.map((issue) => ({
    number: issue.number,
    nodeId: issue.node_id,
    title: issue.title,
    body: issue.body ?? "",
    projectItemId: itemByContentId.get(issue.node_id) ?? null,
  }));
}

async function cleanup(
  octokit: Octokit,
  gql: ReturnType<typeof graphql.defaults>,
  projectId: string,
  issue: SmokeIssue,
): Promise<void> {
  await octokit.issues.update({
    owner: OWNER,
    repo: REPO,
    issue_number: issue.number,
    state: "closed",
  });

  if (issue.projectItemId) {
    await gql(
      `mutation($projectId: ID!, $itemId: ID!) {
        deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
          deletedItemId
        }
      }`,
      { projectId, itemId: issue.projectItemId },
    );
  }

  // deleteIssue needs admin scope — best-effort
  await gql(
    `mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { repository { id } } }`,
    { id: issue.nodeId },
  ).catch(() => undefined);
}

function toTask(issue: SmokeIssue, projectId: string): Task {
  return {
    id: issue.nodeId,
    boardRef: {
      provider: "github-projects",
      projectId,
      itemId: issue.projectItemId ?? issue.nodeId,
    },
    repoRef: { owner: OWNER, repo: REPO },
    title: issue.title,
    description: issue.body,
    labels: [LABEL],
    priority: "medium",
    metadata: {},
  };
}

describe("smoke", { timeout: 30 * 60 * 1000 }, () => {
  let container: Container;
  let octokit: Octokit;
  let gql: ReturnType<typeof graphql.defaults>;
  let projectId: string;
  let issues: SmokeIssue[];

  beforeAll(async () => {
    const config = loadConfig();
    projectId = config.env.GITHUB_PROJECT_ID!;

    const token = config.env.GITHUB_TOKEN ?? "";
    octokit = new Octokit({ auth: token });
    gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

    const auth = new GitHubAuth(config.env);
    const vcs = new GitHubVcsProvider(config.env);
    const agentCatalog = await loadCatalog(join(process.cwd(), config.env.RACCOON_AGENTS_DIR));

    const runStore = config.env.DATABASE_URL.startsWith("file:")
      ? new SqliteRunStore(config.env.DATABASE_URL)
      : new MemoryRunStore();

    container = buildContainer(config, {
      boardProviders: [new GitHubProjectsBoardProvider(config.env)],
      vcsProvider: vcs,
      runner: new ClaudeCodeRunner(config.env),
      agentCatalog,
      workspaceManager: new GitWorkspaceManager(vcs, config.env, () => auth.getToken()),
      jobQueue: new InMemoryQueue(),
      runStore,
    });

    issues = await listSmokeIssues(octokit, gql, projectId);
  });

  it("processes all smoke-labeled issues and cleans up", async () => {
    if (issues.length === 0) {
      console.warn(`No open issues labeled "${LABEL}" in ${OWNER}/${REPO} — nothing to run`);
      return;
    }

    for (const issue of issues) {
      await processJob(container, {
        id: `smoke-${issue.number}`,
        type: "MANUAL_TRIGGER",
        payload: { task: toTask(issue, projectId), providerId: "github-projects" },
      });
      await cleanup(octokit, gql, projectId, issue);
    }
  });
});
