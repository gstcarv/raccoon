import type { RepoRef } from "../domain/task/index.js";
import type { BranchName, CommitSha } from "../domain/run/index.js";

export interface CoAuthor {
  readonly name: string;
  readonly email: string;
}

export interface Workspace {
  readonly runId: string;
  readonly repoRef: RepoRef;
  readonly branch: BranchName;
  readonly path: string;
}

export interface WorkspaceManager {
  prepare(repo: RepoRef, runId: string, branch: BranchName): Promise<Workspace>;
  commitAll(ws: Workspace, message: string, coAuthor: CoAuthor): Promise<CommitSha | null>;
  push(ws: Workspace): Promise<void>;
  dispose(ws: Workspace): Promise<void>;
}
