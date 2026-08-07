import { Octokit } from "@octokit/rest";
import type { VcsProvider, OpenPrInput, PullRequest, PullRequestRef, CheckStatus } from "@/ports/vcs-provider.js";
import type { RepoRef } from "@/domain/task/index.js";
import type { Env } from "@/config/schema.js";
import { GitHubAuth } from "@/adapters/board/github-projects/auth.js";

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
    }
  }
  throw lastError;
}

export class GitHubVcsProvider implements VcsProvider {
  readonly id = "github";

  private readonly auth: GitHubAuth;

  constructor(private readonly env: Env) {
    this.auth = new GitHubAuth(env);
  }

  private async octokit(): Promise<Octokit> {
    const token = await this.auth.getToken();
    return new Octokit({ auth: token });
  }

  getCloneUrl(repo: RepoRef, token?: string): Promise<string> {
    const auth = token ? `x-access-token:${token}@` : "";
    return Promise.resolve(`https://${auth}github.com/${repo.owner}/${repo.repo}.git`);
  }

  async getDefaultBranch(repo: RepoRef): Promise<string> {
    const kit = await this.octokit();
    const { data } = await kit.repos.get({ owner: repo.owner, repo: repo.repo });
    return data.default_branch;
  }

  async openPullRequest(input: OpenPrInput): Promise<PullRequest> {
    const kit = await this.octokit();
    const { owner, repo } = input.repoRef;
    const result = await withRetry(() =>
      kit.pulls.create({
        owner,
        repo,
        title: input.title,
        body: input.body,
        head: input.branch,
        base: input.baseBranch,
        draft: input.draft,
      }),
    );
    return {
      id: result.data.node_id,
      number: result.data.number,
      url: result.data.html_url,
      headBranch: result.data.head.ref,
    };
  }

  async commentOnPullRequest(pr: PullRequestRef, body: string): Promise<void> {
    const kit = await this.octokit();
    const { owner, repo } = pr.repoRef;
    await withRetry(() =>
      kit.issues.createComment({ owner, repo, issue_number: pr.prNumber, body }),
    );
  }

  async getPullRequestChecks(pr: PullRequestRef): Promise<CheckStatus> {
    const kit = await this.octokit();
    const { owner, repo } = pr.repoRef;

    const pull = await withRetry(() => kit.pulls.get({ owner, repo, pull_number: pr.prNumber }));
    const sha = pull.data.head.sha;

    const runs = await withRetry(() =>
      kit.checks.listForRef({ owner, repo, ref: sha, per_page: 100 }),
    );

    const checks = runs.data.check_runs;
    const total = checks.length;
    if (total === 0) {
      return { conclusion: "pending", totalCount: 0, failedCount: 0 };
    }

    const pending = checks.filter((c) => c.status !== "completed").length;
    if (pending > 0) {
      return { conclusion: "pending", totalCount: total, failedCount: 0 };
    }

    const failed = checks.filter(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    );

    return {
      conclusion: failed.length > 0 ? "failure" : "success",
      totalCount: total,
      failedCount: failed.length,
    };
  }
}
