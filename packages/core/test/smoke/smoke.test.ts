/**
 * Smoke tests — real GitHub, real Claude CLI, real project.
 *
 * Requires in env:
 *   GITHUB_TOKEN, GITHUB_PROJECT_ID, GITHUB_WEBHOOK_SECRET,
 *   CLAUDE_CODE_OAUTH_TOKEN, RACCOON_WORKSPACE_DIR
 *
 * Run via: docker compose --profile smoke run --rm smoke
 *
 * Lifecycle:
 *   1. Find all open issues in gstcarv/raccoon labeled "smoke"
 *   2. For each issue, locate its project item and run the full pipeline
 *   3. After each test (pass or fail), close the issue and delete the project item
 */
import { describe, it, beforeAll, afterEach } from "vitest";
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
import type { Job } from "@/ports/job-queue.js";

const SMOKE_OWNER = "gstcarv";
const SMOKE_REPO = "raccoon";
const SMOKE_LABEL = "smoke";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SmokeIssue {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  projectItemId: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findSmokeIssues(
  octokit: Octokit,
  gql: typeof graphql,
  projectId: string,
): Promise<SmokeIssue[]> {
  const { data: issues } = await octokit.issues.listForRepo({
    owner: SMOKE_OWNER,
    repo: SMOKE_REPO,
    labels: SMOKE_LABEL,
    state: "open",
    per_page: 20,
  });

  if (issues.length === 0) return [];

  // Fetch project items to cross-reference by content node_id
  const { node } = await gql<{
    node: { items: { nodes: { id: string; content: { id: string } | null }[] } };
  }>(
    `query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes { id content { ... on Issue { id } } }
          }
        }
      }
    }`,
    { projectId },
  );

  const itemByContentId = new Map<string, string>(
    node.items.nodes
      .filter((n) => n.content !== null)
      .map((n) => [n.content!.id, n.id]),
  );

  return issues.map((issue) => ({
    number: issue.number,
    nodeId: issue.node_id,
    title: issue.title,
    body: issue.body ?? "",
    projectItemId: itemByContentId.get(issue.node_id) ?? null,
  }));
}

async function closeAndDeleteIssue(
  octokit: Octokit,
  gql: typeof graphql,
  projectId: string,
  issue: SmokeIssue,
): Promise<void> {
  await octokit.issues.update({
    owner: SMOKE_OWNER,
    repo: SMOKE_REPO,
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

  // deleteIssue requires admin scope — best-effort, ignore if token lacks it
  await gql(
    `mutation($issueId: ID!) {
      deleteIssue(input: { issueId: $issueId }) { repository { id } }
    }`,
    { issueId: issue.nodeId },
  ).catch(() => undefined);
}

function buildTask(issue: SmokeIssue, projectId: string): Task {
  return {
    id: issue.nodeId,
    boardRef: {
      provider: "github-projects",
      projectId,
      itemId: issue.projectItemId ?? issue.nodeId,
    },
    repoRef: { owner: SMOKE_OWNER, repo: SMOKE_REPO },
    title: issue.title,
    description: issue.body,
    labels: [SMOKE_LABEL],
    priority: "medium",
    metadata: {},
  };
}

function makeJob(task: Task): Job {
  return {
    id: `smoke-${task.id}`,
    type: "MANUAL_TRIGGER",
    payload: { task, providerId: "github-projects" },
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("smoke — real pipeline", { timeout: 30 * 60 * 1000 }, () => {
  let _container: Container;
  let octokit: Octokit;
  let gql: typeof graphql;
  let smokeIssues: SmokeIssue[];
  let projectId: string;

  beforeAll(async () => {
    const config = loadConfig();
    projectId = config.env.GITHUB_PROJECT_ID!;

    const token = config.env.GITHUB_TOKEN ?? "";
    octokit = new Octokit({ auth: token });
    gql = graphql.defaults({ headers: { authorization: `token ${token}` } });

    const auth = new GitHubAuth(config.env);
    const getToken = () => auth.getToken();

    const agentsDir = join(process.cwd(), config.env.RACCOON_AGENTS_DIR);
    const agentCatalog = await loadCatalog(agentsDir);

    const runStore = config.env.DATABASE_URL.startsWith("file:")
      ? new SqliteRunStore(config.env.DATABASE_URL)
      : new MemoryRunStore();

    _container = buildContainer(config, {
      boardProviders: [new GitHubProjectsBoardProvider(config.env)],
      vcsProvider: new GitHubVcsProvider(config.env),
      runner: new ClaudeCodeRunner(config.env),
      agentCatalog,
      workspaceManager: new GitWorkspaceManager(
        new GitHubVcsProvider(config.env),
        config.env,
        getToken,
      ),
      jobQueue: new InMemoryQueue(),
      runStore,
    });

    smokeIssues = await findSmokeIssues(octokit, gql, projectId);
  });

  afterEach(async (ctx) => {
    // Identify which issue this test ran by extracting it from the test name
    const issue = smokeIssues.find((i) => ctx.task.name.includes(`#${i.number}`));
    if (issue) {
      await closeAndDeleteIssue(octokit, gql, projectId, issue);
    }
  });

  it("has at least one smoke issue", () => {
    if (smokeIssues.length === 0) {
      throw new Error(
        `No open issues labeled "${SMOKE_LABEL}" found in ${SMOKE_OWNER}/${SMOKE_REPO}`,
      );
    }
  });

  // Tests are generated dynamically per issue in beforeAll — vitest supports
  // top-level dynamic tests via a separate describe block.
});

// Dynamic per-issue tests — generated after suite setup is complete.
// We use a module-level describe so vitest picks them up at collection time.
// The actual work happens when the test body runs (by which point beforeAll ran).
describe("smoke — per issue", { timeout: 30 * 60 * 1000 }, () => {
  // Re-build minimal context needed to run; shared state via module scope.
  // ponytail: module-scope state is fine here — smoke tests are one-shot sequential
  let _container: Container | undefined;
  let _octokit: Octokit | undefined;
  let _gql: ((query: string, vars: Record<string, string>) => Promise<unknown>) | undefined;
  let _projectId: string | undefined;
  let _issues: SmokeIssue[] | undefined;

  beforeAll(async () => {
    const config = loadConfig();
    _projectId = config.env.GITHUB_PROJECT_ID;

    const token = config.env.GITHUB_TOKEN ?? "";
    _octokit = new Octokit({ auth: token });
    _gql = graphql.defaults({ headers: { authorization: `token ${token}` } }) as typeof _gql;

    const auth = new GitHubAuth(config.env);
    const getToken = () => auth.getToken();

    const agentsDir = join(process.cwd(), config.env.RACCOON_AGENTS_DIR);
    const agentCatalog = await loadCatalog(agentsDir);

    const runStore = config.env.DATABASE_URL.startsWith("file:")
      ? new SqliteRunStore(config.env.DATABASE_URL)
      : new MemoryRunStore();

    const vcs = new GitHubVcsProvider(config.env);
    _container = buildContainer(config, {
      boardProviders: [new GitHubProjectsBoardProvider(config.env)],
      vcsProvider: vcs,
      runner: new ClaudeCodeRunner(config.env),
      agentCatalog,
      workspaceManager: new GitWorkspaceManager(vcs, config.env, getToken),
      jobQueue: new InMemoryQueue(),
      runStore,
    });

    _issues = await findSmokeIssues(_octokit, _gql as typeof graphql, _projectId!);
  });

  it("smoke pipeline runs and cleans up each labeled issue", async () => {
    const issues = _issues ?? [];
    if (issues.length === 0) return; // no smoke issues — nothing to do

    for (const issue of issues) {
      const task = buildTask(issue, _projectId!);
      const job = makeJob(task);

      await processJob(_container!, job);

      await closeAndDeleteIssue(
        _octokit!,
        _gql as typeof graphql,
        _projectId!,
        issue,
      );
    }
  });
});
