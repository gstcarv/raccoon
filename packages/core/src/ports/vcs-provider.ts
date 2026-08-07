import type { RepoRef } from "../domain/task/index.js";
import type { BranchName } from "../domain/run/index.js";

export interface OpenPrInput {
  readonly repoRef: RepoRef;
  readonly branch: BranchName;
  readonly baseBranch: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

export interface PullRequest {
  readonly id: string;
  readonly number: number;
  readonly url: string;
  readonly headBranch: string;
}

export interface PullRequestRef {
  readonly repoRef: RepoRef;
  readonly prNumber: number;
}

export type CheckConclusion = "success" | "failure" | "pending" | "skipped";

export interface CheckStatus {
  readonly conclusion: CheckConclusion;
  readonly totalCount: number;
  readonly failedCount: number;
}

export interface VcsProvider {
  readonly id: string;
  getCloneUrl(repo: RepoRef, token?: string): Promise<string>;
  getDefaultBranch(repo: RepoRef): Promise<string>;
  openPullRequest(input: OpenPrInput): Promise<PullRequest>;
  commentOnPullRequest(pr: PullRequestRef, body: string): Promise<void>;
  getPullRequestChecks(pr: PullRequestRef): Promise<CheckStatus>;
}
