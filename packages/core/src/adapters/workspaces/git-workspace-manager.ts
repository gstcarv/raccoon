import { mkdir, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import type { SimpleGit } from "simple-git";
import type { WorkspaceManager, Workspace, CoAuthor } from "@/ports/workspace-manager.js";
import type { RepoRef } from "@/domain/task/index.js";
import type { BranchName, CommitSha } from "@/domain/run/index.js";
import type { VcsProvider } from "@/ports/vcs-provider.js";
import type { Env } from "@/config/schema.js";

interface RepoCache {
  bareDir: string;
}

export class GitWorkspaceManager implements WorkspaceManager {
  private readonly repoCaches = new Map<string, RepoCache>();

  constructor(
    private readonly vcs: VcsProvider,
    private readonly env: Env,
    private readonly getToken: () => Promise<string>,
  ) {}

  async prepare(repo: RepoRef, runId: string, branch: BranchName): Promise<Workspace> {
    const bareDir = await this.ensureBareClone(repo);
    const worktreePath = resolve(this.env.RACCOON_WORKSPACE_DIR, runId);

    await mkdir(worktreePath, { recursive: true });

    const git: SimpleGit = simpleGit(bareDir);
    await git.fetch(["origin"]);

    await git.raw(["worktree", "add", "-b", branch, worktreePath, "HEAD"]);

    const wt: SimpleGit = simpleGit(worktreePath);
    await wt.addConfig("user.name", this.env.RACCOON_COAUTHOR_NAME);
    await wt.addConfig("user.email", this.env.RACCOON_COAUTHOR_EMAIL);

    return { runId, repoRef: repo, branch, path: worktreePath };
  }

  async commitAll(ws: Workspace, message: string, coAuthor: CoAuthor): Promise<CommitSha | null> {
    const git: SimpleGit = simpleGit(ws.path);
    await git.add("-A");

    const status = await git.status();
    if (status.staged.length === 0) return null;

    const trailer = `\n\nCo-authored-by: ${coAuthor.name} <${coAuthor.email}>`;
    await git.commit(message + trailer);

    const log = await git.log({ maxCount: 1 });
    return (log.latest?.hash ?? null) as CommitSha | null;
  }

  async push(ws: Workspace): Promise<void> {
    const token = await this.getToken();
    const authedUrl = await this.vcs.getCloneUrl(ws.repoRef, token);
    const git: SimpleGit = simpleGit(ws.path);
    await git.push(authedUrl, ws.branch, ["--set-upstream"]);
  }

  async dispose(ws: Workspace): Promise<void> {
    const cacheKey = repoKey(ws.repoRef);
    const cache = this.repoCaches.get(cacheKey);
    if (cache) {
      const git: SimpleGit = simpleGit(cache.bareDir);
      await git.raw(["worktree", "remove", "--force", ws.path]).catch(() => undefined);
    }
    await rm(ws.path, { recursive: true, force: true }).catch(() => undefined);
  }

  private async ensureBareClone(repo: RepoRef): Promise<string> {
    const key = repoKey(repo);
    const existing = this.repoCaches.get(key);
    if (existing) return existing.bareDir;

    const bareDir = join(tmpdir(), "raccoon-bare", key.replace("/", "-"));

    const alreadyCloned = await access(join(bareDir, "HEAD")).then(() => true).catch(() => false);
    if (!alreadyCloned) {
      await mkdir(bareDir, { recursive: true });
      const token = await this.getToken();
      const cloneUrl = await this.vcs.getCloneUrl(repo, token);
      const git: SimpleGit = simpleGit({ baseDir: tmpdir() });
      await git.clone(cloneUrl, bareDir, ["--bare"]);
    }

    this.repoCaches.set(key, { bareDir });
    return bareDir;
  }


}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}
