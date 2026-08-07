import type { VcsProvider, OpenPrInput, PullRequest, PullRequestRef, CheckStatus } from "@/ports/vcs-provider.js";
import type { RepoRef } from "@/domain/task/index.js";

export class FakeVcsProvider implements VcsProvider {
  readonly id = "fake-vcs";

  private pullRequests: PullRequest[] = [];
  private prComments: Array<{ pr: PullRequestRef; body: string }> = [];
  private checkStatus: CheckStatus = { conclusion: "success", totalCount: 0, failedCount: 0 };
  private prCounter = 1;

  // --- test helpers ---
  setCheckStatus(status: CheckStatus): void {
    this.checkStatus = status;
  }
  getPullRequests(): ReadonlyArray<PullRequest> {
    return this.pullRequests;
  }
  getPrComments(): ReadonlyArray<{ pr: PullRequestRef; body: string }> {
    return this.prComments;
  }

  // --- port impl ---
  async getDefaultBranch(_repo: RepoRef): Promise<string> {
    return "main";
  }

  async getCloneUrl(repo: RepoRef): Promise<string> {
    return Promise.resolve(`https://github.com/${repo.owner}/${repo.repo}.git`);
  }

  async openPullRequest(input: OpenPrInput): Promise<PullRequest> {
    const pr: PullRequest = {
      id: `pr-${this.prCounter++}`,
      number: this.prCounter,
      url: `https://github.com/${input.repoRef.owner}/${input.repoRef.repo}/pull/${this.prCounter}`,
      headBranch: input.branch,
    };
    this.pullRequests.push(pr);
    return Promise.resolve(pr);
  }

  async commentOnPullRequest(pr: PullRequestRef, body: string): Promise<void> {
    this.prComments.push({ pr, body });
    return Promise.resolve();
  }

  async getPullRequestChecks(_pr: PullRequestRef): Promise<CheckStatus> {
    return Promise.resolve(this.checkStatus);
  }
}
