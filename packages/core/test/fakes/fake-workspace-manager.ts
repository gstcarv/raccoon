import type {
  WorkspaceManager,
  Workspace,
  CoAuthor,
} from "@/ports/workspace-manager.js";
import type { RepoRef } from "@/domain/task/index.js";
import type { BranchName, CommitSha } from "@/domain/run/index.js";

export class FakeWorkspaceManager implements WorkspaceManager {
  prepared: Workspace[] = [];
  committed: Array<{ ws: Workspace; message: string; coAuthor: CoAuthor }> = [];
  pushed: Workspace[] = [];
  disposed: Workspace[] = [];
  private commitSha: CommitSha | null = "abc123" as CommitSha;

  setCommitSha(sha: CommitSha | null): void {
    this.commitSha = sha;
  }

  async prepare(repo: RepoRef, runId: string, branch: BranchName): Promise<Workspace> {
    const ws: Workspace = {
      runId,
      repoRef: repo,
      branch,
      path: `/tmp/fake-workspaces/${runId}`,
    };
    this.prepared.push(ws);
    return Promise.resolve(ws);
  }

  async commitAll(ws: Workspace, message: string, coAuthor: CoAuthor): Promise<CommitSha | null> {
    this.committed.push({ ws, message, coAuthor });
    return Promise.resolve(this.commitSha);
  }

  async push(ws: Workspace): Promise<void> {
    this.pushed.push(ws);
    return Promise.resolve();
  }

  async dispose(ws: Workspace): Promise<void> {
    this.disposed.push(ws);
    return Promise.resolve();
  }
}
