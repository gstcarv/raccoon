import { mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
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
    const worktreePath = join(this.env.RACCOON_WORKSPACE_DIR, runId);

    await mkdir(worktreePath, { recursive: true });

    const git: SimpleGit = simpleGit(bareDir);
    const askpassPath = await this.writeAskpass();
    try {
      await git.env({ ...process.env, GIT_ASKPASS: askpassPath }).fetch(["origin"]);
    } finally {
      await rm(askpassPath, { force: true });
    }

    await git.raw(["worktree", "add", "--orphan", "-b", branch, worktreePath]);

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
    const git: SimpleGit = simpleGit(ws.path);
    const askpassPath = await this.writeAskpass();
    try {
      await git
        .env({ ...process.env, GIT_ASKPASS: askpassPath })
        .push("origin", ws.branch, ["--set-upstream"]);
    } finally {
      await rm(askpassPath, { force: true });
    }
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
    await mkdir(bareDir, { recursive: true });

    const cloneUrl = await this.vcs.getCloneUrl(repo);
    const askpassPath = await this.writeAskpass();
    try {
      const git: SimpleGit = simpleGit({ baseDir: tmpdir() });
      await git
        .env({ ...process.env, GIT_ASKPASS: askpassPath })
        .clone(cloneUrl, bareDir, ["--bare"]);
    } finally {
      await rm(askpassPath, { force: true });
    }

    this.repoCaches.set(key, { bareDir });
    return bareDir;
  }

  private async writeAskpass(): Promise<string> {
    const token = await this.getToken();
    // Token is an alphanumeric GitHub token — safe to embed directly in shell
    const script = `#!/bin/sh\ncase "$1" in\n  Username*) echo x-access-token ;;\n  Password*) echo ${token} ;;\nesac\n`;
    const path = join(tmpdir(), `raccoon-askpass-${String(Date.now())}.sh`);
    await writeFile(path, script, { encoding: "utf8", mode: 0o700 });
    await chmod(path, 0o700);
    return path;
  }
}

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}
